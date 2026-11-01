// OpenCode V2 节点的模型列表来自那台机器上的 OpenCode Server（GET /api/model），
// 经 Hub 的 read_opencode_catalog / get_opencode_catalog 取回。这里不编内置清单。
import type { HubNode } from './api';

export type OpenCodeCatalogModel = { providerId: string; id: string };
export type OpenCodeCatalogSnapshot = {
  providers?: Array<{ id: string; activation?: string }>;
  models?: OpenCodeCatalogModel[];
};

const OPENCODE_RUNTIMES = new Set(['opencode-cli', 'opencode-sdk', 'opencode']);

/** V1 明确排除。代际未知时，OpenCode runtime 仍走服务器目录，Hub 会拒绝非 V2。 */
export function isOpenCodeV2Node(node: Pick<HubNode, 'runtime' | 'config_snapshot'>): boolean {
  const gen = node.config_snapshot?.flags?.opencodeGeneration;
  if (gen === 'v1') return false;
  if (gen === 'v2') return true;
  return OPENCODE_RUNTIMES.has(node.runtime ?? '');
}

/** provider/model，跳过已停用的 provider。顺序保持服务器返回的顺序。 */
export function modelIdsFromCatalog(snapshot: OpenCodeCatalogSnapshot | null | undefined): string[] {
  const disabled = new Set((snapshot?.providers ?? []).filter(p => p.activation === 'disabled').map(p => p.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of snapshot?.models ?? []) {
    if (!row?.providerId || !row.id || disabled.has(row.providerId)) continue;
    const id = `${row.providerId}/${row.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * #2293 —— 节点自报清单（Hub `/api/nodes` 的 `opencode_catalog.models`，已是
 * `provider/model` 字符串）。这里只做三件事：丢空/超长、去重、保序 ——
 * 不排序、不补内置、不猜 provider 是否可用（那是服务器的事）。
 */
export function reportedCatalogModels(
  catalog: string[] | null | undefined,
): string[] {
  const raw = Array.isArray(catalog) ? catalog : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || id.length > 400 || !id.includes('/')) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 400) break;
  }
  return out;
}

/**
 * 同 runtime 的**其他节点**报过的模型（2026-11-01 admin 那台 V2 节点一直没上报清单，
 * 「建议」里只剩「当前」一项，等于没法切换）。这台机器没报，不代表整个网络都没有：
 * 同 runtime 的兄弟节点报过的 `provider/model` 往往就是可用的候选。
 *
 * 只做聚合：丢空/超长/无 `/`、去重、保序（先到先得），排序交给界面的分组函数。
 */
export function peerCatalogModels(
  nodes: readonly { node_id?: string; runtime?: string | null; opencode_catalog?: string[] | null }[] | null | undefined,
  options: { runtime: string | null | undefined; excludeNodeId?: string; limit?: number },
): string[] {
  const runtime = options.runtime;
  if (!runtime) return [];
  const limit = options.limit ?? 60;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes ?? []) {
    if (!n || n.runtime !== runtime) continue;
    if (options.excludeNodeId && n.node_id === options.excludeNodeId) continue;
    for (const id of reportedCatalogModels(n.opencode_catalog)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * 同 `peerCatalogModels`，但把「有多少台兄弟节点真的报了清单」也带出来 ——
 * 界面上写「其他 3 台节点报过的模型」比光给一串 id 更可信。
 */
export function peerCatalogSources(
  nodes: readonly { node_id?: string; runtime?: string | null; opencode_catalog?: string[] | null }[] | null | undefined,
  options: { runtime: string | null | undefined; excludeNodeId?: string; limit?: number },
): { models: string[]; nodes: number } {
  const runtime = options.runtime;
  if (!runtime) return { models: [], nodes: 0 };
  const limit = options.limit ?? 60;
  const out: string[] = [];
  const seen = new Set<string>();
  let contributing = 0;
  for (const n of nodes ?? []) {
    if (!n || n.runtime !== runtime) continue;
    if (options.excludeNodeId && n.node_id === options.excludeNodeId) continue;
    const reported = reportedCatalogModels(n.opencode_catalog);
    if (reported.length === 0) continue;
    contributing++;
    for (const id of reported) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return { models: out, nodes: contributing };
    }
  }
  return { models: out, nodes: contributing };
}

export function catalogErrorText(error: string | undefined): string {
  switch (error) {
    case 'not_opencode_v2': return '这个节点不是 OpenCode V2，不能从它的服务器拉模型列表。';
    case 'daemon_not_found':
    case 'daemon_not_supervisor': return '找不到这个节点所属的 daemon，读不到 OpenCode 服务器。';
    case 'node_not_found': return 'Hub 没有这条节点的 OpenCode V2 创建记录，读不到模型列表。';
    case 'user_token_required': return '读取模型列表需要登录人类账号，节点令牌不行。';
    case 'unavailable': return '节点上的 OpenCode 服务器没有返回模型列表。';
    case 'unauthorized': return '节点上的 OpenCode 服务器拒绝了这次读取。';
    default: return error ? `读取 OpenCode 模型列表失败：${error}` : '读取 OpenCode 模型列表失败。';
  }
}

/**
 * #2293 —— 这台节点的 agent-node 版本是否够新到**自动上报**模型清单。
 *
 * 判据来自发布事实：`opencode_catalog` 是 `agent-node@2.5.0-preview.160` 起才真正上报的
 * （`.159` 因为“读错目录 + 键放错顶层”导致功能空转，已在 `.160` 修复）。
 *
 * 返回 `null` = 版本号看不懂（例如 `dev`、空串、或 major.minor 不同），此时**不要**给用户
 * 任何“版本太旧”的结论 —— 只回到原来的“还没上报过”文案。
 */
export function reportsCatalogSince(version: string | null | undefined): boolean | null {
  const raw = typeof version === 'string' ? version.trim() : '';
  const m = /^(\d+)\.(\d+)\.(\d+)-preview\.(\d+)$/.exec(raw);
  if (!m) return null;
  const [major, minor, patch, preview] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  // 只对同一条 2.5.0 线给判断；换了版本线就交给 null（不猜）。
  if (major !== 2 || minor !== 5 || patch !== 0) return null;
  return preview >= 160;
}
