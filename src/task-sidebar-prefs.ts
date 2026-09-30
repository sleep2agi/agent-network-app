// 左栏的小偏好(只存本机、只为方便):标签组折叠了没有。读写失败(隐私模式、原生端没有 localStorage)= 默认展开。
const KEY = 'anet.taskSidebar.tagsCollapsed';

export function readTagsCollapsed(): boolean {
  try { return (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY) === '1'; } catch { return false; }
}

export function writeTagsCollapsed(collapsed: boolean): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, collapsed ? '1' : '0'); } catch { /* 只是偏好 */ }
}
