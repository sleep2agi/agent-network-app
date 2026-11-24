// 节点「职责介绍」(admin 2026-11-15「每个节点的职责是不是需要可以让其他节点也能看到;desc 里面放介绍而不是 AGENTS.md,
// AGENTS.md 是给自己看到的,需要设计个给其他节点看的自己的职责啥的,能干什么」)。纯模块·可单测。
//
// 区别:
//   AGENTS.md(规则文件)—— 节点给**自己**看的工作指令,只在它自己的会话里加载;
//   职责介绍(Hub nodes.description)—— 给**别的节点和人**看的名片:负责什么、能干什么、什么事找它、不做什么。
//   其他节点在 get_all_status 里看到一行摘要,get_session_status 里看到整段;App 节点页 / 组织页显示同一段。

/** 与 Hub 的 MAX_DESCRIPTION_LEN 相同(server/src/node-attrs-validate.ts)。按 Unicode 码点数。 */
export const DESCRIPTION_MAX = 1000;

/** 空着时一键填进去的骨架:四个问题,别的节点派活前最想知道的。 */
export const DESCRIPTION_TEMPLATE = '负责：\n能干什么：\n什么事找我：\n不做：';

export const descriptionLength = (text: string): number => [...text.trim()].length;

/** 保存前的本地检查(Hub 还会再查一遍)。 */
export function descriptionDraftError(text: string): 'tooLong' | null {
  return descriptionLength(text) > DESCRIPTION_MAX ? 'tooLong' : null;
}

/** 只填了骨架、四个问题后面都没写 = 等于没写,存成空。 */
export function normalizeDraft(text: string): string | null {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return null;
  const meaningful = t.split('\n').some(line => {
    const m = /^(负责|能干什么|什么事找我|不做)[：:]\s*(.*)$/.exec(line.trim());
    return m ? m[2].trim().length > 0 : line.trim().length > 0;
  });
  return meaningful ? t : null;
}

/** Hub 回的错误 → 界面上的一句话(i18n key)。 */
export function saveErrorKey(error: string, status?: number): string {
  if (error === 'attrs_revision_conflict' || status === 409) return 'nodeDesc.conflict';
  if (error === 'invalid_description') return 'nodeDesc.invalid';
  if (error === 'unsupported') return 'nodeDesc.unsupported';
  if (error === 'permission_denied' || status === 401 || status === 403) return 'nodeDesc.forbidden';
  if (status === 404) return 'nodeDesc.notFound';
  return 'nodeDesc.failed';
}

const TEMPLATE_LINE_RE = /^(负责|能干什么|什么事找我|不做|职责|简介|个性签名|签名)[：:]\s*(.*)$/;

/**
 * 列表行 / 聊天顶栏用的单行摘要（admin 2026-11-25 截图需求 #5501）：
 * - 空串 / 纯空白 / 未填写的模板骨架 → ''（不占位）；
 * - 跳过空模板行，取第一条有实质内容的行，并去掉冗余前缀（如「负责：」），压缩空白；
 * - 超出 maxLen 个 Unicode 码点时补省略号（界面侧仍配 numberOfLines={1} 兜底视觉宽度）。
 */
export function descriptionSummary(raw: string | null | undefined, maxLen = 80): string {
  const normalized = normalizeDraft(raw ?? '');
  if (!normalized) return '';
  let picked = '';
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = TEMPLATE_LINE_RE.exec(line);
    const body = (m ? m[2] : line).replace(/\s+/g, ' ').trim();
    if (body) { picked = body; break; }
  }
  if (!picked) return '';
  if (maxLen > 1) {
    const chars = [...picked];
    if (chars.length > maxLen) return chars.slice(0, maxLen - 1).join('') + '…';
  }
  return picked;
}

export interface NodeDescriptionRow {
  node_id?: string | null;
  alias?: string | null;
  description?: string | null;
  updated_at?: string | null;
}

/** 按 alias 建「最新一行 → 单行摘要」索引；同 alias 多行时取 updated_at 最新者，无有效摘要时不入表。 */
export function descriptionByAlias(nodes: ReadonlyArray<NodeDescriptionRow> | null | undefined): Map<string, string> {
  const best = new Map<string, NodeDescriptionRow>();
  for (const n of nodes ?? []) {
    const key = n.alias?.trim();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || (n.updated_at ?? '') >= (prev.updated_at ?? '')) best.set(key, n);
  }
  const out = new Map<string, string>();
  for (const [alias, row] of best) {
    const summary = descriptionSummary(row.description);
    if (summary) out.set(alias, summary);
  }
  return out;
}

/** 聊天顶栏按权威 node_id 优先匹配（缺失时退回最新 alias 行），返回单行摘要。 */
export function descriptionForNode(
  nodes: ReadonlyArray<NodeDescriptionRow> | null | undefined,
  target: { nodeId?: string | null; alias: string },
): string {
  const list = nodes ?? [];
  if (target.nodeId) {
    const exact = list.find(n => n.node_id === target.nodeId);
    if (exact) return descriptionSummary(exact.description);
  }
  return descriptionByAlias(list).get(target.alias) ?? '';
}
