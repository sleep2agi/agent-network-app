# Chat polling cadence and first paint (#1680)

`tests/test-chat-first-paint/drive.mjs:74` waits for a **newly started, still pending request in A**, before switching to B. It has already checked that both task and proactive rows were painted and that a partial failure retained them. A timeout here does not mean that B was waiting for A's lock.

With the fixture's 4 s task latency, inbound and outbound are serial. Including the outbound in the lock was correct, but feeding the combined ~8 s into the slow-link backoff scheduled the next read another ~16 s later. Before the lock change, the ~4 s primary reads set the due time at ~12 s from the start. The fix records when both primary sources settle, retains their backoff, credits time already spent waiting for outbound, then schedules after the lock releases. A long tail can use up the whole delay but cannot cause overlapping reads. Non-chat callers without a primary-settled marker retain their original delay.

Checks: `npm run typecheck`; `bun src/slow-link.test.ts` covers 4+4 seconds, failure backoff and a tail over the due time. The existing first-paint drive and its 9000 ms wait are unmodified. Browser checks use separate Expo web exports in Docker and local fixtures only.
