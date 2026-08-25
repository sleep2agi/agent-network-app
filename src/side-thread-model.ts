import type { SideThreadRecord, SideThreadRecordState } from './side-thread-api';

export type SideThreadCardState =
  | 'creating'
  | 'running'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'archived';

export type SideThreadCardAction = 'cancel' | 'retry' | 'archive' | 'bring-back';

export interface SideThreadCard {
  id: string;
  requestKey: string;
  prompt: string;
  state: SideThreadCardState;
  result?: string;
  error?: string;
  activeAttemptId?: string;
  latestAttemptId?: string;
  sourceThreadId: string;
  runtime?: string;
  createdAt: number;
  updatedAt: number;
  pendingAction?: SideThreadCardAction;
  broughtBack?: boolean;
}

export const toSideThreadCardState = (state: SideThreadRecordState): SideThreadCardState | null => {
  if (state === 'completed') return 'succeeded';
  if (state === 'ambiguous') return 'reconciling';
  if (state === 'purged') return null;
  return state;
};

export const sideThreadCardFromRecord = (record: SideThreadRecord): SideThreadCard | null => {
  const state = toSideThreadCardState(record.state);
  if (!state) return null;
  const latest = record.attempts[record.attempts.length - 1];
  return {
    id: record.sideChatId,
    requestKey: record.requestKey,
    prompt: record.prompt,
    state,
    ...(latest?.result ? { result: latest.result } : {}),
    ...(latest?.error ? { error: latest.error } : {}),
    ...(record.activeAttemptId ? { activeAttemptId: record.activeAttemptId } : {}),
    ...(latest?.attemptId ? { latestAttemptId: latest.attemptId } : {}),
    sourceThreadId: record.sourceThreadId,
    ...(record.runtime ? { runtime: record.runtime } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.bringBacks.some(item => item.state === 'completed') ? { broughtBack: true } : {}),
  };
};

const newestFirst = (cards: SideThreadCard[]) =>
  [...cards].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));

/** Hydration is identity-based, never array-position based. That is what keeps
 * two BTW requests isolated when their runtime answers arrive out of order. */
export const mergeSideThreadRecords = (
  current: SideThreadCard[],
  records: SideThreadRecord[],
): SideThreadCard[] => {
  const previous = new Map(current.map(card => [card.id, card]));
  const next: SideThreadCard[] = [];
  for (const record of records) {
    const incoming = sideThreadCardFromRecord(record);
    if (!incoming) continue;
    const old = previous.get(incoming.id);
    if (old && old.updatedAt > incoming.updatedAt) {
      next.push(old);
    } else {
      next.push({
        ...incoming,
        ...(old?.pendingAction ? { pendingAction: old.pendingAction } : {}),
        ...(old?.broughtBack ? { broughtBack: true } : {}),
      });
    }
  }
  // A create call may still be waiting for the Hub to return its durable id;
  // an overlapping list response cannot contain that client placeholder yet.
  // Keep it until create resolves or fails instead of making the card blink.
  const hydratedRequestKeys = new Set(next.map(card => card.requestKey));
  for (const pending of current.filter(card => card.id.startsWith('pending:') && !hydratedRequestKeys.has(card.requestKey))) {
    if (!next.some(card => card.id === pending.id)) next.push(pending);
  }
  return newestFirst(next);
};

export const upsertSideThreadRecord = (
  current: SideThreadCard[],
  record: SideThreadRecord,
): SideThreadCard[] => {
  const incoming = sideThreadCardFromRecord(record);
  if (!incoming) return current.filter(card => card.id !== record.sideChatId);
  const existing = current.find(card => card.id === incoming.id);
  if (existing && existing.updatedAt > incoming.updatedAt) return current;
  return newestFirst([
    { ...incoming, ...(existing?.broughtBack ? { broughtBack: true } : {}) },
    ...current.filter(card => card.id !== incoming.id),
  ]);
};

export const markSideThreadAction = (
  current: SideThreadCard[],
  id: string,
  pendingAction?: SideThreadCardAction,
): SideThreadCard[] => current.map(card => card.id === id
  ? { ...card, ...(pendingAction ? { pendingAction } : { pendingAction: undefined }) }
  : card);

export const markSideThreadBroughtBack = (
  current: SideThreadCard[],
  id: string,
): SideThreadCard[] => current.map(card => card.id === id
  ? { ...card, pendingAction: undefined, broughtBack: true }
  : card);

export const markSideThreadReconciling = (
  current: SideThreadCard[],
  id: string,
): SideThreadCard[] => current.map(card => card.id === id
  ? { ...card, state: 'reconciling', pendingAction: undefined, error: undefined }
  : card);

export const sideThreadActionAvailability = (card: SideThreadCard) => ({
  cancel: (card.state === 'creating' || card.state === 'running') && !card.id.startsWith('pending:') && !card.pendingAction,
  retry: (card.state === 'failed' || card.state === 'cancelled') && !card.pendingAction,
  archive: (card.state === 'succeeded' || card.state === 'failed' || card.state === 'cancelled') && !card.pendingAction,
  bringBack: card.state === 'succeeded' && !!card.result && !card.broughtBack && !card.pendingAction,
});

export const SIDE_THREAD_STATE_LABELS: Record<SideThreadCardState, string> = {
  creating: '正在创建',
  running: '旁路处理中',
  reconciling: '正在确认运行状态',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  archived: '已归档',
};
