// 聊天信息里的「规则文件 ›」「技能 ›」…… 要打开节点信息页的**那一个分区**,而不是永远落在「概览」。
// ChatScreen 只有 onOpenNodeSettings() 这一个出口(App 里三处挂法各自 setScreen),所以不改路由,
// 而是在跳转前留一张条子,NodeDetailScreen(只读页)挂载时取走一次。纯逻辑,不 import react-native。
import type { NodeSectionKey } from './node-page-model';

const pending = new Map<string, NodeSectionKey>();

/** 与 NodeDetailScreen 的 sectionHandoffKey 同一口径:只读页 + 账号 + alias。 */
export const nodeInfoSectionKey = (scope: string, alias: string) => `nodeSection:info:${scope}:${alias}`;

export function requestNodeSection(key: string, section: NodeSectionKey): void {
  pending.set(key, section);
}

/** 挂载时调一次:有条子就返回并作废,没有返回 undefined。 */
export function takeNodeSectionRequest(key: string): NodeSectionKey | undefined {
  const section = pending.get(key);
  pending.delete(key);
  return section;
}
