/**
 * 跨 AgentsScreen / ChatScreen 的未读 ledger。
 * 计数只经过 reduceUnread；组件不准自己 +1 / 清零。
 */
import { AppState, type AppStateStatus } from 'react-native';
import type { HubMessage, HubUserMessage } from './api';
import { readServerUnreadByAgent } from './user-unread';
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
  /** 水位线属于哪个账号(app#275:按 profile 分 key;undefined = 旧的全局 key)。 */
  replyProfileId?: string;
};

let snapshot: UnreadStoreSnapshot = {
  ledger: initialUnreadState(),
  serverBody: null,
  seenIds: new Set(),
  replyRows: [],
  replyWatermarks: loadReplyWatermarks(),
  replyUsername: '',
  replyProfileId: undefined,
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
  saveReplyWatermarks(next, snapshot.replyProfileId);
  snapshot = { ...snapshot, replyWatermarks: next };
  emit();
}

/**
 * app#275:切到(或以工作区窗口借用)某个账号时,把回复水位线换成那个账号自己的一份,
 * 上一个账号的 inbox 行也清掉 —— 两个账号窗口各算各的。同一账号重复绑定是 no-op。
 */
export function bindUnreadProfile(profileId: string | undefined): void {
  if (profileId === snapshot.replyProfileId && (profileId !== undefined || snapshot.replyRows.length === 0)) return;
  snapshot = { ...snapshot, replyProfileId: profileId, replyWatermarks: loadReplyWatermarks(profileId), replyRows: [] };
  emit();
}

/** #1828:hub 是否给了按 agent 的权威未读(有 → ChatScreen 渲染到底时要向 hub ack)。 */
export function hubHasAgentUnread(snap: UnreadStoreSnapshot = snapshot): boolean {
  return readServerUnreadByAgent(snap.serverBody) !== null;
}

/**
 * #1828:某个 agent 在当前快照里还没 ack 的消息 id —— user_inbox 那半(scope=user 响应里的 message_id)
 * 加 inbox 回复那半(alias 分支里 from_alias=agent、to_alias=登录用户名 的行)。给 ackUserMessages 用。
 */
export function unackedIdsForAgent(agent: string, snap: UnreadStoreSnapshot = snapshot): string[] {
  if (!agent) return [];
  const ids = new Set<string>();
  const body = snap.serverBody as { messages?: HubUserMessage[] } | null;
  for (const m of Array.isArray(body?.messages) ? body!.messages! : []) {
    if (m?.from_session === agent && m.acked === 0 && typeof m.message_id === 'string' && m.message_id) ids.add(m.message_id);
  }
  for (const r of snap.replyRows) {
    if (r?.from_alias === agent && r.to_alias === snap.replyUsername && r.acked === 0 && r.id) ids.add(r.id);
  }
  return [...ids];
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
