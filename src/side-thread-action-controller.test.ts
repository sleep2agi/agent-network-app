import { createSideThreadActionController } from './side-thread-action-controller';
import { SideThreadApiError, type SideThreadClient, type SideThreadRecord } from './side-thread-api';
import { sideThreadCardFromRecord, type SideThreadCard } from './side-thread-model';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const record = (overrides: Partial<SideThreadRecord> = {}): SideThreadRecord => ({
  sideThreadId: 'side-1', requestKey: 'create-key', networkId: 'net-1', nodeId: 'node-1', sourceThreadId: 'main-thread',
  boundary: { kind: 'through', turnId: 'main-turn' }, question: 'question', title: 'question', threadId: 'fork-thread',
  state: 'completed', activeAttemptId: 'attempt-1', capability: { runtime: 'codex' }, attachments: [{ fileId: 'file-1' }],
  attempts: [{ attemptId: 'attempt-1', requestKey: 'create-key', threadId: 'fork-thread', turnId: 'fork-turn', state: 'completed', result: 'answer', attachments: [{ fileId: 'file-1' }], broughtBack: false, createdAt: 1, updatedAt: 2 }],
  bringBacks: [], operations: [], createdAt: 1, updatedAt: 2, ...overrides,
});

const harness = (client: SideThreadActionControllerClient, initial = record()) => {
  let cards: SideThreadCard[] = [sideThreadCardFromRecord(initial)!];
  const errors: string[] = [];
  let generatedKeySequence = 0;
  const controller = createSideThreadActionController({
    client,
    getCards: () => cards,
    updateCards: update => { cards = update(cards); },
    setError: (_cardId, message) => { errors.push(message); },
    beginRequest: lane => lane,
    isCurrent: () => true,
    createRequestKey: action => `generated-${action}-${++generatedKeySequence}`,
  });
  return { controller, cards: () => cards, setCards: (next: SideThreadCard[]) => { cards = next; }, errors };
};

type SideThreadActionControllerClient = Pick<SideThreadClient, 'cancel' | 'retry' | 'archive' | 'bringBack' | 'get'>;
const unused = async (): Promise<never> => { throw new Error('unexpected client method'); };

const run = async () => {
  const cancelKeys: string[] = [];
  const ambiguousClient: SideThreadActionControllerClient = {
    cancel: async (_id, input) => { cancelKeys.push(input.requestKey); throw new SideThreadApiError('SIDE_THREAD_AMBIGUOUS', 'ACK lost'); },
    retry: unused, archive: unused, bringBack: unused, get: unused,
  };
  const ambiguous = harness(ambiguousClient, record({ state: 'running', attempts: [{ ...record().attempts[0]!, state: 'running', result: undefined }] }));
  await ambiguous.controller.run('side-1', 'cancel');
  const hydrated = record({
    state: 'running', updatedAt: 3,
    attempts: [{ ...record().attempts[0]!, state: 'running', result: undefined, updatedAt: 3 }],
    operations: [{ operationId: 'operation-1', kind: 'cancel', requestKey: cancelKeys[0]!, state: 'failed', createdAt: 2, updatedAt: 3 }],
  });
  ambiguous.setCards([sideThreadCardFromRecord(hydrated)!]);
  ambiguous.controller.reconcile(ambiguous.cards());
  await ambiguous.controller.run('side-1', 'cancel');
  check('ambiguous action 显式重试复用 authoritative requestKey', cancelKeys.length === 2 && cancelKeys[0] === 'generated-cancel-1' && cancelKeys[1] === cancelKeys[0]);

  let releaseFirst!: () => void;
  const firstDispatch = new Promise<void>(resolve => { releaseFirst = resolve; });
  let bringBackCalls = 0;
  let getCalls = 0;
  const authoritative = record({
    updatedAt: 4,
    bringBacks: [{ bringBackId: 'bring-1', attemptId: 'attempt-1', requestKey: 'generated-bring-back-1', destinationThreadId: 'main-thread', destinationTurnId: 'destination-turn', state: 'completed', broughtBack: true, createdAt: 3, updatedAt: 4, completedAt: 4 }],
  });
  const bringBackClient: SideThreadActionControllerClient = {
    cancel: unused, retry: unused, archive: unused,
    bringBack: async () => { bringBackCalls += 1; await firstDispatch; return { bringBackId: 'bring-1', destinationTurnId: 'destination-turn' }; },
    get: async () => { getCalls += 1; return authoritative; },
  };
  const bringBack = harness(bringBackClient);
  const first = bringBack.controller.run('side-1', 'bring-back');
  const second = bringBack.controller.run('side-1', 'bring-back');
  await Promise.resolve();
  check('同步 controller lock 阻止同 tick 双击二次 dispatch', bringBackCalls === 1 && bringBack.controller.isLocked('side-1', 'bring-back'));
  check('bring-back ACK 本身绝不投影为已带回', bringBack.cards()[0]?.broughtBack !== true && getCalls === 0);
  releaseFirst();
  await Promise.all([first, second]);
  check('bring-back 成功必须 GET authoritative projection 后才显示', getCalls === 1 && bringBack.cards()[0]?.broughtBack === true && bringBack.cards()[0]?.updatedAt === 4);

  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
};

void run();
