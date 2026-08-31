/**
 * 跨 AgentsScreen / ChatScreen 的未读 ledger。
 * 计数只经过 reduceUnread；组件不准自己 +1 / 清零。
 */
import { AppState, type AppStateStatus } from 'react-native';
import type { HubMessage } from './api';
import { ingestUserMessages } from './unread-badge';
import {
  initialUnreadState,
  reduceUnread,
  type UnreadEvent,
  type UnreadState,
} from './unread-ledger';

export type UnreadStoreSnapshot = {
  ledger: UnreadState;
  /** 最近一次成功的 `/api/messages?scope=user` 响应；失败时保留上一份。 */
  serverBody: unknown;
  seenIds: ReadonlySet<string>;
};

let snapshot: UnreadStoreSnapshot = {
  ledger: initialUnreadState(),
  serverBody: null,
  seenIds: new Set(),
};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getUnreadSnapshot(): UnreadStoreSnapshot {
  return snapshot;
}

export function subscribeUnread(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatchUnread(event: UnreadEvent): void {
  snapshot = { ...snapshot, ledger: reduceUnread(snapshot.ledger, event) };
  emit();
}

/** 把 user inbox 里没见过的消息送进 ledger。同一 id 不重复计数。 */
export function ingestUserMessagesBody(body: unknown): void {
  const messages = body && typeof body === 'object' && Array.isArray((body as { messages?: unknown }).messages)
    ? ((body as { messages: HubMessage[] }).messages ?? [])
    : [];
  const ingested = ingestUserMessages(snapshot.ledger, messages, snapshot.seenIds);
  snapshot = { ledger: ingested.ledger, serverBody: body, seenIds: ingested.seenIds };
  emit();
}

export function replaceUnreadSnapshot(next: UnreadStoreSnapshot): void {
  snapshot = next;
  emit();
}

let appStateBound = false;
export function bindUnreadAppState(): void {
  if (appStateBound) return;
  appStateBound = true;
  const apply = (status: AppStateStatus) => {
    dispatchUnread({ kind: 'foreground_changed', foreground: status === 'active' });
  };
  apply(AppState.currentState);
  AppState.addEventListener('change', apply);
}
