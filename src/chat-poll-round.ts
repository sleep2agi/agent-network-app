import { CHAT_PAGE, HUB_MAX_LIMIT } from './chat-history-pages';

/** Per-conversation lock. Timer ticks join; explicit reads (e.g. after a send)
 * must observe a response started after the action, so wait their turn. */
export function createChatRounds(now = Date.now) {
  let flight: Promise<void> | undefined;
  let fullAt = now();
  let queuedReply: Promise<void> | undefined;
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
    // A reply may postdate the inbound snapshot of the flight we're waiting on.
    // Coalesce until the next read starts, not until it finishes.
    reply(read: () => Promise<void>) {
      return queuedReply ??= run(async () => { queuedReply = undefined; await read(); }, false);
    },
    tick(window: number, read: (limit: number) => Promise<void>, resumed = false) {
      return run(() => {
        const full = now() - fullAt >= 60_000;
        if (full) fullAt = now();
        return read(full ? Math.min(HUB_MAX_LIMIT, Math.max(CHAT_PAGE, window)) : CHAT_PAGE);
      }, !resumed);
    },
  };
}
