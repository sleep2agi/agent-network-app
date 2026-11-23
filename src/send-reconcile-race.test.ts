// 复现并锁定「对账竞态（load 被 loadSequenceRef 吞掉导致假未送达）」：
//
// 场景：发送超时/丢 ACK，实际 Hub 已落库。失败分支用 ChatScreen 的 load() 对账时，
// 只要对账期间 5s 轮询 / SSE 唤醒 / 第二条失败消息又触发了一次 load()，
// loadSequenceRef 自增 → 前一次 load 的 isCurrent() 变 false → onTasks 被跳过 →
// confirmedOutboxIds / outboxRemove 不执行 → shouldExposeSendFailure 看到条目仍在 outbox →
// 把实际已送达的消息误标为「未送达 · 点击重试」。
import { readFileSync } from 'node:fs';
import { createDashboardRequestId } from './api';
import { confirmedOutboxIds } from './chat-actions';
import { loadChatSources } from './chat-source-load';
import { __resetOutboxForTest, initOutbox, outboxAdd, outboxForAlias, outboxRemove } from './outbox';
import { reconcileOutboxForSend, shouldExposeSendFailure } from './send-reconciliation';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean, extra = '') => {
  total++;
  if (ok) {
    passed++;
    console.log(`PASS: ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    console.error(`FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
};

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

const ALIAS = '示例-A';

// ── 1. 复现旧模式：用带 loadSequenceRef 的 load() 做对账 → 并发 load 导致假未送达 ──
{
  __resetOutboxForTest();
  initOutbox(null, () => {});
  const id1 = createDashboardRequestId();
  outboxAdd({ id: id1, alias: ALIAS, content: '第一条消息', createdAt: Date.now(), state: 'pending' });

  let loadSequence = 0;
  const taskReads: Array<Deferred<{ tasks: Array<{ task_id: string; content: string; created_at: string; meta_json: string }> }>> = [];

  const simulatedChatLoad = async () => {
    const sequence = ++loadSequence;
    const isCurrent = () => sequence === loadSequence;
    const req = deferred<{ tasks: Array<{ task_id: string; content: string; created_at: string; meta_json: string }> }>();
    taskReads.push(req);
    await loadChatSources({
      tasks: () => req.promise,
      proactive: async () => ({ messages: [] }),
      isCurrent,
      onTasks: data => {
        const confirmed = new Set(confirmedOutboxIds(outboxForAlias(ALIAS), data.tasks));
        confirmed.forEach(outboxRemove);
      },
      onProactive: () => {},
    });
  };

  // 第 1 条发送超时后进入对账（load #1）
  const exposePromise = shouldExposeSendFailure(
    () => simulatedChatLoad(),
    () => outboxForAlias(ALIAS).some(entry => entry.id === id1),
  );
  // 紧接着 5s 轮询或第 2 条失败对账触发了 load #2，loadSequence 推进到 2
  const secondLoad = simulatedChatLoad();
  // load #1 先带着 Hub 已落库的记录返回
  taskReads[0].resolve({
    tasks: [{
      task_id: 'idem_committed_1',
      content: '第一条消息',
      created_at: new Date().toISOString(),
      meta_json: JSON.stringify({ source: 'dashboard-chat', client_request_id: id1 }),
    }],
  });
  const exposedByOldLoad = await exposePromise;
  taskReads[1].resolve({ tasks: [] });
  await secondLoad;

  ck('repro: old load()-based reconcile drops outbox confirmation when loadSequence advances (false undelivered)',
    exposedByOldLoad === true && outboxForAlias(ALIAS).some(e => e.id === id1));
}

// ── 2. 修复后：独立对账不被 loadSequenceRef 抢占，Hub 已收则绝不标红 ──
{
  __resetOutboxForTest();
  initOutbox(null, () => {});
  const id1 = createDashboardRequestId();
  outboxAdd({ id: id1, alias: ALIAS, content: '第一条消息', createdAt: Date.now(), state: 'pending' });

  let loadSequence = 0;
  let refreshTriggered = 0;
  const req = deferred<Array<{ task_id: string; content: string; created_at: string; meta_json: string }>>();

  const exposePromise = shouldExposeSendFailure(
    () => reconcileOutboxForSend({
      fetchRows: () => req.promise,
      pendingEntries: () => outboxForAlias(ALIAS),
      confirmIds: (entries, rows) => confirmedOutboxIds(entries, rows),
      removeOutbox: outboxRemove,
      onConfirmed: () => { refreshTriggered++; },
    }),
    () => outboxForAlias(ALIAS).some(entry => entry.id === id1),
  );

  // 并发轮询多次推进 loadSequence
  loadSequence += 3;
  req.resolve([{
    task_id: 'idem_committed_1',
    content: '第一条消息',
    created_at: new Date().toISOString(),
    meta_json: JSON.stringify({ source: 'dashboard-chat', client_request_id: id1 }),
  }]);

  const exposed = await exposePromise;
  ck('fixed: independent reconcile confirms outbox despite concurrent loadSequence bumps',
    loadSequence === 3 && exposed === false && !outboxForAlias(ALIAS).some(e => e.id === id1));
  ck('fixed: triggers UI refresh when Hub confirmed an ambiguous send', refreshTriggered === 1);
}

// ── 3. ChatScreen 接线断言：可见分支的 shouldExposeSendFailure 走 reconcileOutboxForSend，不再直接走 load() ──
{
  const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const start = chat.indexOf('const exposeFailure = await shouldExposeSendFailure(');
  const snippet = start >= 0 ? chat.slice(start, start + 500) : '';
  ck('ChatScreen uses reconcileOutboxForSend inside shouldExposeSendFailure instead of bare load()',
    snippet.includes('reconcileOutboxForSend(') && !snippet.includes('() => load(limitRef.current)'));
}

console.log(`\nsend-reconcile-race: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
