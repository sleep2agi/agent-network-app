// 群聊的实时信号:DesktopMessageListener(唯一的 /events/users/me 消费者)收到 group_message / group_read 就发一下,
// 会话列表就地改未读、打开着的群聊去拉新的。另记「当前开着哪个群」。
import type { GroupEvent } from './group-chat';

type Listener = (ev: GroupEvent | null) => void;
const listeners = new Set<Listener>();
let activeGroup: string | null = null;

export function subscribeGroupChat(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** null = 「群列表变了,重拉」(建群 / 改名 / 拉人之后)。 */
export function emitGroupChat(ev: GroupEvent | null): void {
  for (const l of listeners) l(ev);
}
export function setActiveGroup(groupId: string | null): void {
  activeGroup = groupId;
}
export function activeGroupId(): string | null {
  return activeGroup;
}

// 群名:屏幕状态里只带 group_id(折叠屏展开 / 收起时导航值只留 id),标题从这里补。
const names = new Map<string, string>();
export function rememberGroupName(groupId: string, name: string): void {
  if (groupId && name) names.set(groupId, name);
}
export function groupNameFor(groupId: string): string | undefined {
  return names.get(groupId);
}
