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
