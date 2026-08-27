import type { SideThreadRecord } from './side-thread-api';
import { mergeSideThreadRecords, sideThreadActionAvailability, sideThreadCardFromRecord, upsertSideThreadRecord } from './side-thread-model';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const record = (id: string, question: string, state: SideThreadRecord['state'], updatedAt: number, result?: string): SideThreadRecord => ({
  sideThreadId: id,
  requestKey: `request-${id}`,
  networkId: 'network-1',
  nodeId: 'node-1',
  sourceThreadId: 'main-thread',
  boundary: { kind: 'through', turnId: 'turn-head' },
  question,
  title: question,
  state,
  capability: { runtime: 'codex' },
  attachments: [{ fileId: `file-${id}` }],
  attempts: [{
    attemptId: `attempt-${id}`,
    requestKey: `request-${id}`,
    threadId: `thread-${id}`,
    turnId: `turn-${id}`,
    state: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'cancelled' ? 'cancelled' : 'running',
    ...(result ? { result } : {}),
    attachments: [{ fileId: `file-${id}` }],
    broughtBack: false,
    createdAt: 1,
    updatedAt,
  }],
  bringBacks: [],
  operations: [],
  createdAt: 1,
  updatedAt,
});

const initial = mergeSideThreadRecords([], [record('side-a', '问题 A', 'running', 10), record('side-b', '问题 B', 'running', 20)]);
const bFirst = upsertSideThreadRecord(initial, record('side-b', '问题 B', 'completed', 30, '答案 B'));
const aSecond = upsertSideThreadRecord(bFirst, record('side-a', '问题 A', 'completed', 40, '答案 A'));
check('双 BTW 乱序完成不串 question/result', aSecond.find(card => card.id === 'side-a')?.result === '答案 A' && aSecond.find(card => card.id === 'side-b')?.result === '答案 B');
check('completed 映射为 succeeded', sideThreadCardFromRecord(record('side-a', 'A', 'completed', 3, 'ok'))?.state === 'succeeded');
check('迟到旧快照不能回退状态', upsertSideThreadRecord(aSecond, record('side-a', '问题 A', 'running', 12)).find(card => card.id === 'side-a')?.state === 'succeeded');
check('equal updatedAt terminal 胜过 running', upsertSideThreadRecord([sideThreadCardFromRecord(record('tie', 'tie', 'running', 50))!], record('tie', 'tie', 'completed', 50, 'done'))[0]?.state === 'succeeded');
check('equal updatedAt running 不能覆盖 terminal', upsertSideThreadRecord([sideThreadCardFromRecord(record('tie', 'tie', 'completed', 50, 'done'))!], record('tie', 'tie', 'running', 50))[0]?.state === 'succeeded');
check('purged tombstone 从 drawer 移除', upsertSideThreadRecord(aSecond, record('side-a', '', 'purged', 50)).some(card => card.id === 'side-a') === false);

check('失败卡允许 retry/archive 且 retry 保留 attachments', (() => {
  const card = sideThreadCardFromRecord(record('side-f', 'F', 'failed', 2));
  const actions = card && sideThreadActionAvailability(card);
  return !!actions?.retry && !!actions.archive && card?.attachments[0]?.fileId === 'file-side-f';
})());
check('只有有答案的 succeeded 可显式带回', (() => {
  const card = sideThreadCardFromRecord(record('side-s', 'S', 'completed', 2, 'answer'));
  return !!card && sideThreadActionAvailability(card).bringBack;
})());

const optimistic = {
  id: 'pending:app:create:test', requestKey: 'app:create:test', question: '正在创建的问题', attachments: [{ fileId: 'file-optimistic' }], state: 'reconciling' as const,
  sourceThreadId: 'main-thread', createdAt: 50, updatedAt: 50,
};
check('空 list 不删除 ACK-loss placeholder', mergeSideThreadRecords([optimistic], []).some(card => card.id === optimistic.id));
check('placeholder 不开放 retry/archive 新 requestKey', Object.values(sideThreadActionAvailability({ ...optimistic, state: 'failed' })).every(value => !value));
const matchedCreate = record('side-created', '正在创建的问题', 'running', 51);
matchedCreate.requestKey = 'app:create:test';
check('GET/list 用同 requestKey 替换 placeholder 不串卡', (() => {
  const merged = mergeSideThreadRecords([optimistic], [matchedCreate]);
  return merged.length === 1 && merged[0]?.id === 'side-created' && merged[0]?.attachments[0]?.fileId === 'file-side-created';
})());

const ambiguous = record('side-r', '待确认', 'running', 70);
ambiguous.operations = [{ operationId: 'op-r', kind: 'start', requestKey: 'retry-same-key', state: 'ambiguous', createdAt: 69, updatedAt: 70 }];
const reconciling = sideThreadCardFromRecord(ambiguous);
check('operation ambiguous hydrate 为 reconciling 且禁全部副作用', !!reconciling && reconciling.state === 'reconciling' && Object.values(sideThreadActionAvailability(reconciling)).every(value => !value));
const failedArchive = record('side-archive', '归档重试', 'completed', 72, 'done');
failedArchive.operations = [{ operationId: 'op-archive', kind: 'archive', requestKey: 'archive-same-key', state: 'failed', createdAt: 71, updatedAt: 72 }];
check('failed action hydrate 保留同 requestKey 供显式重试', sideThreadCardFromRecord(failedArchive)?.actionRequestKeys?.archive === 'archive-same-key');

const bringingBack = record('side-back-start', '带回中', 'completed', 80, 'answer');
bringingBack.bringBacks = [{ bringBackId: 'bb-start', attemptId: 'attempt-side-back-start', requestKey: 'bb-key', destinationThreadId: 'main-thread', state: 'starting', broughtBack: false, createdAt: 80, updatedAt: 80 }];
const bringingBackCard = sideThreadCardFromRecord(bringingBack);
check('bringBack starting hydrate 锁住 double tap', !!bringingBackCard?.bringingBack && !sideThreadActionAvailability(bringingBackCard).bringBack);

const broughtBack = record('side-back', '写回问题', 'completed', 90, '写回答案');
broughtBack.bringBacks = [{ bringBackId: 'bb-ok', attemptId: 'attempt-side-back', requestKey: 'bb-ok-key', destinationThreadId: 'main-thread', destinationTurnId: 'destination-turn', state: 'completed', broughtBack: true, createdAt: 89, updatedAt: 90, completedAt: 90 }];
check('只有 completed receipt 恢复 broughtBack', sideThreadCardFromRecord(broughtBack)?.broughtBack === true);

const reopened = mergeSideThreadRecords([], [record('side-a', '问题 A', 'completed', 40, '答案 A'), record('side-b', '问题 B', 'completed', 30, '答案 B')]);
check('关闭重开恢复同一 question/result', JSON.stringify(reopened.map(card => [card.id, card.question, card.result])) === JSON.stringify(aSecond.map(card => [card.id, card.question, card.result])));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
