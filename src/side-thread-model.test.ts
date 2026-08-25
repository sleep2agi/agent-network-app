import type { SideThreadRecord } from './side-thread-api';
import { mergeSideThreadRecords, sideThreadActionAvailability, sideThreadCardFromRecord, upsertSideThreadRecord } from './side-thread-model';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const record = (id: string, prompt: string, state: SideThreadRecord['state'], updatedAt: number, result?: string): SideThreadRecord => ({
  sideChatId: id,
  networkId: 'network-1',
  nodeId: 'node-1',
  ownerUserId: 'user-1',
  sourceThreadId: 'main-thread',
  boundary: { kind: 'through', turnId: 'turn-head' },
  prompt,
  state,
  attempts: [{
    attemptId: `attempt-${id}`,
    threadId: `thread-${id}`,
    turnId: `turn-${id}`,
    state: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'cancelled' ? 'cancelled' : 'running',
    ...(result ? { result } : {}),
    createdAt: 1,
    updatedAt,
  }],
  createdAt: 1,
  updatedAt,
});

const initial = mergeSideThreadRecords([], [
  record('side-a', '问题 A', 'running', 10),
  record('side-b', '问题 B', 'running', 20),
]);
const bFirst = upsertSideThreadRecord(initial, record('side-b', '问题 B', 'completed', 30, '答案 B'));
const aSecond = upsertSideThreadRecord(bFirst, record('side-a', '问题 A', 'completed', 40, '答案 A'));
check('双 BTW 乱序完成不串 question/result', aSecond.find(x => x.id === 'side-a')?.result === '答案 A' && aSecond.find(x => x.id === 'side-b')?.result === '答案 B');
check('completed 映射为 succeeded', sideThreadCardFromRecord(record('side-a', 'A', 'completed', 3, 'ok'))?.state === 'succeeded');
check('迟到旧快照不能回退状态', upsertSideThreadRecord(aSecond, record('side-a', '问题 A', 'running', 12)).find(x => x.id === 'side-a')?.state === 'succeeded');
check('purged 从 drawer 移除', upsertSideThreadRecord(aSecond, record('side-a', '问题 A', 'purged', 50)).some(x => x.id === 'side-a') === false);
check('失败卡允许 retry/archive', (() => {
  const card = sideThreadCardFromRecord(record('side-f', 'F', 'failed', 2));
  const actions = card && sideThreadActionAvailability(card);
  return !!actions?.retry && !!actions.archive && !actions.cancel && !actions.bringBack;
})());
check('只有有答案的 succeeded 可显式带回', (() => {
  const card = sideThreadCardFromRecord(record('side-s', 'S', 'completed', 2, 'answer'));
  return !!card && sideThreadActionAvailability(card).bringBack;
})());
const optimistic: ReturnType<typeof sideThreadCardFromRecord> = {
  id: 'pending:app:create:test', prompt: '正在创建的问题', state: 'creating',
  sourceThreadId: 'main-thread', createdAt: 50, updatedAt: 50,
};
check('并发 list 不会删掉尚未拿到 Hub id 的 creating card', mergeSideThreadRecords([optimistic!], []).some(card => card.id === optimistic!.id));

// Close/reopen consumes an owner-authorized Hub projection; no client-only
// question cache is needed to recover the same cards in another window.
const reopened = mergeSideThreadRecords([], [record('side-a', '问题 A', 'completed', 40, '答案 A'), record('side-b', '问题 B', 'completed', 30, '答案 B')]);
check('关闭重开由 Hub projection 恢复同一问题与答案', JSON.stringify(reopened.map(x => [x.id, x.prompt, x.result])) === JSON.stringify(aSecond.map(x => [x.id, x.prompt, x.result])));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
