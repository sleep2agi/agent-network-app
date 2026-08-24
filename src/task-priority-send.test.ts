import { readFileSync } from 'node:fs';
import { sendTask, type HubConfig } from './api';
import {
  __resetOutboxForTest,
  initOutbox,
  outboxAdd,
  outboxForAlias,
  outboxMarkFailed,
  outboxMarkPending,
  type OutboxEntry,
} from './outbox';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const requests: Array<{ url: string; body: any }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
  return new Response(JSON.stringify({ ok: true, task_id: 'task-1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

try {
  const cfg: HubConfig = { serverUrl: 'https://hub.example', token: 'utok_test', networkId: 'net_1' };
  await sendTask(cfg, 'codex-tui', 'normal work');
  await sendTask(cfg, 'codex-tui', 'urgent work', undefined, 'high');
  await sendTask(cfg, 'codex-tui', 'urgent attachment', [{ type: 'file', file_id: 'f_1' }], 'high');

  check('normal send explicitly carries normal priority', requests[0].body.priority === 'normal');
  check('high send carries high priority', requests[1].body.priority === 'high');
  check('priority does not drop attachments', requests[2].body.priority === 'high' && requests[2].body.attachments?.[0]?.file_id === 'f_1');
  check('all sends stay network scoped', requests.every(request => request.body.network_id === 'net_1'));
} finally {
  globalThis.fetch = originalFetch;
}

let disk: OutboxEntry[] = [];
__resetOutboxForTest();
initOutbox([], all => { disk = structuredClone(all); });
outboxAdd({ id: 'urgent-1', alias: 'codex-tui', content: 'fix now', createdAt: 1, state: 'pending', priority: 'high' });
outboxMarkFailed('urgent-1');
outboxMarkPending('urgent-1', 2);
check('high priority survives failed-send retry lifecycle', disk[0]?.priority === 'high' && disk[0]?.state === 'pending');

__resetOutboxForTest();
initOutbox(disk, () => {});
check('high priority survives process-style restoration', outboxForAlias('codex-tui')[0]?.priority === 'high');
check('old entries without priority remain backward-compatible', (() => {
  __resetOutboxForTest();
  initOutbox([{ id: 'old', alias: 'codex-tui', content: 'old', createdAt: 1, state: 'failed' }], () => {});
  return outboxForAlias('codex-tui')[0]?.priority === undefined;
})());

const screen = readFileSync('src/ChatScreen.tsx', 'utf8').replace(/\r\n?/g, '\n');
check('desktop and mobile both expose the priority control', (screen.match(/accessibilityLabel=\{sendPriority === 'high'/g) ?? []).length === 2);
check('submit records priority before the network attempt', screen.indexOf('outboxAdd({ id: localId') < screen.indexOf('doSend(content, localId, imgs, priority)'));
check('retry recovers stored priority', screen.includes("outboxForAlias(alias).find(e => e.id === item._localId)?.priority ?? 'normal'"));
check('the UI resets the next send to normal', screen.includes("setSendPriority('normal')"));

console.log(`task priority send: ${passed}/${total} checks passed`);
