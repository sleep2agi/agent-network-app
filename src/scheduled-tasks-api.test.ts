import {
  cancelScheduledTask,
  createScheduledTask,
  fetchScheduledRuns,
  fetchScheduledTasks,
  runScheduledTaskNow,
  setScheduledTaskStatus,
  type HubConfig,
  type HubScheduledTask,
} from './api';

let passed = 0;
const ck = (label: string, ok: boolean) => {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++; console.log(`PASS: ${label}`);
};

const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test', networkId: 'net_alpha' };
const calls: Array<{ url: string; init: RequestInit }> = [];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

(globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  if (url.includes('/runs?')) return response({ ok: true, runs: [] });
  if (url.endsWith('/api/scheduled-tasks?network_id=net_alpha')) return response({ ok: true, schedules: [] });
  if (url.includes('/run-now')) return response({ ok: true, taskId: 'task_1', status: 'delivered' }, 202);
  if (init.method === 'DELETE') return response({ ok: true, status: 'cancelled' });
  if (init.method === 'PATCH') return response({ ok: true, schedule: { schedule_id: 'sched_1', revision: 3, status: 'paused' } });
  return response({ ok: true, schedule: { schedule_id: 'sched_1', revision: 1 } }, 201);
};

await fetchScheduledTasks(cfg);
ck('list is network-scoped', calls.at(-1)!.url.endsWith('/api/scheduled-tasks?network_id=net_alpha'));

await createScheduledTask(cfg, {
  name: 'daily', target_node_id: 'n_1', task: 'report', priority: 'normal', timezone: 'Asia/Shanghai', schedule: { type: 'daily', time: '09:00' },
});
const create = calls.at(-1)!;
const createBody = JSON.parse(String(create.init.body));
ck('create uses POST', create.init.method === 'POST');
ck('create binds selected network', createBody.network_id === 'net_alpha');
ck('create sends stable node_id', createBody.target_node_id === 'n_1' && !('target_alias' in createBody));
ck('create preserves schedule and timezone', createBody.schedule.type === 'daily' && createBody.timezone === 'Asia/Shanghai');
ck('auth token stays in header, not body/url', (create.init.headers as any).Authorization === 'Bearer utok_test' && !create.url.includes('utok_test') && !JSON.stringify(createBody).includes('utok_test'));

const row = { schedule_id: 'sched_1', revision: 2, status: 'active' } as HubScheduledTask;
await setScheduledTaskStatus(cfg, row, 'paused');
const patch = calls.at(-1)!;
ck('pause uses optimistic revision', patch.init.method === 'PATCH' && JSON.parse(String(patch.init.body)).revision === 2);
await runScheduledTaskNow(cfg, row.schedule_id);
ck('run-now uses explicit action endpoint', calls.at(-1)!.url.includes('/sched_1/run-now?network_id=net_alpha'));
await fetchScheduledRuns(cfg, row.schedule_id);
ck('history is schedule and network scoped', calls.at(-1)!.url.includes('/sched_1/runs?limit=50&network_id=net_alpha'));
await cancelScheduledTask(cfg, row.schedule_id);
ck('cancel is soft-delete API verb', calls.at(-1)!.init.method === 'DELETE');

console.log(`scheduled tasks api: ${passed} checks passed`);
