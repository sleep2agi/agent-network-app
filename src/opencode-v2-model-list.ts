// OpenCode V2 节点的模型列表来自那台机器上的 OpenCode Server（GET /api/model），
// 经 Hub 的 read_opencode_catalog / get_opencode_catalog 取回。这里不编内置清单。
import type { HubNode } from './api';

export type OpenCodeCatalogModel = { providerId: string; id: string };
export type OpenCodeCatalogSnapshot = {
  providers?: Array<{ id: string; activation?: string }>;
  models?: OpenCodeCatalogModel[];
};

const OPENCODE_RUNTIMES = new Set(['opencode-cli', 'opencode-sdk', 'opencode']);

/** V1 明确排除。代际未知时，OpenCode runtime 仍走服务器目录，Hub 会拒绝非 V2。
 *  注意代际有两个来源：`/api/nodes` 的顶层 `opencode_generation`，和（老 Hub / 夹具的）
 *  `config_snapshot.flags.opencodeGeneration`。只读后者会让真机上 gen=v1 的节点被当成 V2
 *  —— 和 0.427 修的 `gen=` 是同一类错。 */
export function isOpenCodeV2Node(
  node: Pick<HubNode, 'runtime' | 'config_snapshot'> & { opencode_generation?: 'v1' | 'v2' | null },
): boolean {
  const gen = node.opencode_generation ?? node.config_snapshot?.flags?.opencodeGeneration;
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

/**
 * 「这台机器到底报没报模型清单」的一行状态（2026-11-01 admin 反复被这个问题绊住）。
 * 三种情况分开说，避免把「版本太旧」误读成「机器坏了」：
 *   reported  —— 本机上报了 N 个模型
 *   tooOld    —— agent-node 版本低于 .160,根本不会上报
 *   missing   —— 版本够但没报上来(可能是 daemon 侧问题,需要查)
 * 版本线看不懂时只给 missing,不猜「太旧」。
 */
export function catalogStatusLine(
  reported: number,
  version: string | null | undefined,
  threshold = 160,
): string {
  const n = Math.max(0, Math.trunc(reported));
  if (n > 0) return `模型清单：本机已上报 ${n} 个模型。`;
  const fresh = reportsCatalogSince(version);
  if (fresh === false) return `模型清单：本机未上报（agent-node ${version} 低于能上报的版本，需 ≥ 2.5.0-preview.${threshold}）。`;
  // 「版本够但仍没报」是 daemon 侧的事,客户端只能兜底;说清下一步怎么交接,别让人猜。
  return `模型清单：本机未上报（agent-node ${version ?? '版本未知'}，版本本身够但仍没报上来）——这属节点侧问题：把节点详情里的诊断行贴给该节点的运维即可。`;
}

/**
 * reason → {为什么 / 下一步 / 是否影响当前状态}。
 *
 * #4820 ⑤ 方案 A（2026-11-15 拍板）—— **两个域各自一组 key，不互相套**：
 *   · `CATALOG_REASONS`：模型清单链（read_opencode_catalog），回答「为什么拿不到模型清单」；
 *   · `SOURCE_DIRECTORY_REASONS`：源目录链（source/directory），回答「为什么读不到项目/会话列表」。
 * 通信欧 11-15 拦下的正是「把 catalog 的 8 条套到 directory 串上」——文案通顺但解释的是另一个失败，
 * 属于最难被发现的一类错。两域共用的是**渲染句式**，不是**原因表**。
 */
export type ReasonEntry = { why: string; next?: string; keepsState?: string; /** 完整成句（存在时优先，逐字保持既有文案） */ text?: string };

/**
 * catalog 域的 8 条**逐字保持原样**（`text` 直出）：这些句子在 0.2.53x 已经上线、且被
 * `composer-model-empty-states` / `composer-model-palette-fallback` 断言钉住——
 * 本次只做「分域 + 向导侧可读原因」，**不趁机改线上措辞**。
 */
export const CATALOG_REASONS: Record<string, ReasonEntry> = {
  not_opencode_v2: { why: '', text: '这个节点不是 OpenCode V2，不能从它的服务器拉模型列表。' },
  daemon_not_found: { why: '', text: '找不到这个节点所属的 daemon，读不到 OpenCode 服务器。' },
  daemon_not_supervisor: { why: '', text: '找不到这个节点所属的 daemon，读不到 OpenCode 服务器。' },
  node_not_found: { why: '', text: 'Hub 没有这条节点的 OpenCode V2 创建记录，读不到模型列表。' },
  catalog_unmanaged_unreported: { why: '', text: '这个节点是手动启动的：没有 daemon 能代读它的模型清单，节点自己也还没上报（需要 agent-node ≥ 2.5.0-preview.160）。把它「交给守护进程管理」后即可读取；当前模型不受影响。' },
  user_token_required: { why: '', text: '读取模型列表需要登录人类账号，节点令牌不行。' },
  unavailable: { why: '', text: '节点上的 OpenCode 服务器没有返回模型列表。' },
  unauthorized: { why: '', text: '节点上的 OpenCode 服务器拒绝了这次读取。' },
  // #4411 —— 不是「节点坏了」，而是结构性限制：OpenCode 只从请求头读目录，header 运不了非 ASCII。
  directory_not_ascii: { why: '', text: '这个节点的工作目录含中文（或其它非 ASCII 字符）：OpenCode 只从请求头读目录，而请求头运不了非 ASCII，所以拉不到模型列表。把工作目录改成纯英文路径（例如 /home/you/work）就能读到了；当前模型与档位不受影响。' },
};

export const SOURCE_DIRECTORY_REASONS: Record<string, ReasonEntry> = {
  // 只登记源码里真实会出现的几种（session-source-directory.ts / NodeSourcePalette.tsx）。
  source_directory_unavailable: { why: '这台机器上的 Hub 没有开放「列出已有项目 / 已有会话」（只读预览未开启）', next: '让 Hub 管理员开启后再点「再读一次」', keepsState: '不会退回普通创建' },
  directory_read_failed: { why: '读源目录的请求失败了，Hub 没有返回可用的目录快照', next: '点「再读一次」重试；仍失败就看节点详情里的诊断行', keepsState: '没有生成任何节点' },
  source_daemon_unavailable: { why: '找不到这台节点归属的 daemon，读不到它上面的项目与会话', next: '在节点详情里确认 daemon 在线，或把节点交给守护进程管理', keepsState: '节点现有配置不受影响' },
  directory_not_ascii: { why: '这台机器的工作目录含中文（或其它非 ASCII 字符）：OpenCode 只从请求头读目录，而请求头运不了非 ASCII', next: '把工作目录改成纯英文路径（例如 /home/you/work）', keepsState: '节点现有的模型与档位不受影响' },
};

/**
 * CLI / runtime 版本不兼容：**两个域共用同一句**（这确实是一件事），但句式仍走同一个渲染器。
 * 为什么不自己比较版本（弃方案 B）：比较需要「第 11 处 bump 点」，判错会**直接误禁用户**（不可见故障）；
 * 且 Hub 目前不保证上报 OpenCode CLI 版本。将来要做 B 的前提：`runtime_readiness` 稳定上报 CLI 版本
 * 并覆盖**至少两个版本线**。
 */
export const VERSION_UNSUPPORTED_ENTRY: ReasonEntry = {
  why: '这台机器上的 OpenCode CLI 版本不兼容 OpenCode V2',
  next: '升级这台机器上的 OpenCode CLI 后再试',
  keepsState: '当前模型与档位不受影响',
};

const VERSION_WORD = /(version|版本)/i;
const UNSUPPORTED_WORD = /(unsupport|incompatib|too[_ -]?old|不支持|不兼容|太旧|过低)/i;

/**
 * 只在这两种词**同时**出现时才判定为版本不兼容 —— 宁可退回具名兜底，
 * 也不要把「读不到」误说成「版本不支持」（未知 ≠ 不支持）。
 */
export function isVersionUnsupportedError(error: string | undefined): boolean {
  const e = (error ?? '').trim();
  if (!e) return false;
  return VERSION_WORD.test(e) && UNSUPPORTED_WORD.test(e);
}

/** 统一句式：完整成句直出（保持既有文案），否则拼「为什么。下一步；是否影响当前状态。」 */
export function renderReason(entry: ReasonEntry): string {
  if (entry.text) return entry.text;
  return `${entry.why}。${entry.next ?? ''}${entry.keepsState ? `；${entry.keepsState}` : ''}。`;
}

export type ReasonDomain = 'catalog' | 'sourceDirectory';

const DOMAIN_TABLE: Record<ReasonDomain, Record<string, ReasonEntry>> = {
  catalog: CATALOG_REASONS,
  sourceDirectory: SOURCE_DIRECTORY_REASONS,
};

const DOMAIN_FALLBACK: Record<ReasonDomain, string> = {
  catalog: '读取 OpenCode 模型清单失败',
  sourceDirectory: '读不到这台机器上的项目与会话目录',
};

/**
 * 兜底里允许直通的只有「像 code 的东西」。
 * Hub 的 error 原文可能带路径 / 主机名 / token（通信欧 11-15 提醒），所以**不整串透传**：
 * 形状不在白名单里就只说「已隐去」，绝不把任意字符串塞进 UI。
 */
const SAFE_CODE = /^[a-z0-9_.-]{1,64}$/i;

/**
 * 查表：先精确匹配，再允许「code 后面带细节」。
 *
 * 真实 Hub 常在 code 后追加上下文（例如 `source_directory_unavailable: preview off`），
 * 精确匹配会全部落进兜底、把用户能懂的原因丢掉。这里只按 **code 前缀** 匹配已知条目，
 * 细节仍然不透传（防路径/主机名），所以「说对原因」和「不泄原文」同时成立。
 */
function lookupReason(domain: ReasonDomain, key: string): ReasonEntry | null {
  const table = DOMAIN_TABLE[domain];
  if (table[key]) return table[key];
  const head = key.split(/[:\s(]/)[0];
  return head && table[head] ? table[head] : null;
}

/**
 * 两个入口共用这一个渲染器；**表按域分开**，所以「同一 reason 同文」只在域内成立 ——
 * 这正是要的：catalog 的 `unavailable` 与源目录的 `source_directory_unavailable` 说明的是两件事。
 * 未登记的 reason → **具名兜底 + 白名单形状的原始 code**；形状不像 code 时只说「已隐去」。
 */
export function reasonText(domain: ReasonDomain, code: string | undefined): string {
  const key = (code ?? '').trim();
  if (isVersionUnsupportedError(key)) return renderReason(VERSION_UNSUPPORTED_ENTRY);
  const entry = lookupReason(domain, key);
  if (entry) return renderReason(entry);
  const head = DOMAIN_FALLBACK[domain];
  if (!key) return `${head}。`;
  return SAFE_CODE.test(key)
    ? `${head}：${key}（未登记的原因，原文照上）`
    : `${head}（未登记的原因；原始原因含非 code 内容，已隐去以免带出路径或主机名）`;
}

export function catalogErrorText(error: string | undefined): string {
  return reasonText('catalog', error);
}

/**
 * 目录读取（新建节点向导「选已有项目 / 已有会话」）用**源目录域**的表，
 * 与选择器共用渲染器、不共用原因表。
 */
export function sourceReadErrorText(error: string | undefined): string {
  return reasonText('sourceDirectory', error);
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

/** Pure. 节点自报清单 + 自报档位 → 面板快照的 models。档位编码 `provider/model=a,b,c`；
 * 认不出的条目丢掉，不猜。没报档位的模型不带 variants（面板据此显示当前值，而不是编出档位）。 */
export function reportedCatalogWithVariants(
  catalog: readonly unknown[] | null | undefined,
  variants: readonly unknown[] | null | undefined,
): Array<{ providerId: string; id: string; variants?: string[] }> {
  const map = new Map<string, string[]>();
  for (const entry of variants ?? []) {
    if (typeof entry !== 'string') continue;
    const eq = entry.lastIndexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    const list = entry.slice(eq + 1).split(',').map(v => v.trim()).filter(v => /^[A-Za-z0-9._-]{1,40}$/.test(v));
    if (list.length && new Set(list).size === list.length) map.set(key, list);
  }
  const out: Array<{ providerId: string; id: string; variants?: string[] }> = [];
  for (const raw of reportedCatalogModels(catalog as string[] | null | undefined)) {
    const slash = raw.indexOf('/');
    const v = map.get(raw);
    out.push({ providerId: raw.slice(0, slash), id: raw.slice(slash + 1), ...(v ? { variants: v } : {}) });
  }
  return out;
}

/** Pure. daemon 代读成功时，把 Hub 自报的档位补进**快照里没给档位**的模型。
 *  为什么：#4610 —— daemon 快照比自报新鲜，所以快照给了档位就以快照为准；
 *  但老 daemon / 某些 runtime 的快照只有模型 id、没有 variants，于是档位 pill 只能显示
 *  「未知」，即使 Hub 上早就有节点自报的 `opencode_catalog_variants`。
 *  只补缺失项，不覆盖、不新增快照里没有的模型，也不编造快照和自报都没给的档位。 */
export function mergeReportedVariants<T extends { providerId?: string | null; id?: string | null; variants?: unknown }>(
  snapshot: { providers?: unknown; models?: readonly T[] | null } | null | undefined,
  reported: readonly { providerId: string; id: string; variants?: string[] }[] | null | undefined,
): { providers?: unknown; models: T[] } | null {
  if (!snapshot) return null;
  const models = Array.isArray(snapshot.models) ? snapshot.models : [];
  const byKey = new Map<string, string[]>();
  for (const row of reported ?? []) {
    if (!row?.providerId || !row?.id || !row.variants?.length) continue;
    byKey.set(`${row.providerId}/${row.id}`, row.variants);
  }
  if (!byKey.size) return { providers: snapshot.providers, models: [...models] };
  return {
    providers: snapshot.providers,
    models: models.map(m => {
      const p = typeof m?.providerId === 'string' ? m.providerId.trim() : '';
      const i = typeof m?.id === 'string' ? m.id.trim() : '';
      const key = p && i ? `${p}/${i}` : '';
      const given = m?.variants;
      // 快照给了（含明确的空数组 = 这模型没有档位）就不动；只补「完全没给」的。
      if (!key || given !== undefined) return m;
      const fill = byKey.get(key);
      return fill ? { ...m, variants: fill } : m;
    }),
  };
}

/** Pure. 这台节点自己没有清单时，用**同 runtime 其他节点**自报的清单（连同它们报的档位）兜底。
 * 只合并、去重、保序；返回贡献节点数，界面据此写明「清单来自 N 个同类节点」。 */
export function peerCatalogWithVariants(
  nodes: readonly { node_id?: string; runtime?: string | null; opencode_catalog?: string[] | null; opencode_catalog_variants?: string[] | null }[] | null | undefined,
  options: { runtime: string | null | undefined; excludeNodeId?: string; limit?: number },
): { models: Array<{ providerId: string; id: string; variants?: string[] }>; nodes: number } {
  const runtime = options.runtime;
  if (!runtime) return { models: [], nodes: 0 };
  const limit = options.limit ?? 120;
  const byKey = new Map<string, { providerId: string; id: string; variants?: string[] }>();
  let contributing = 0;
  for (const n of nodes ?? []) {
    if (!n || n.runtime !== runtime) continue;
    if (options.excludeNodeId && n.node_id === options.excludeNodeId) continue;
    const rows = reportedCatalogWithVariants(n.opencode_catalog, n.opencode_catalog_variants);
    if (rows.length) contributing += 1;
    for (const row of rows) {
      const key = `${row.providerId}/${row.id}`;
      const prev = byKey.get(key);
      if (!prev) { if (byKey.size < limit) byKey.set(key, row); }
      else if (!prev.variants && row.variants) byKey.set(key, row);
    }
  }
  return { models: [...byKey.values()], nodes: contributing };
}

/** #4976 —— 服务端（Hub ≥ 0.9.0-preview.287）显式给出的四态；旧 Hub 没有这一格。 */
export type OpenCodeCatalogState = 'reported' | 'reported_empty' | 'not_reported' | 'unsupported_runtime';

/**
 * #4976 —— 四态回落：**服务端说了算，客户端只在旧 Hub 上按老信息推断**。
 * 推断时绝不产出 `unsupported_runtime`（无法区分「非 OpenCode」与「OpenCode 但没报」），
 * 以免把「等待上报」误渲染成「永远不会有」。
 */
export function catalogStateOf(
  node: { opencode_catalog_state?: OpenCodeCatalogState | null; runtime?: string | null; opencode_catalog?: string[] | null } | null | undefined,
): OpenCodeCatalogState | null {
  const explicit = node?.opencode_catalog_state;
  if (explicit) return explicit;
  if (!node) return null;
  const reported = Array.isArray(node.opencode_catalog) ? node.opencode_catalog.length : 0;
  if (reported > 0) return 'reported';
  if (Array.isArray(node.opencode_catalog)) return 'reported_empty';
  return null;
}

/**
 * #4976 —— 每种终态给一句能读的话 + 能不能重试。
 * 关键：`unsupported_runtime` **不给重试**（重试一百次也不会出现目录），
 * `not_reported` 给重试（节点侧上报后就会好）。
 */
export function catalogStateNotice(state: OpenCodeCatalogState | null): { text: string; retry: boolean } {
  switch (state) {
    case 'reported': return { text: '', retry: false };
    case 'reported_empty': return { text: '这台节点上报了模型目录，但里面没有可用模型（不是错误）。仍可手输 provider/model。', retry: false };
    case 'not_reported': return { text: '这台是 OpenCode 运行时，但还没上报模型目录——可以点「重新读取」；多次仍为空时把节点详情里的诊断行发给该节点运维。', retry: true };
    case 'unsupported_runtime': return { text: '该节点不是 OpenCode V2，没有模型目录可读（重试也不会有）。', retry: false };
    default: return { text: '', retry: false };
  }
}

/**
 * #4976 review（负责人）：**按钮与提示必须用同一个判据**。
 * A) v2 + unsupported_runtime：effect 提前 return，v2Catalog 为空 → 光看「用了内置候选」会照样画按钮，
 *    但点了也不会重读（状态行的「下方按钮可立刻重试」同样是空头支票）。
 * B) 非 v2：effect 第一行就 `if (!v2) return`，任何重试都不会发生 —— 即使服务端说 not_reported 也不该给按钮。
 */
export function canRetryCatalog(input: { v2: boolean; state: OpenCodeCatalogState | null; fallback: boolean }): boolean {
  if (!input.v2) return false;
  if (input.state === 'unsupported_runtime') return false;
  return input.fallback || input.state === 'not_reported';
}

/** 非 v2 时不要叫人点重试（点了没反应）；其余情况沿用 catalogStateNotice。 */
export function catalogNoticeFor(input: { v2: boolean; state: OpenCodeCatalogState | null }): { text: string; retry: boolean } {
  const notice = catalogStateNotice(input.state);
  if (input.v2) return notice;
  if (input.state === 'not_reported') {
    return { text: '该节点当前不会提供可读的模型目录（模型由节点自己的配置决定）。', retry: false };
  }
  return { ...notice, retry: false };
}
