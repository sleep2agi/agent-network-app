import assert from 'node:assert/strict';
import { createChatRounds } from './chat-poll-round';

let now = 0;
const rounds = createChatRounds(() => now), sizes: number[] = [];
for (let tick = 1; tick <= 24; tick++) {
  now = tick * 5000;
  await rounds.tick(220, async n => { sizes.push(n); });
}
assert.deepEqual(sizes, [...Array(11).fill(30), 200, ...Array(11).fill(30), 200]);
// Slow outbound read: timer ticks share it. Resume waits then actually reads once.
let release!: () => void, calls = 0;
const slow = rounds.tick(200, async () => { calls++; await new Promise<void>(ok => { release = ok; }); });
const wake = rounds.tick(200, async () => { calls++; });
const resume = rounds.tick(200, async () => { calls++; }, true);
await Promise.resolve(); assert.equal(calls, 1); release();
await Promise.all([slow, wake, resume]); assert.equal(calls, 2);
console.log('PASS: fixed-page polls, minute calibration, single flight and resume');

// A reply after the inbound snapshot must not disappear into a slow outbound tail.
let reads = 0, unblock!: () => void, started!: () => void;
const startedReply = new Promise<void>(ok => { started = ok; });
const outbound = rounds.tick(30, async () => { await new Promise<void>(ok => { release = ok; }); });
await Promise.resolve();
const afterReply = () => rounds.reply(async () => {
  reads++; started(); await new Promise<void>(ok => { unblock = ok; });
});
const first = afterReply(); assert.equal(afterReply(), first); assert.equal(reads, 0);
release(); await startedReply; assert.equal(reads, 1);
const late = rounds.reply(async () => { reads++; });
assert.equal(reads, 1); unblock(); await Promise.all([outbound, first, late]); assert.equal(reads, 2);
