// #886（第一片）—— 聊天输入框的「/ 命令 + 节点技能」候选模型。
//
// 只做**纯函数**：识别当前要补全的 /token、合并候选（命令 + 目标节点技能）、按名称/描述过滤、
// 分类、去重、插入草稿。**不发送、不建任务**——选择只改输入框文本，发送仍走原有路径。
//
// 数据来源约束（与需求一致）：
//   · 只用已有 /btw 命令和目标节点 skills_capable / listNodeSkills 返回的真实技能；
//   · 不读客户端本机的技能目录；
//   · 技能「调用提示」与 Runtime 原生命令是两回事——这里只产出可插入的文本，不宣称原生执行。

export type SlashItem = {
  /** 插入草稿用的文本（不含前导 `/`）。 */
  readonly id: string;
  /** 候选里显示的主名字（命令名 / 技能名）。 */
  readonly name: string;
  readonly description?: string;
  readonly kind: 'command' | 'skill';
};

/** 输入框文本里正在补全的 /token；没有就返回 null。
 *  规则：`/` 必须出现在行首或空白之后，且 `/` 之后到光标之间既没有空白、也没有第二个 `/`
 *  （有空白说明已经在写参数；`/usr/bin` 这类路径不弹候选，免得打字时被干扰）。 */
export function slashQuery(text: string, caret?: number): { query: string; start: number; end: number } | null {
  const pos = typeof caret === 'number' && caret >= 0 && caret <= text.length ? caret : text.length;
  const before = text.slice(0, pos);
  const m = /(^|\s)\/([^\s/]*)$/.exec(before);
  if (!m) return null;
  const start = before.length - m[2].length - 1;
  return { query: m[2], start, end: pos };
}

/** 候选过滤：名称优先、其次描述；大小写不敏感；同 id 只留第一条（命令先于技能）。 */
export function slashCandidates(items: readonly SlashItem[], query: string, limit = 8): SlashItem[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const scored: Array<{ item: SlashItem; rank: number }> = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
    const id = item.id.trim();
    if (seen.has(id)) continue;
    const name = (item.name || id).toLowerCase();
    const desc = (item.description || '').toLowerCase();
    let rank: number;
    if (!q) rank = 2;
    else if (name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if (desc.includes(q)) rank = 2;
    else continue;
    seen.add(id);
    scored.push({ item: { ...item, id }, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, Math.max(1, limit)).map(s => s.item);
}

/** 按分类分组（命令在前、技能在后），空组不返回。 */
export function groupSlashItems(items: readonly SlashItem[]): Array<{ kind: SlashItem['kind']; items: SlashItem[] }> {
  const out: Array<{ kind: SlashItem['kind']; items: SlashItem[] }> = [];
  for (const kind of ['command', 'skill'] as const) {
    const group = items.filter(i => i.kind === kind);
    if (group.length) out.push({ kind, items: group });
  }
  return out;
}

/** 选中一条候选后的草稿：把 /token 换成 `/id `，光标放在末尾。
 *  **只改文本**——返回的 `send: false` 是显式契约，选择永远不触发发送。 */
export function applySlash(
  text: string,
  caret: number | undefined,
  pick: SlashItem,
): { text: string; caret: number; send: false } {
  const at = slashQuery(text, caret);
  const insert = `/${pick.id} `;
  if (!at) {
    const next = text + insert;
    return { text: next, caret: next.length, send: false };
  }
  const next = text.slice(0, at.start) + insert + text.slice(at.end);
  return { text: next, caret: at.start + insert.length, send: false };
}

/** 把 /btw 这类已有命令和节点技能合成候选；技能描述为空时保留名字，不编造描述。 */
export function mergeSlashSources(args: {
  commands?: ReadonlyArray<{ id: string; name?: string; description?: string }>;
  skills?: ReadonlyArray<{ id: string; name?: string; description?: string }>;
}): SlashItem[] {
  const out: SlashItem[] = [];
  const seen = new Set<string>();
  for (const c of args.commands ?? []) {
    const id = String(c?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: c.name?.trim() || id, ...(c.description ? { description: c.description } : {}), kind: 'command' });
  }
  for (const s of args.skills ?? []) {
    const id = String(s?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: s.name?.trim() || id, ...(s.description ? { description: s.description } : {}), kind: 'skill' });
  }
  return out;
}
