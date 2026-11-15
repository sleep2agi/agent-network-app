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
