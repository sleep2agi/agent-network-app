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

/**
 * The network segment sits *inside* the profile scope, so `clearScope` still
 * clears every network of a profile with one prefix match.
 *
 * Encoded, because an un-encoded id containing `::` could otherwise forge a
 * segment boundary and make two different networks share a key.
 */
const networkSegment = (networkId: string | null | undefined): string =>
  `net:${encodeURIComponent(networkId ?? '')}`;

/**
 * A conversation is identified by (profile-or-server, network, alias).
 *
 * The network belongs in the key for the same reason it belongs in the request
 * (#187): one alias can exist in two of the user's networks, and they are two
 * different conversations. Leaving it out means the cached messages of the
 * first are shown, instantly and with no loading state, under the second.
 */
export const conversationKey = (
  profileId: string | null | undefined,
  serverUrl: string,
  networkId: string | null | undefined,
  alias: string,
): string =>
  `${conversationScope(profileId, serverUrl)}::${networkSegment(networkId)}::${encodeURIComponent(alias)}`;

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
