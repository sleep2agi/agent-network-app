/** Decide whether an ambiguous write should become a visible retry. The Hub is
 * authoritative: refresh first, then expose failure only if the optimistic row
 * still exists. Kept RN-free so the timeout/ACK-loss ordering is behavior-tested. */
export async function shouldExposeSendFailure(
  reconcile: () => Promise<void>,
  optimisticRowStillExists: () => boolean,
): Promise<boolean> {
  await reconcile();
  return optimisticRowStillExists();
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
