export interface ConversationSnapshot<T> {
  messages: T[];
}

const normalizeServerUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.split(/[?#]/, 1)[0].replace(/\/$/, '');
  }
};

export const conversationScope = (
  profileId: string | null | undefined,
  serverUrl: string,
): string => profileId ? `profile:${profileId}` : `server:${normalizeServerUrl(serverUrl)}`;

export const conversationKey = (
  profileId: string | null | undefined,
  serverUrl: string,
  alias: string,
): string => `${conversationScope(profileId, serverUrl)}::${encodeURIComponent(alias)}`;

/** Shared message cache only. Request ownership stays inside each ChatScreen. */
export const createConversationStore = <T>(maxEntries = 50) => {
  const cache = new Map<string, ConversationSnapshot<T>>();

  const touch = (key: string, value: ConversationSnapshot<T>) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
  };

  return {
    open(key: string): ConversationSnapshot<T> | null {
      const value = cache.get(key) ?? null;
      if (value) touch(key, value);
      return value;
    },

    put(key: string, messages: T[]): void {
      touch(key, { messages });
    },

    peek(key: string): ConversationSnapshot<T> | null {
      return cache.get(key) ?? null;
    },

    clearScope(scope: string): void {
      const prefix = `${scope}::`;
      for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
    },

    clear(): void {
      cache.clear();
    },

    size(): number {
      return cache.size;
    },
  };
};

export interface ConversationRequestToken {
  key: string;
  generation: number;
}

/** Per-screen request ownership. Separate windows must never invalidate each other. */
export const createConversationRequestGate = () => {
  let generation = 0;
  let current: ConversationRequestToken | null = null;
  return {
    open(key: string): ConversationRequestToken {
      current = { key, generation: ++generation };
      return current;
    },
    current(): ConversationRequestToken | null {
      return current;
    },
    isCurrent(token: ConversationRequestToken): boolean {
      return current === token;
    },
    close(token: ConversationRequestToken): void {
      if (current === token) current = null;
    },
  };
};

export type ConversationStore<T> = ReturnType<typeof createConversationStore<T>>;
