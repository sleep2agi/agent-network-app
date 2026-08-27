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
  question: string;
  attachments: Array<{ fileId: string }>;
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
  pendingRequestKey?: string;
  actionRequestKeys?: Partial<Record<SideThreadCardAction, string>>;
  broughtBack?: boolean;
  bringingBack?: boolean;
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
  const ambiguousOperation = record.operations.find(operation => operation.state === 'ambiguous' || operation.state === 'reconciling');
  const ambiguousAction = ambiguousOperation && ['cancel', 'archive', 'bring-back'].includes(ambiguousOperation.kind)
    ? ambiguousOperation.kind as SideThreadCardAction
    : undefined;
  const openBringBack = record.bringBacks.some(item => item.state === 'starting') || record.operations.some(operation =>
    operation.kind === 'bring-back' && (operation.state === 'pending' || operation.state === 'ambiguous' || operation.state === 'reconciling'));
  const actionRequestKeys: Partial<Record<SideThreadCardAction, string>> = {};
  for (const operation of record.operations) {
    if (!['pending', 'ambiguous', 'reconciling', 'failed'].includes(operation.state)) continue;
    if (operation.kind === 'cancel' || operation.kind === 'archive' || operation.kind === 'bring-back') {
      actionRequestKeys[operation.kind] = operation.requestKey;
    }
  }
  if (latest?.parentAttemptId && ['failed', 'ambiguous', 'reconciling'].includes(latest.state)) {
    actionRequestKeys.retry = latest.requestKey;
  }
  return {
    id: record.sideThreadId,
    requestKey: record.requestKey,
    question: record.question,
    attachments: latest?.attachments ?? record.attachments,
    state: ambiguousOperation ? 'reconciling' : state,
    ...(latest?.result ? { result: latest.result } : {}),
    ...(latest?.error ? { error: latest.error } : {}),
    ...(record.activeAttemptId ? { activeAttemptId: record.activeAttemptId } : {}),
    ...(latest?.attemptId ? { latestAttemptId: latest.attemptId } : {}),
    sourceThreadId: record.sourceThreadId,
    ...(record.capability.runtime ? { runtime: record.capability.runtime } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.bringBacks.some(item => item.state === 'completed' && item.broughtBack) ? { broughtBack: true } : {}),
    ...(openBringBack ? { bringingBack: true } : {}),
    ...(Object.keys(actionRequestKeys).length ? { actionRequestKeys } : {}),
    ...(ambiguousOperation ? {
      pendingRequestKey: ambiguousOperation.requestKey,
      ...(ambiguousAction ? { pendingAction: ambiguousAction } : {}),
    } : {}),
  };
};

const STATE_PRECEDENCE: Record<SideThreadCardState, number> = {
  creating: 0,
  running: 1,
  reconciling: 2,
  failed: 3,
  cancelled: 3,
  succeeded: 3,
  archived: 4,
};

const preferIncoming = (old: SideThreadCard | undefined, incoming: SideThreadCard): boolean =>
  !old || incoming.updatedAt > old.updatedAt || (
    incoming.updatedAt === old.updatedAt && STATE_PRECEDENCE[incoming.state] >= STATE_PRECEDENCE[old.state]
  );

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
    const old = previous.get(incoming.id) ?? current.find(card => card.requestKey === incoming.requestKey);
    if (old && !preferIncoming(old, incoming)) {
      next.push(old);
    } else {
      next.push({
        ...incoming,
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
  if (!incoming) return current.filter(card => card.id !== record.sideThreadId && card.requestKey !== record.requestKey);
  const existing = current.find(card => card.id === incoming.id || card.requestKey === incoming.requestKey);
  if (!preferIncoming(existing, incoming)) return current;
  return newestFirst([
    {
      ...incoming,
      ...(existing?.broughtBack ? { broughtBack: true } : {}),
    },
    ...current.filter(card => card.id !== incoming.id && card.requestKey !== incoming.requestKey),
  ]);
};

export const markSideThreadAction = (
  current: SideThreadCard[],
  id: string,
  pendingAction?: SideThreadCardAction,
  pendingRequestKey?: string,
): SideThreadCard[] => current.map(card => card.id === id
  ? {
    ...card,
    ...(pendingAction ? { pendingAction, pendingRequestKey } : { pendingAction: undefined, pendingRequestKey: undefined }),
    ...(pendingAction && pendingRequestKey ? {
      actionRequestKeys: { ...card.actionRequestKeys, [pendingAction]: pendingRequestKey },
    } : {}),
    ...(pendingAction === 'bring-back' ? { bringingBack: true } : {}),
  }
  : card);

export const markSideThreadReconciling = (
  current: SideThreadCard[],
  id: string,
): SideThreadCard[] => current.map(card => card.id === id
  ? { ...card, state: 'reconciling', error: undefined }
  : card);

export const sideThreadActionAvailability = (card: SideThreadCard) => {
  const durable = !card.id.startsWith('pending:');
  return {
    cancel: durable && (card.state === 'creating' || card.state === 'running') && !card.pendingAction,
    retry: durable && (card.state === 'failed' || card.state === 'cancelled') && !card.pendingAction,
    archive: durable && (card.state === 'succeeded' || card.state === 'failed' || card.state === 'cancelled') && !card.pendingAction,
    bringBack: durable && card.state === 'succeeded' && !!card.result && !card.broughtBack && !card.bringingBack && !card.pendingAction,
  };
};

export const SIDE_THREAD_STATE_LABELS: Record<SideThreadCardState, string> = {
  creating: '正在创建',
  running: '旁路处理中',
  reconciling: '正在确认运行状态',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  archived: '已归档',
};
