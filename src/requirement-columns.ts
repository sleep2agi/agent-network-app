// 任务状态「废弃」(abandoned,看板 #724;Hub 侧 agent-network#2490)。
//
// 契约:
//  · abandoned 和 done 一样是关闭态 —— 不算开着、不逾期、不提醒。
//  · 客户端要「声明」认识它:需求接口的每个请求带 X-Anet-Accept-Columns: abandoned。
//    没声明的调用者,Hub 把 abandoned 投影成 done(旧 App ≤ 0.2.220 会把不认识的状态当 pool)。
//  · 旧 Hub(列表 capabilities 不含 column_abandoned)不认识这个值,写它会 400 invalid_column ——
//    所以那种 Hub 上界面根本不给「废弃」这个选项(statusChoices)。
import { REQ_COLUMNS, type ReqColumn } from './requirements-model';

export const ACCEPT_COLUMNS_HEADER = 'X-Anet-Accept-Columns';
/** 需求接口请求都并上这一份(读和写都要:写的响应也按声明投影)。 */
export const ACCEPT_COLUMNS_HEADERS: Readonly<Record<string, string>> = { [ACCEPT_COLUMNS_HEADER]: 'abandoned' };

/** Hub 列表响应 capabilities 里的能力名。 */
export const ABANDONED_CAPABILITY = 'column_abandoned';
export const supportsAbandoned = (capabilities: readonly string[] | null | undefined): boolean =>
  !!capabilities && capabilities.includes(ABANDONED_CAPABILITY);

/** 看板 / 选择器能用的状态:旧 Hub 不给「废弃」。 */
export const statusChoices = (abandonedOk: boolean): ReqColumn[] =>
  REQ_COLUMNS.filter(c => c !== 'abandoned' || abandonedOk);

/** 关闭态(完成 / 废弃):标题划线、不逾期、不算开着。 */
export const isClosedColumn = (column: ReqColumn | string | null | undefined): boolean => column === 'done' || column === 'abandoned';

/**
 * 状态胶囊上的字。「废弃」是灰 + 删除线;其它状态只上调用方给的颜色(完成是绿,不划线)。
 * color 由 STATUS_TONE 给(废弃 = textMuted)。
 */
export function statusCapsuleText(column: ReqColumn | string | null | undefined, color: string): { color: string; textDecorationLine: 'line-through' | 'none' } {
  return column === 'abandoned' ? { color, textDecorationLine: 'line-through' } : { color, textDecorationLine: 'none' };
}
