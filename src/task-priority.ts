// 需求优先级 P0–P3(owner 09-30:「P0、P1、P2、P3 …… 最高，然后普通，然后低，然后极低」)。
// Hub 里存的值不变:high = P0 最高、normal = P1 普通、low = P2 低;lowest = P3 极低是新值,
// 只有列表响应 capabilities 带 priority_lowest 的 Hub 收(旧 Hub 回 400 invalid_priority),所以旧 Hub 上不给选 P3。
// 纯逻辑 + 文案,不 import react-native。
import { registerTranslations, t } from './i18n';
import { REQ_PRIORITIES, type ReqPriority } from './requirements-model';

registerTranslations({
  'priority.label.high': ['P0 最高', 'P0 Highest'],
  'priority.label.normal': ['P1 普通', 'P1 Normal'],
  'priority.label.low': ['P2 低', 'P2 Low'],
  'priority.label.lowest': ['P3 极低', 'P3 Lowest'],
});

export const PRIORITY_LOWEST_CAPABILITY = 'priority_lowest';

export const PRIORITY_CODE: Record<ReqPriority, 'P0' | 'P1' | 'P2' | 'P3'> = { high: 'P0', normal: 'P1', low: 'P2', lowest: 'P3' };

/** 越小越靠前:P0 → P3。 */
export const PRIORITY_RANK: Record<ReqPriority, number> = { high: 0, normal: 1, low: 2, lowest: 3 };

/** 选择器 / 筛选里用的全称:「P0 最高」。 */
export const priorityLabel = (p: ReqPriority): string => t(`priority.label.${p}`);

/** Hub 收不收 P3:列表响应的 capabilities 带 priority_lowest。没读到 capabilities(还在加载、旧 Hub)一律按不收。 */
export const supportsLowest = (capabilities: readonly string[]): boolean => capabilities.includes(PRIORITY_LOWEST_CAPABILITY);

/** 选择器 / 筛选里给哪几档。旧 Hub 只给 P0–P2;卡片已经是 P3 的仍然留着那一档,不让当前值从选择器里消失。 */
export function priorityChoices(lowestSupported: boolean, current?: ReqPriority): ReqPriority[] {
  const lowest = lowestSupported || current === 'lowest';
  return REQ_PRIORITIES.filter(p => p !== 'lowest' || lowest);
}
