// 私信的实时信号:DesktopMessageListener(唯一的 /events/users/me 消费者)收到 kind='human_dm' 就发一下,
// 人员列表和打开着的私信会话各自重新拉一次。另记「当前开着和谁的私信」:那个人发来的不再弹顶部提示。
type Listener = (fromUsername: string | null) => void;
const listeners = new Set<Listener>();
let activePeer: string | null = null;

export function subscribeHumanDm(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitHumanDm(fromUsername: string | null): void {
  for (const l of listeners) l(fromUsername);
}
export function setActiveDmPeer(username: string | null): void {
  activePeer = username;
}
export function activeDmPeer(): string | null {
  return activePeer;
}
