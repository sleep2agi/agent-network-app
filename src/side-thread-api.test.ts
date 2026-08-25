import { createSideThreadClient, createSideThreadRequestKey, decodeSideThreadRecord, SideThreadApiError, SIDE_THREAD_ENDPOINTS, subscribeSideThreadUpdates } from './side-thread-api';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const wireRecord = (overrides: Record<string, unknown> = {}) => ({
  sideChatId: 'sch_12345678',
  networkId: 'network-1',
  nodeId: 'node-1',
  ownerUserId: 'user-1',
  sourceThreadId: 'thread-main',
  boundary: { kind: 'through', turnId: 'turn-head' },
  prompt: 'owner-visible question',
  state: 'running',
  activeAttemptId: 'sat_12345678',
  attempts: [{ attemptId: 'sat_12345678', threadId: 'thread-side', turnId: 'turn-side', state: 'running', createdAt: 1, updatedAt: 2 }],
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const requests: Array<{ path: string; init?: RequestInit }> = [];
const client = createSideThreadClient(
  { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'network-1' },
  async (path, init) => {
    requests.push({ path, init });
    if (path.startsWith(SIDE_THREAD_ENDPOINTS.capability)) return {
      ok: true,
      capability: {
        supported: true,
        enabled: true,
        runtime: 'opaque-runtime',
        context: {
          networkId: 'network-1', nodeId: 'node-1', sourceThreadId: 'thread-main',
          boundary: { kind: 'through', turnId: 'turn-head' },
        },
      },
    };
    if (path.includes('bring-back')) return { ok: true, bringBack: { bringBackId: 'sbb_12345678', destinationTurnId: 'turn-destination' } };
    if (path === SIDE_THREAD_ENDPOINTS.collection && init?.method === 'POST') return { ok: true, sideThread: wireRecord() };
    if (path.startsWith(`${SIDE_THREAD_ENDPOINTS.collection}?`)) return { ok: true, sideThreads: [wireRecord()] };
    return { ok: true, sideThread: wireRecord() };
  },
);

const run = async () => {
  const capability = await client.capability('agent-a');
  check('capability 返回 runtime-neutral exact context', capability.supported && capability.context?.sourceThreadId === 'thread-main');
  const listed = await client.list('agent-a');
  check('owner projection 保留原问题', listed[0]?.prompt === 'owner-visible question');
  await client.create({
    requestKey: createSideThreadRequestKey(),
    networkId: 'network-1', nodeId: 'node-1', sourceThreadId: 'thread-main',
    boundary: { kind: 'through', turnId: 'turn-head' }, prompt: 'question',
  });
  const createBody = JSON.parse(String(requests.find(r => r.path === SIDE_THREAD_ENDPOINTS.collection && r.init?.method === 'POST')?.init?.body));
  check('create body 精确携带 PR2 domain contract', createBody.networkId === 'network-1' && createBody.nodeId === 'node-1' && createBody.sourceThreadId === 'thread-main' && createBody.boundary.turnId === 'turn-head');
  check('client 不接受 vendor 字段', !('runtime' in createBody) && !('vendor' in createBody));
  check('request key 可用于 Hub 幂等', /^app:create:[a-z0-9]+:[a-z0-9]+:[a-z0-9]+$/.test(createSideThreadRequestKey()));

  let missingPromptRejected = false;
  try { decodeSideThreadRecord(wireRecord({ prompt: undefined })); }
  catch (error) { missingPromptRejected = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_PROTOCOL_ERROR'; }
  check('缺 owner-readable prompt 的 projection fail closed', missingPromptRejected);

  let implicitCapabilityRejected = false;
  const malformed = createSideThreadClient(
    { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'network-1' },
    async () => ({ ok: true, capability: { runtime: 'codex' } }),
  );
  try { await malformed.capability('agent-a'); }
  catch (error) { implicitCapabilityRejected = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_PROTOCOL_ERROR'; }
  check('feature/capability 未明确开放时不猜测支持', implicitCapabilityRejected);

  const source = await import('node:fs').then(fs => fs.readFileSync('src/side-thread-api.ts', 'utf8'));
  check('SideThread client 没有普通 sendTask fallback', !source.includes('sendTask(') && !source.includes('/api/task'));

  let subscriptionCalls = 0;
  const stop = subscribeSideThreadUpdates(
    { list: async () => { subscriptionCalls += 1; return [decodeSideThreadRecord(wireRecord())]; } },
    'agent-a',
    () => {},
    () => {},
    5,
  );
  await new Promise(resolve => setTimeout(resolve, 18));
  stop();
  const callsAtStop = subscriptionCalls;
  await new Promise(resolve => setTimeout(resolve, 12));
  check('update subscription 可替换且关闭后停止', callsAtStop >= 1 && subscriptionCalls === callsAtStop);

  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
};

void run();
