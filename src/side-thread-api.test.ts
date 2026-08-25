import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createSideThreadClient, createSideThreadRequestKey, decodeSideThreadRecord, SideThreadApiError, SIDE_THREAD_ENDPOINTS, subscribeSideThreadUpdates } from './side-thread-api';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const golden = JSON.parse(fs.readFileSync('tests/test-btw-side-thread-ui/fixtures/golden.json', 'utf8'));
const goldenRecord = golden.sideThreadEnvelope.sideThread;
const scope = { sourceThreadId: 'source_thread', boundary: { kind: 'through' as const, turnId: 'source_turn' } };
const requests: Array<{ path: string; init?: RequestInit }> = [];
const client = createSideThreadClient(
  { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'net_a' },
  async (path, init) => {
    requests.push({ path, init });
    if (path.startsWith(SIDE_THREAD_ENDPOINTS.capability)) return golden.capabilityResponse;
    if (path.includes('bring-back')) return golden.bringBackResponse;
    if (path === SIDE_THREAD_ENDPOINTS.collection && init?.method === 'POST') return golden.sideThreadEnvelope;
    if (path.startsWith(`${SIDE_THREAD_ENDPOINTS.collection}?`)) return { ok: true, sideThreads: [goldenRecord], count: 1 };
    return golden.sideThreadEnvelope;
  },
);

