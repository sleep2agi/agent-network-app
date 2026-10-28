// 左栏的小偏好(只存本机、只为方便):标签组折叠了没有。
// admin 2026-10-25:标签列表太长(十几个),**默认折叠**,点组头再展开。
// 读写失败(隐私模式、原生端没有 localStorage)也按「折叠」处理 —— 与默认值一致,免得两种端两副样子。
const KEY = 'anet.taskSidebar.tagsCollapsed';

export function readTagsCollapsed(): boolean {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY) ?? null;
    // 没存过 → 默认折叠;用户明确展开过('0')→ 展开。
    return raw === null ? true : raw === '1';
  } catch { return true; }
}

export function writeTagsCollapsed(collapsed: boolean): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, collapsed ? '1' : '0'); } catch { /* 只是偏好 */ }
}

// 看板列收起状态(0.331 加的功能):关掉再开就全展开了,用户每次都得重新收一遍。
const COLS_KEY = 'anet.taskBoard.collapsedColumns';

export function readCollapsedColumns(): Set<string> {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(COLS_KEY) ?? null;
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch { return new Set(); }
}

export function writeCollapsedColumns(ids: Iterable<string>): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(COLS_KEY, JSON.stringify([...ids]));
  } catch { /* 只是偏好 */ }
}
