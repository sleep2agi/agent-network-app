/**
 * 跨 AgentsScreen / ChatScreen 的未读 ledger。
 * 计数只经过 reduceUnread；组件不准自己 +1 / 清零。
 */
import { AppState, type AppStateStatus } from 'react-native';
import type { HubMessage } from './api';
import { ingestUserMessages } from './unread-badge';
import { advanceWatermark, loadReplyWatermarks, replyUnreadByAgent, saveReplyWatermarks, watermarkAfterRender, type ReplyWatermarks } from './reply-unread';
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
  /** alias 分支 `/api/messages?limit=N` 最近一次的行(inbox 表);agent 回给用户的未读从这里算。 */
  replyRows: readonly HubMessage[];
  /** 每个 agent「看到哪」的水位线(hub UTC created_at 字符串),桌面端持久化。 */
  replyWatermarks: ReplyWatermarks;
  /** 登录用户名(replyRows 里 to_alias 要等于它)。 */
  replyUsername: string;
};

let snapshot: UnreadStoreSnapshot = {
  ledger: initialUnreadState(),
  serverBody: null,
  seenIds: new Set(),
  replyRows: [],
  replyWatermarks: loadReplyWatermarks(),
  replyUsername: '',
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
  snapshot = { ...snapshot, ledger: ingested.ledger, serverBody: body, seenIds: ingested.seenIds };
  emit();
}

/** 把 alias 分支的最近消息(inbox 表)存进来;角标用 replyUnreadByAgent 现算。 */
export function ingestInboxMessagesBody(body: unknown, username: string | undefined): void {
  const rows = body && typeof body === 'object' && Array.isArray((body as { messages?: unknown }).messages)
    ? ((body as { messages: HubMessage[] }).messages ?? [])
    : [];
  snapshot = { ...snapshot, replyRows: rows, replyUsername: username ?? '' };
  emit();
}

/** 某个 agent 的会话已渲染到最新:推进它的水位线并持久化,该 agent 的回复未读归零。 */
export function markAgentRepliesSeen(agent: string): void {
  if (!agent) return;
  const ts = watermarkAfterRender(snapshot.replyRows, snapshot.replyUsername, agent);
  const next = advanceWatermark(snapshot.replyWatermarks, agent, ts);
  if (next === snapshot.replyWatermarks) return;
  saveReplyWatermarks(next);
  snapshot = { ...snapshot, replyWatermarks: next };
  emit();
}

/** 当前快照下每个 agent 的回复未读数。 */
export function replyUnreadCounts(snap: UnreadStoreSnapshot = snapshot): Record<string, number> {
  return replyUnreadByAgent(snap.replyRows, snap.replyUsername, snap.replyWatermarks);
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
