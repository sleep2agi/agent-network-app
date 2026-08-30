import { readFileSync } from 'node:fs';
import {
  createUnreadPersistWriter,
  settleUnreadWrite,
  type UnreadPersistSnapshot,
} from './conversation-unread-persist';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

const snap = (revision: number, payload: string): UnreadPersistSnapshot => ({ revision, payload });

// --- rule 1: write errors propagate (this is the two-way-witnessed assertion)
{
  const writer = createUnreadPersistWriter({
    write: async () => { throw new Error('disk'); },
  });
  let rejected = false;
  try {
    await writer.persist(snap(1, 'a'));
  } catch {
    rejected = true;
  }
  check('write failure rejects persist (does not silent-resolve)', rejected);
  check('write failure keeps the snapshot pending', writer.peekPending()?.payload === 'a');
  check('write failure does not mark the revision succeeded', writer.lastSucceededRevision() === 0);
}

// --- rule 2: later poll retries the same snapshot
{
  let attempts = 0;
  const disk: unknown[] = [];
  const writer = createUnreadPersistWriter({
    write: async (s) => {
      attempts++;
      if (attempts === 1) throw new Error('disk');
      disk.push(s.payload);
    },
  });
  await writer.persist(snap(1, 'same')).then(() => {}, () => {});
  check('first failure leaves pending for retry', writer.peekPending()?.payload === 'same');
  await writer.retryPending();
  check('retry of the identical snapshot succeeds', disk[0] === 'same' && attempts === 2);
  check('successful retry clears pending', writer.peekPending() === null);
}

// --- rule 4: pure settle — old failure cannot re-dirty a newer success
{
  const r1 = snap(1, 'old');
  const r2 = snap(2, 'new');
  const afterNewOk = settleUnreadWrite({
    lastSucceededRevision: 2,
    pending: null,
    finished: r2,
    succeeded: true,
  });
  check('newer success records lastSucceededRevision', afterNewOk.lastSucceededRevision === 2 && afterNewOk.pending === null);

  const afterOldFail = settleUnreadWrite({
    lastSucceededRevision: 2,
    pending: null,
    finished: r1,
    succeeded: false,
  });
  check('old failure after newer success does not re-dirty pending', afterOldFail.pending === null);
  check('old failure after newer success does not rewind lastSucceededRevision', afterOldFail.lastSucceededRevision === 2);
}

// --- rule 4: serial writer — r1 held fail, r2 queued, final disk is r2
{
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const disk: string[] = [];
  const writer = createUnreadPersistWriter({
    write: async (s) => {
      if (s.revision === 1) {
        await firstGate;
        throw new Error('stale disk');
      }
      disk.push(String(s.payload));
    },
  });
  const p1 = writer.persist(snap(1, 'old'));
  await Promise.resolve();
  const p2 = writer.persist(snap(2, 'new'));
  releaseFirst?.();
  const r1 = await p1.then(() => 'ok' as const, () => 'rejected' as const);
  await p2;
  check('older persist still rejects', r1 === 'rejected');
  check('newer persist wins the disk', disk.length === 1 && disk[0] === 'new');
  check('pending is not the stale failed snapshot', writer.peekPending() === null);
  check('lastSucceededRevision is the newer snapshot', writer.lastSucceededRevision() === 2);
}

const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
check('AgentsScreen retries pending unread persist on every poll', agents.includes('retryUnreadPersistFromPoll'));
check('ChatScreen retries pending unread persist on every poll', chat.includes('retryUnreadPersistFromPoll'));

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
