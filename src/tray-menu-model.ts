// 0.2.76 系统栏托盘的菜单模型(纯函数,Rust 侧只负责画):
// 「N  <alias>」按未读数降序,最多 20 行;总数是所有 agent 之和。
// 数的来源只有 unread-store 的每 agent 计数 —— 托盘和列表角标永远一致。

export const TRAY_MAX_ITEMS = 20;

export type TrayItem = { alias: string; count: number };
export type TrayModel = { total: number; items: TrayItem[] };

export function trayModelFrom(counts: Readonly<Record<string, number>>): TrayModel {
  const items: TrayItem[] = [];
  let total = 0;
  for (const [alias, raw] of Object.entries(counts)) {
    const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (!alias.trim() || count === 0) continue;
    total += count;
    items.push({ alias, count });
  }
  items.sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias, 'zh-Hans-CN'));
  return { total, items: items.slice(0, TRAY_MAX_ITEMS) };
}

/** 两次模型相同就不重画菜单(托盘重建在 macOS 上会闪一下)。 */
export function trayModelEqual(a: TrayModel | null, b: TrayModel): boolean {
  if (!a || a.total !== b.total || a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    if (a.items[i].alias !== b.items[i].alias || a.items[i].count !== b.items[i].count) return false;
  }
  return true;
}
