// Pure models for swr-cache.ts (no storage / react-native imports, so tests run under bun).

export interface BoardSnapshot {
  v: 1;
  networkId: string;
  items: unknown[];
  projects: unknown[] | null;
  twoRoles: boolean | null;
  capabilities: string[];
}

export function boardSnapshotFor(raw: unknown, networkId: string | undefined): BoardSnapshot | null {
  if (!raw || typeof raw !== 'object' || !networkId) return null;
  const r = raw as Partial<BoardSnapshot>;
  if (r.v !== 1 || r.networkId !== networkId || !Array.isArray(r.items)) return null;
  return {
    v: 1,
    networkId,
    items: r.items,
    projects: Array.isArray(r.projects) ? r.projects : null,
    twoRoles: typeof r.twoRoles === 'boolean' ? r.twoRoles : null,
    capabilities: Array.isArray(r.capabilities) ? r.capabilities.filter((c): c is string => typeof c === 'string') : [],
  };
}

export const HISTORY_CONVERSATIONS = 20;
export const HISTORY_MESSAGES = 30;

export interface HistoryFile<T> {
  v: 1;
  /** Most recently written first. */
  conversations: { key: string; messages: T[] }[];
}

type ChatRow = Record<string, unknown>;

/** Hub rows only (newest-first in, newest-first out), capped. */
export function persistableMessages<T extends ChatRow>(messages: readonly T[], max = HISTORY_MESSAGES): T[] {
  const out: T[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m._localId || m._pending || m._failed || m._img || m._restoredNoImage) continue;
    if (!m.task_id && !m.message_id) continue;
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

export function historyFile<T>(raw: unknown): HistoryFile<T> {
  const r = raw as Partial<HistoryFile<T>> | undefined;
  if (!r || r.v !== 1 || !Array.isArray(r.conversations)) return { v: 1, conversations: [] };
  return { v: 1, conversations: r.conversations.filter(c => c && typeof c.key === 'string' && Array.isArray(c.messages)) };
}

export function historyWith<T extends ChatRow>(file: HistoryFile<T>, key: string, messages: readonly T[], maxConversations = HISTORY_CONVERSATIONS): HistoryFile<T> {
  const kept = persistableMessages(messages);
  const rest = file.conversations.filter(c => c.key !== key);
  const conversations = kept.length ? [{ key, messages: kept }, ...rest] : rest;
  return { v: 1, conversations: conversations.slice(0, maxConversations) };
}

export function historyFor<T>(file: HistoryFile<T>, key: string): T[] | null {
  const hit = file.conversations.find(c => c.key === key);
  return hit && hit.messages.length ? hit.messages : null;
}

