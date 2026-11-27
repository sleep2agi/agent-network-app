// #5675 PR-1 —— 聊天密钥卡片保存后自动生效（无自锁、无需用户再点第二个按钮）。
//
// 根因：此前 ChatSecretCard 保存成功后立刻发出「🔑 已在卡片里保存…」唤醒节点，紧接着
// 用户点「立即重启使其生效」时 Hub 因 node_busy_in_flight 拒绝重启，形成自锁。
//
// 新流程：
//   1. 保存成功立刻标记 saved，绝不提前发唤醒消息；
//   2. 立即尝试 restart_node：
//      - 成功 → 进入 restarting，等节点回到空闲后标为 applied，再发唤醒消息（可选）；
//      - 返回 node_busy_in_flight → 进入 waiting_idle（「节点正在干活，做完这件事后自动生效」），
//        在 App 侧轮询节点状态，一旦节点空闲自动补发 restart_node，用户不需要点第二个按钮；
//      - 明确不支持远程重启（manual / adopted 等）→ 显示手动重启命令，不发会误触发 AI 报错的唤醒消息。
import type { NodeLifecycleResult } from './api';
import { manualRestartCommand } from './node-restart-after-secret';

export type ChatSecretApplyState =
  | 'idle'
  | 'applying'
  | 'waiting_idle'
  | 'restarting'
  | 'applied'
  | 'manual';

export interface NodeActivityProbe {
  status?: string | null;
  inFlightCount?: number | null;
}

export interface ChatSecretAutoApplyDeps {
  restartNode: () => Promise<NodeLifecycleResult>;
  readNodeStatus: () => Promise<NodeActivityProbe | null>;
  onState: (state: ChatSecretApplyState) => void;
  /** 仅在重启生效后调用，用来发唤醒消息（绝不在重启前调用，避免把节点弄忙自锁）。 */
  onApplied?: () => void;
  signal: AbortSignal;
  pollMs?: number;
  maxBusyPolls?: number;
  restartSettleMs?: number;
  maxOnlinePolls?: number;
  onlinePollMs?: number;
}

const savedCardsMemory = new Set<string>();

function savedCardMemKey(scopeKey: string, nodeId: string, key: string): string {
  return `${scopeKey}|${nodeId}|${key}`;
}

export function markChatSecretSavedLocally(scopeKey: string, nodeId: string, key: string): void {
  if (!scopeKey || !nodeId || !key) return;
  savedCardsMemory.add(savedCardMemKey(scopeKey, nodeId, key));
}

export function isChatSecretSavedLocally(scopeKey: string, nodeId: string, key: string): boolean {
  if (!scopeKey || !nodeId || !key) return false;
  return savedCardsMemory.has(savedCardMemKey(scopeKey, nodeId, key));
}

export function __resetChatSecretSavedMemoryForTest(): void {
  savedCardsMemory.clear();
}

export function isNodeBusyForRestart(probe: NodeActivityProbe | null): boolean {
  if (!probe) return false;
  if (typeof probe.inFlightCount === 'number' && probe.inFlightCount > 0) return true;
  return probe.status === 'working';
}

export function isNodeBackOnlineIdle(probe: NodeActivityProbe | null): boolean {
  if (!probe) return false;
  if (probe.status === 'offline' || probe.status === 'working') return false;
  if (typeof probe.inFlightCount === 'number' && probe.inFlightCount > 0) return false;
  return probe.status === 'idle' || probe.status === 'online';
}

export function chatSecretApplyText(state: ChatSecretApplyState, alias?: string): string {
  switch (state) {
    case 'applying':
      return '保存好了，节点空闲时自动生效';
    case 'waiting_idle':
      return '节点正在干活，做完这件事后自动生效';
    case 'restarting':
      return '保存好了，节点正在自动重载生效，稍后即可直接使用。';
    case 'applied':
      return '已自动生效，可以直接继续对话。';
    case 'manual':
      return `保存好了。该节点不支持远程重启，请手动执行：${manualRestartCommand(alias)}`;
    case 'idle':
      return '';
  }
}

function waitAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function finishAfterRestartAccepted(deps: ChatSecretAutoApplyDeps): Promise<'applied' | 'aborted'> {
  const {
    readNodeStatus,
    onState,
    onApplied,
    signal,
    restartSettleMs = 2500,
    maxOnlinePolls = 10,
    onlinePollMs = 2000,
  } = deps;
  onState('restarting');
  if (!(await waitAbortable(restartSettleMs, signal))) return 'aborted';
  for (let i = 0; i < maxOnlinePolls; i++) {
    if (signal.aborted) return 'aborted';
    const probe = await readNodeStatus().catch(() => null);
    if (signal.aborted) return 'aborted';
    if (isNodeBackOnlineIdle(probe)) break;
    if (i + 1 < maxOnlinePolls && !(await waitAbortable(onlinePollMs, signal))) return 'aborted';
  }
  if (signal.aborted) return 'aborted';
  onState('applied');
  onApplied?.();
  return 'applied';
}

export async function runChatSecretAutoApply(
  deps: ChatSecretAutoApplyDeps,
): Promise<'applied' | 'manual' | 'aborted'> {
  const {
    restartNode,
    readNodeStatus,
    onState,
    signal,
    pollMs = 3000,
    maxBusyPolls = 200,
  } = deps;

  if (signal.aborted) return 'aborted';
  onState('applying');

  const first = await restartNode().catch(() => ({ ok: false as const, error: 'restart_failed' }));
  if (signal.aborted) return 'aborted';
  if (first.ok) {
    return finishAfterRestartAccepted(deps);
  }
  if (first.error !== 'node_busy_in_flight') {
    onState('manual');
    return 'manual';
  }

  onState('waiting_idle');
  for (let i = 0; i < maxBusyPolls; i++) {
    if (!(await waitAbortable(pollMs, signal))) return 'aborted';
    const probe = await readNodeStatus().catch(() => null);
    if (signal.aborted) return 'aborted';
    if (isNodeBusyForRestart(probe)) continue;

    const retry = await restartNode().catch(() => ({ ok: false as const, error: 'restart_failed' }));
    if (signal.aborted) return 'aborted';
    if (retry.ok) {
      return finishAfterRestartAccepted(deps);
    }
    if (retry.error === 'node_busy_in_flight') {
      continue;
    }
    onState('manual');
    return 'manual';
  }

  if (signal.aborted) return 'aborted';
  onState('manual');
  return 'manual';
}
