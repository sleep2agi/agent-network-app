// Switching agents shows the previous conversation's messages under the new
// agent's name for a moment.
//
// ChatScreen loads with `await fetchTasks(cfg, { to_name: alias })` and then
// calls setMessages unconditionally. The closure captured the alias it started
// with, but the state it writes belongs to the screen, which by then is showing
// someone else. Clearing on switch does not help: the late response arrives
// after the clear and refills the list under the new title.
//
// A cache alone would not fix it either — it would make the wrong content
// appear faster. What is needed is that a response can only be applied if it is
// still the one being waited for. That is what the token below is: `open`
// invalidates every request in flight, so an answer for A cannot land in C.
//
// No react-native import, so the behaviour can be driven directly by a test.

export interface ConversationSnapshot<T> {
  messages: T[];
  /** Restored when the conversation is reopened, so it does not jump to top. */
  scrollOffset: number;
  fetchedAt: number;
}

/** Identifies a request for one conversation, at one moment. */
export interface RequestToken {
  key: string;
  id: number;
}

export interface OpenResult<T> {
  /** Cached content, or null when this conversation has never been loaded. */
  snapshot: ConversationSnapshot<T> | null;
  token: RequestToken;
}

/**
 * Two hubs can host the same alias. Keying on the alias alone would show one
 * hub's conversation while connected to the other.
 */
export const conversationKey = (
  profileId: string | null | undefined,
  serverUrl: string,
  alias: string,
): string => `${profileId ?? serverUrl}::${alias}`;

export const createConversationStore = <T>(now: () => number = Date.now) => {
  const cache = new Map<string, ConversationSnapshot<T>>();
  let generation = 0;
  let activeKey: string | null = null;

  const snapshotFor = (key: string): ConversationSnapshot<T> => {
    const existing = cache.get(key);
    if (existing) return existing;
    const fresh: ConversationSnapshot<T> = { messages: [], scrollOffset: 0, fetchedAt: 0 };
    cache.set(key, fresh);
    return fresh;
  };

  return {
    /**
     * Make `key` the conversation being viewed.
     *
     * Every token handed out earlier stops being current here — that single
     * line is what stops a slow answer for A from landing in C.
     */
    open(key: string): OpenResult<T> {
      generation += 1;
      activeKey = key;
      const cached = cache.get(key) ?? null;
      return { snapshot: cached, token: { key, id: generation } };
    },

    /** Whether a token still describes the conversation being viewed. */
    isCurrent(token: RequestToken): boolean {
      return token.id === generation && token.key === activeKey;
    },

    /**
     * Apply a fetch result. Returns whether it was applied, so a caller can
     * tell "ignored because stale" from "applied" instead of assuming.
     *
     * A stale result is still cached against its own conversation — it is
     * correct data, just not for the screen — so returning to it is instant.
     */
    put(token: RequestToken, messages: T[]): boolean {
      const target = snapshotFor(token.key);
      target.messages = messages;
      target.fetchedAt = now();
      return this.isCurrent(token);
    },

    /** Local echo and realtime updates, addressed by conversation, never "current". */
    append(key: string, message: T): void {
      const target = snapshotFor(key);
      target.messages = [message, ...target.messages];
    },

    rememberScroll(key: string, offset: number): void {
      snapshotFor(key).scrollOffset = offset;
    },

    scrollOf(key: string): number {
      return cache.get(key)?.scrollOffset ?? 0;
    },

    /** Read without making it active — for assertions and for background refresh. */
    peek(key: string): ConversationSnapshot<T> | null {
      return cache.get(key) ?? null;
    },

    activeKey(): string | null {
      return activeKey;
    },

    /** True when the conversation has content to show immediately. */
    hasContent(key: string): boolean {
      const snapshot = cache.get(key);
      return !!snapshot && snapshot.messages.length > 0;
    },
  };
};

export type ConversationStore<T> = ReturnType<typeof createConversationStore<T>>;
