// 「打开这张任务」的跨屏请求:私信 / 顶部提示里的任务通知(meta.task_notice,hub agent-network#2201)
// 先在这里留一张条子,再切到任务页。任务页(RequirementBoard)挂载时取走一次;已经开着时靠订阅马上打开。
// 纯逻辑,不 import react-native。

export type OpenTaskRequest = { requirementId: string; networkId: string | null };
type Listener = () => void;

let pending: OpenTaskRequest | null = null;
const listeners = new Set<Listener>();

export function requestOpenTask(req: OpenTaskRequest): void {
  pending = req;
  for (const l of listeners) l();
}

/**
 * 取走条子(取一次就没了)。条子写明了别的网络 → 不取(留给那个网络的看板;换网络时任务页会重挂)。
 * 条子没写网络 → 当前看板取。
 */
export function takeOpenTaskRequest(networkId: string | undefined): string | null {
  if (!pending) return null;
  if (pending.networkId && networkId && pending.networkId !== networkId) return null;
  const id = pending.requirementId;
  pending = null;
  return id;
}

export function subscribeOpenTaskRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
