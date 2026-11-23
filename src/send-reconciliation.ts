import { withDeadline } from './deadline';

/** Decide whether an ambiguous write should become a visible retry. The Hub is
 * authoritative: refresh first, then expose failure only if the optimistic row
 * still exists. Kept RN-free so the timeout/ACK-loss ordering is behavior-tested. */
export async function shouldExposeSendFailure(
  reconcile: () => Promise<void>,
  optimisticRowStillExists: () => boolean,
  // #518: the refresh must not keep the bubble in 「发送中…」 either — a failing or hanging
  // reconcile counts as "could not confirm", and the row is then shown as failed (retryable).
  reconcileDeadlineMs = RECONCILE_DEADLINE_MS,
): Promise<boolean> {
  await withDeadline(reconcile().catch(() => undefined), reconcileDeadlineMs, () => undefined);
  return optimisticRowStillExists();
}

/** Same bound as one poll read (api.ts READ_DEADLINE_MS). */
export const RECONCILE_DEADLINE_MS = 20_000;

/**
 * 独立的发送失败对账：直接拉取目标会话的最新任务行并确认 outbox，绝不经过 ChatScreen
 * 的 loadSequenceRef 门控。
 *
 * 根因：ChatScreen.load() 用单调递增的 loadSequenceRef 丢弃被新轮询抢占的旧读。
 * 发送超时/丢 ACK 后若直接拿 load() 做对账，只要对账期间 5s 轮询 / SSE 唤醒 / 第二条失败消息
 * 再触发一次 load()，本次对账的 onTasks 就会被 isCurrent() 吞掉，outboxRemove 不会执行，
 * 即使 Hub 实际已落库也会误标「未送达 · 点击重试」。
 */
export async function reconcileOutboxForSend<E, R>(opts: {
  fetchRows: () => Promise<R[]>;
  pendingEntries: () => E[];
  confirmIds: (entries: E[], rows: R[]) => string[];
  removeOutbox: (id: string) => void;
  onConfirmed?: (confirmedIds: string[]) => void;
}): Promise<void> {
  const rows = await opts.fetchRows();
  const confirmed = opts.confirmIds(opts.pendingEntries(), rows);
  if (!confirmed.length) return;
  for (const id of confirmed) opts.removeOutbox(id);
  opts.onConfirmed?.(confirmed);
}

/** A send can outlive the conversation that started it in the sidebar window.
 * Its durable outbox/cache work still belongs to the original conversation,
 * but it may only touch visible React state while that conversation is active. */
export function mayApplySendResult(
  startedConversationKey: string,
  visibleConversationKey: string,
  mounted: boolean,
): boolean {
  return mounted && startedConversationKey === visibleConversationKey;
}
