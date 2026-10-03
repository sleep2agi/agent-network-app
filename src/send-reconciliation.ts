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
