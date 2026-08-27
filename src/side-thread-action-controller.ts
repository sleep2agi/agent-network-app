import {
  createSideThreadRequestKey,
  SideThreadApiError,
  type SideThreadClient,
  type SideThreadRecord,
} from './side-thread-api';
import {
  markSideThreadAction,
  markSideThreadReconciling,
  upsertSideThreadRecord,
  type SideThreadCard,
  type SideThreadCardAction,
} from './side-thread-model';

type CardUpdate = (cards: SideThreadCard[]) => SideThreadCard[];

export interface SideThreadActionControllerDependencies<RequestToken> {
  client: Pick<SideThreadClient, 'cancel' | 'retry' | 'archive' | 'bringBack' | 'get'>;
  getCards: () => SideThreadCard[];
  updateCards: (update: CardUpdate) => void;
  setError: (cardId: string, message: string) => void;
  beginRequest: (lane: string) => RequestToken;
  isCurrent: (request: RequestToken) => boolean;
  createRequestKey?: (action: SideThreadCardAction) => string;
}

/**
 * Runtime-neutral action coordinator. Locks are acquired synchronously before
 * the first Promise is created, so two taps in one JS turn cannot dispatch two
 * writes. Ambiguous operations keep both their lock and requestKey until an
 * authoritative list/get projection proves the operation is retryable.
 */
export const createSideThreadActionController = <RequestToken>(
  dependencies: SideThreadActionControllerDependencies<RequestToken>,
) => {
  const locks = new Set<string>();
  const lockKeyFor = (cardId: string, action: SideThreadCardAction) => `${cardId}\u0000${action}`;

  const reconcile = (cards: SideThreadCard[]) => {
    for (const lockKey of locks) {
      const [cardId] = lockKey.split('\u0000');
      const card = cards.find(candidate => candidate.id === cardId);
      if (!card || (!card.pendingAction && !card.bringingBack && card.state !== 'reconciling')) locks.delete(lockKey);
    }
  };

  const run = async (cardId: string, action: SideThreadCardAction): Promise<void> => {
    const lockKey = lockKeyFor(cardId, action);
    if (locks.has(lockKey)) return;
    const card = dependencies.getCards().find(candidate => candidate.id === cardId);
    if (!card) return;
    locks.add(lockKey);

    const requestKey = card.actionRequestKeys?.[action]
      ?? dependencies.createRequestKey?.(action)
      ?? createSideThreadRequestKey(action);
    const request = dependencies.beginRequest(`action:${card.id}:${action}`);
    dependencies.updateCards(current => markSideThreadAction(current, card.id, action, requestKey));
    dependencies.setError(card.id, '');
    let bringBackAcknowledged = false;

    try {
      let record: SideThreadRecord;
      if (action === 'cancel') {
        record = await dependencies.client.cancel(card.id, { requestKey });
      } else if (action === 'retry') {
        record = await dependencies.client.retry(card.id, { requestKey, question: card.question, attachments: card.attachments });
      } else if (action === 'archive') {
        record = await dependencies.client.archive(card.id, { requestKey });
      } else {
        await dependencies.client.bringBack(card.id, {
          requestKey,
          destinationThreadId: card.sourceThreadId,
          ...(card.latestAttemptId ? { attemptId: card.latestAttemptId } : {}),
        });
        if (!dependencies.isCurrent(request)) return;
        bringBackAcknowledged = true;
        // An ACK only proves that the command was accepted. The UI may show
        // broughtBack=true solely from the following owner-authorized record.
        record = await dependencies.client.get(card.id);
      }
      if (!dependencies.isCurrent(request)) return;
      dependencies.updateCards(current => upsertSideThreadRecord(current, record));
      locks.delete(lockKey);
    } catch (error) {
      if (!dependencies.isCurrent(request)) return;
      if (bringBackAcknowledged) {
        dependencies.setError(card.id, 'Hub 已接收带回请求，正在确认完成状态。请等待或刷新。');
        return;
      }
      if (error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_AMBIGUOUS') {
        dependencies.updateCards(current => markSideThreadReconciling(current, card.id));
        dependencies.setError(card.id, '结果暂不确定，正在确认运行状态。请等待或刷新。');
        return;
      }
      locks.delete(lockKey);
      dependencies.updateCards(current => markSideThreadAction(current, card.id));
      dependencies.setError(card.id, error instanceof Error ? error.message : `${action} 失败`);
    }
  };

  return { run, reconcile, isLocked: (cardId: string, action: SideThreadCardAction) => locks.has(lockKeyFor(cardId, action)) };
};
