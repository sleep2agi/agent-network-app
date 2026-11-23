import { CHAT_PAGE, HUB_MAX_LIMIT } from './chat-history-pages';

/** Per-conversation lock. Timer/SSE wakes join; explicit reads (e.g. after a send)
 * must observe a response started after the action, so wait their turn. */
export function createChatRounds(now = Date.now) {
  let flight: Promise<void> | undefined;
  let fullAt = now();
  async function run(read: () => Promise<void>, join: boolean): Promise<void> {
    while (flight) {
      if (join) return flight;
      await flight.catch(() => {});
    }
    const current = flight = Promise.resolve().then(read);
    try { await current; } finally { if (flight === current) flight = undefined; }
  }
  return {
    run,
    tick(window: number, read: (limit: number) => Promise<void>, resumed = false) {
      return run(() => {
        const full = now() - fullAt >= 60_000;
        if (full) fullAt = now();
        return read(full ? Math.min(HUB_MAX_LIMIT, Math.max(CHAT_PAGE, window)) : CHAT_PAGE);
      }, !resumed);
    },
  };
}
