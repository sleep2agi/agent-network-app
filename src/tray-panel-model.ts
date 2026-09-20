// 0.2.82 托盘面板的行模型(纯函数,面板只负责画)。
//
// Vincent 2026-09-20「通知用这个啊」+ 飞书通知面板截图:左上应用名、右上「忽略全部」、
// 每行 = 头像 + 名字 + 右侧红色未读数。0.2.76 那版是**原生菜单**,一行只能是纯文本
// 「N  <alias>」,画不出头像和红点 —— 所以这一版改成自绘面板,行模型搬到这里。
//
// 数的来源仍然只有一个:unread-store → trayModelFrom(已排序、已截断)。这里**不重新排序**,
// 只把它翻译成「能画的行」,避免托盘、面板、列表三处各排一次、排出三种顺序。
import { formatUnreadBadge, type UnreadBadge } from './unread-ledger';
import type { TrayItem } from './tray-menu-model';

export interface TrayPanelRow {
  alias: string;
  count: number;
  /** 复用列表行同一个格式化(>99 显示 99+);count>0 时必非 null。 */
  badge: UnreadBadge | null;
}

export interface TrayPanelModel {
  total: number;
  rows: TrayPanelRow[];
  /** 没有未读时面板不能是一片空白 —— 画空状态文案。 */
  empty: boolean;
}

export function trayPanelModelFrom(items: readonly TrayItem[] | null | undefined): TrayPanelModel {
  const rows: TrayPanelRow[] = [];
  let total = 0;
  for (const item of items ?? []) {
    const alias = typeof item?.alias === 'string' ? item.alias.trim() : '';
    const raw = item?.count;
    const count = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (!alias || count === 0) continue;
    total += count;
    rows.push({ alias, count, badge: formatUnreadBadge(count) });
  }
  return { total, rows, empty: rows.length === 0 };
}

/**
 * 「忽略全部」要清哪些 agent。
 *
 * 🔴 取自**面板当前显示的行**,而不是 unread-store 的全量:面板只承诺清掉它列出来的那些。
 *    托盘模型本来就截断到 20 行(TRAY_MAX_ITEMS),如果这里去读全量,用户点一下会清掉
 *    他根本没看见的会话 —— 那是「按钮做的事比它说的多」,比少清更糟。
 */
export function dismissAllTargets(model: TrayPanelModel | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of model?.rows ?? []) {
    if (!row.alias || seen.has(row.alias)) continue;
    seen.add(row.alias);
    out.push(row.alias);
  }
  return out;
}
