// 「发送诊断」发给谁:由用户在节点选择器里挑(公开产品:别人的网络里没有固定的维护 agent,
// 同名节点也可能是陌生人的 —— 绝不能写死别名)。上次选的按账号记在本机,下次预选。
import { pinScopeKey } from './chat-pins-core';
import type { PickerNode } from './node-picker-model';

type Scope = { profileId?: string; serverUrl?: string; username?: string };

/** 盘上是 { [账号作用域]: alias };坏数据当没有。 */
export function readRecipient(text: string | null | undefined, cfg: Scope): string | null {
  if (!text) return null;
  try {
    const map = JSON.parse(text);
    const alias = map && typeof map === 'object' ? map[pinScopeKey(cfg)] : null;
    return typeof alias === 'string' && alias ? alias : null;
  } catch {
    return null;
  }
}

export function writeRecipient(text: string | null | undefined, cfg: Scope, alias: string): string {
  let map: Record<string, string> = {};
  try {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed;
  } catch { /* 坏数据整份重写 */ }
  return JSON.stringify({ ...map, [pinScopeKey(cfg)]: alias });
}

/** 上次的收件人还在这个网络里(可指派)才预选:打 ✓ 并放进「最近使用」置顶。不在了就什么都不选。 */
export function preselectRecipient(nodes: readonly PickerNode[], alias: string | null): { selectedId: string; recents: string[] } {
  const hit = alias ? nodes.find(n => n.assignable && n.alias === alias) : undefined;
  return hit ? { selectedId: hit.node_id, recents: [hit.node_id] } : { selectedId: '', recents: [] };
}
