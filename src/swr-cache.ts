// Stale-while-revalidate disk caches for the 任务 board and recent chat history.
//
// Why: from China every screen's first read is a trans-Pacific round trip plus its payload
// (the board list alone is 163 KB gzip ≈ 0.65 s). The node list already paints from disk
// (storage.ts sessions cache); the board and a conversation opened after a cold start showed a
// spinner until the hub answered. Now they paint last-known data at once and the live read
// replaces it — exactly the sessions-cache pattern.
//
// Rules:
//   * Cached data is only ever a first paint. Every live read replaces it; nothing is written
//     back to the hub from it.
//   * Per account (storage.ts scopes files by profile) and per network (checked here) — one
//     network's cards / messages never paint under another.
//   * Only hub rows are cached. Local echoes, pending / failed sends and attachment previews
//     stay with the outbox (their own store) and are never written here.
//   * Best-effort both ways: a missing / corrupt / foreign cache is just "no cache".

// storage.ts is loaded lazily: it pulls expo-secure-store / expo-file-system, and the board and
// chat screens import this module. A screen (or a test of it) must never fail to load because
// the cache backend is unavailable — a cache that cannot load is simply no cache.
const storage = () => import('./storage');
import { boardSnapshotFor, historyFile, historyFor, historyWith, type BoardSnapshot, type HistoryFile } from './swr-cache-model';

type ChatRow = Record<string, unknown>;

const lastBoardWrite = new Map<string, string>();

/** Write the board if it changed since the last write for this account (polls mostly don't change it). */
export function rememberBoard(profileId: string | undefined, snapshot: Omit<BoardSnapshot, 'v'>): void {
  const body = JSON.stringify({ v: 1, ...snapshot });
  const key = profileId ?? '';
  if (lastBoardWrite.get(key) === body) return;
  lastBoardWrite.set(key, body);
  void storage().then(st => st.saveBoardCache(JSON.parse(body), profileId)).catch(() => {});
}

export async function recallBoard(profileId: string | undefined, networkId: string | undefined): Promise<BoardSnapshot | null> {
  try {
    return boardSnapshotFor(await (await storage()).loadBoardCache(profileId), networkId);
  } catch {
    return null;
  }
}

// One in-memory mirror per account; writes are debounced (a chat polls every 5 s).
const mirrors = new Map<string, Promise<HistoryFile<ChatRow>>>();
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const WRITE_DELAY_MS = 2_000;

const mirror = (profileId: string | undefined) => {
  const k = profileId ?? '';
  let m = mirrors.get(k);
  if (!m) {
    m = storage().then(st => st.loadChatHistoryCache(profileId)).then(raw => historyFile<ChatRow>(raw), () => historyFile<ChatRow>(undefined));
    mirrors.set(k, m);
  }
  return m;
};

export async function recallConversation<T>(profileId: string | undefined, key: string): Promise<T[] | null> {
  return historyFor(await mirror(profileId), key) as T[] | null;
}

export function rememberConversation(profileId: string | undefined, key: string, messages: readonly ChatRow[]): void {
  const k = profileId ?? '';
  void mirror(profileId).then(file => {
    const next = historyWith(file, key, messages);
    mirrors.set(k, Promise.resolve(next));
    const t = pendingWrites.get(k);
    if (t) clearTimeout(t);
    pendingWrites.set(k, setTimeout(() => {
      pendingWrites.delete(k);
      void mirrors.get(k)?.then(async latest => (await storage()).saveChatHistoryCache(latest, profileId)).catch(() => {});
    }, WRITE_DELAY_MS));
  });
}

/** Test-only. */
export function __resetSwrCaches(): void {
  lastBoardWrite.clear();
  mirrors.clear();
  for (const t of pendingWrites.values()) clearTimeout(t);
  pendingWrites.clear();
}