const run = async () => {
  const digest = (path: string) => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  check('PR2 exact schema fixture 未漂移', digest('tests/test-btw-side-thread-ui/fixtures/schema.json') === '0a520e7173727bbcdf7b9220b114a42b41ebb6db0cfc73828bef9888473882ff');
  check('PR2 exact golden fixture 未漂移', digest('tests/test-btw-side-thread-ui/fixtures/golden.json') === 'de2387b61d2aab52cfe537ae38bd2671b31ddcadc33d87623f55ffafdd0e975b');
  const decoded = decodeSideThreadRecord(goldenRecord);
  check('PR2 shared golden 解码且只认 public identity/question', decoded.sideThreadId === 'sth_1' && decoded.question === 'Original question' && !('ownerUserId' in decoded));
  check('nested capability/attempt/attachments/operations 完整解码', decoded.capability.runtime === 'codex' && decoded.attempts[0]?.requestKey === 'create-request-0001' && decoded.attempts[0]?.attachments[0]?.fileId === 'file_ref_0001' && decoded.operations.length === 2);
  check('canonical null optional fields 被省略而非协议失败', decoded.attempts[0]?.parentAttemptId === undefined && decoded.operations[0]?.turnId === undefined);

  const capability = await client.capability('node-a', scope);
  check('capability 返回 native exact context', capability.mode === 'native-exact-fork' && capability.context?.sourceThreadId === 'source_thread');
  const capabilityUrl = new URL(`https://hub.invalid${requests[0]!.path}`);
  check('capability query 携带完整 scope', capabilityUrl.searchParams.get('alias') === 'node-a' && capabilityUrl.searchParams.get('networkId') === 'net_a' && capabilityUrl.searchParams.get('sourceThreadId') === 'source_thread' && capabilityUrl.searchParams.get('boundaryKind') === 'through' && capabilityUrl.searchParams.get('boundaryTurnId') === 'source_turn');

  const listed = await client.list('node-a');
  check('owner projection 跨窗口保留 authoritative question', listed[0]?.question === 'Original question');
  await client.create(golden.requests.create);
  const createBody = JSON.parse(String(requests.find(request => request.path === SIDE_THREAD_ENDPOINTS.collection && request.init?.method === 'POST')?.init?.body));
  check('create body 与 PR2 golden question/attachments 一致', createBody.question === 'Original question' && createBody.attachments[0]?.fileId === 'file_ref_0001' && !('prompt' in createBody));
  check('client 不接受 runtime/vendor 自断言', !('runtime' in createBody) && !('vendor' in createBody));
  check('request key 可用于 Hub 幂等', /^app:create:[a-z0-9]+:[a-z0-9]+:[a-z0-9]+$/.test(createSideThreadRequestKey()));

  let missingQuestionRejected = false;
  try { decodeSideThreadRecord({ ...goldenRecord, question: null }); }
  catch (error) { missingQuestionRejected = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_PROTOCOL_ERROR'; }
  check('非 purged 缺 question fail closed', missingQuestionRejected);
  const purged = decodeSideThreadRecord({ ...goldenRecord, state: 'purged', question: '', title: '', attachments: [] });
  check('purged tombstone 先识别并允许空 question', purged.state === 'purged' && purged.question === '');

  let missingOperationsRejected = false;
  try { decodeSideThreadRecord({ ...goldenRecord, operations: undefined }); }
  catch (error) { missingOperationsRejected = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_PROTOCOL_ERROR'; }
  check('缺 operations projection fail closed', missingOperationsRejected);

  const correlated = createSideThreadClient(
    { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'net_a' },
    async () => { throw new SideThreadApiError('SIDE_THREAD_AMBIGUOUS', 'ambiguous', 502, 'sop_start', 'sth_1', 'sat_1'); },
  );
  let correlationPreserved = false;
  try { await correlated.retry('sth_1', golden.requests.retry); }
  catch (error) { correlationPreserved = error instanceof SideThreadApiError && error.operationId === 'sop_start' && error.sideThreadId === 'sth_1' && error.attemptId === 'sat_1'; }
  check('Hub ambiguous error correlation 原样保留', correlationPreserved);

  const ackLossBodies: string[] = [];
  const ackLoss = createSideThreadClient(
    { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'net_a' },
    async (_path, init) => {
      ackLossBodies.push(String(init?.body));
      throw new SideThreadApiError('SIDE_THREAD_NETWORK_ERROR', 'socket closed');
    },
  );
  const ackLossCalls: Array<() => Promise<unknown>> = [
    () => ackLoss.create(golden.requests.create),
    () => ackLoss.cancel('sth_1', golden.requests.cancel),
    () => ackLoss.retry('sth_1', golden.requests.retry),
    () => ackLoss.archive('sth_1', golden.requests.archive),
    () => ackLoss.purge('sth_1', golden.requests.purge),
    () => ackLoss.bringBack('sth_1', golden.requests.bringBack),
  ];
  let ambiguousWrites = 0;
  for (const call of ackLossCalls) {
    try { await call(); }
    catch (error) { if (error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_AMBIGUOUS') ambiguousWrites += 1; }
  }
  check('六类 POST dispatch 后 ACK loss 一律 ambiguous', ambiguousWrites === ackLossCalls.length);
  check('ACK loss 请求全部保留 caller requestKey', ackLossBodies.map(body => JSON.parse(body).requestKey).join(',') === [
    golden.requests.create.requestKey,
    golden.requests.cancel.requestKey,
    golden.requests.retry.requestKey,
    golden.requests.archive.requestKey,
    golden.requests.purge.requestKey,
    golden.requests.bringBack.requestKey,
  ].join(','));

  const incompleteWrite = createSideThreadClient(
    { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'net_a' },
    async () => ({ ok: true, sideThread: { ...goldenRecord, attachments: undefined } }),
  );
  let incompleteProjectionAmbiguous = false;
  try { await incompleteWrite.create(golden.requests.create); }
  catch (error) { incompleteProjectionAmbiguous = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_AMBIGUOUS'; }
  check('POST ACK 缺附件projection不冒充失败/成功而进入对账', incompleteProjectionAmbiguous);

  let implicitCapabilityRejected = false;
  const malformed = createSideThreadClient(
    { serverUrl: 'https://hub.invalid', token: 'secret', networkId: 'net_a' },
    async () => ({ ok: true, capability: { runtime: 'codex' } }),
  );
  try { await malformed.capability('node-a', scope); }
  catch (error) { implicitCapabilityRejected = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_PROTOCOL_ERROR'; }
  check('feature/capability 未明确开放时不猜测支持', implicitCapabilityRejected);

  const source = fs.readFileSync('src/side-thread-api.ts', 'utf8');
  check('SideThread client 没有普通 sendTask fallback', !source.includes('sendTask(') && !source.includes('/api/task'));

  let subscriptionCalls = 0;
  const stop = subscribeSideThreadUpdates(
    { list: async () => { subscriptionCalls += 1; return [decodeSideThreadRecord(goldenRecord)]; } },
    'node-a', () => {}, () => {}, 5,
  );
  await new Promise(resolve => setTimeout(resolve, 18));
  stop();
  const callsAtStop = subscriptionCalls;
  await new Promise(resolve => setTimeout(resolve, 12));
  check('update subscription 关闭后停止', callsAtStop >= 1 && subscriptionCalls === callsAtStop);

  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
};

void run();
