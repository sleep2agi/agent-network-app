import {
  cancelScheduledTask,
  createExternalScheduleEdit,
  createScheduledTask,
  fetchExternalScheduleEdits,
  fetchExternalSchedules,
  fetchScheduledRuns,
  fetchScheduledTasks,
  runScheduledTaskNow,
  ScheduledTaskError,
  setScheduledTaskStatus,
  updateScheduledTask,
  type HubConfig,
  type HubScheduledTask,
} from './api';
import { readFileSync } from 'node:fs';

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
  if (init.method === 'PATCH') {
    const body = JSON.parse(String(init.body || '{}'));
    if (body.name === 'conflict') return response({ ok: false, error: 'revision_conflict', current_revision: 8 }, 409);
    return response({ ok: true, schedule: { schedule_id: 'sched_1', revision: 3, status: 'paused' } });
  }
  return response({ ok: true, schedule: { schedule_id: 'sched_1', revision: 1 } }, 201);
};

await fetchScheduledTasks(cfg);
ck('list is network-scoped', calls.at(-1)!.url.endsWith('/api/scheduled-tasks?network_id=net_alpha'));

await createScheduledTask(cfg, {
  name: 'daily', target_node_id: 'n_1', task: 'report', priority: 'normal', timezone: 'Asia/Shanghai', schedule: { type: 'daily', time: '09:00' }, misfire_policy: 'skip',
});
const create = calls.at(-1)!;
const createBody = JSON.parse(String(create.init.body));
ck('create uses POST', create.init.method === 'POST');
ck('create binds selected network', createBody.network_id === 'net_alpha');
ck('create sends stable node_id', createBody.target_node_id === 'n_1' && !('target_alias' in createBody));
ck('create preserves schedule and timezone', createBody.schedule.type === 'daily' && createBody.timezone === 'Asia/Shanghai');
ck('create sends the selected misfire policy', createBody.misfire_policy === 'skip');
ck('auth token stays in header, not body/url', (create.init.headers as any).Authorization === 'Bearer utok_test' && !create.url.includes('utok_test') && !JSON.stringify(createBody).includes('utok_test'));

const row = { schedule_id: 'sched_1', revision: 2, status: 'active' } as HubScheduledTask;
await setScheduledTaskStatus(cfg, row, 'paused');
const patch = calls.at(-1)!;
ck('pause uses optimistic revision', patch.init.method === 'PATCH' && JSON.parse(String(patch.init.body)).revision === 2);
await updateScheduledTask(cfg, row, {
  name: 'edited', target_node_id: 'n_2', task: 'updated report', priority: 'high', timezone: 'America/New_York',
  schedule: { type: 'weekly', time: '01:30', weekdays: [1, 3] }, misfire_policy: 'catch_up_once',
});
const edit = calls.at(-1)!;
const editBody = JSON.parse(String(edit.init.body));
ck('full edit PATCH carries exact revision and every mutable field',
  edit.init.method === 'PATCH' && editBody.revision === 2 && editBody.name === 'edited' &&
  editBody.target_node_id === 'n_2' && editBody.task === 'updated report' && editBody.priority === 'high' &&
  editBody.timezone === 'America/New_York' && editBody.schedule.type === 'weekly' && editBody.misfire_policy === 'catch_up_once');
let conflict: unknown;
try {
  await updateScheduledTask(cfg, row, {
    name: 'conflict', target_node_id: 'n_2', task: 'stale', priority: 'normal', timezone: 'UTC',
    schedule: { type: 'interval', every_seconds: 60 }, misfire_policy: 'skip',
  });
} catch (error) { conflict = error; }
ck('409 preserves machine-readable revision conflict for refresh UX',
  conflict instanceof ScheduledTaskError && conflict.status === 409 && conflict.code === 'revision_conflict');
await runScheduledTaskNow(cfg, row.schedule_id);
ck('run-now uses explicit action endpoint', calls.at(-1)!.url.includes('/sched_1/run-now?network_id=net_alpha'));
await fetchScheduledRuns(cfg, row.schedule_id);
ck('history is schedule and network scoped', calls.at(-1)!.url.includes('/sched_1/runs?limit=50&network_id=net_alpha'));
await cancelScheduledTask(cfg, row.schedule_id);
ck('cancel is soft-delete API verb', calls.at(-1)!.init.method === 'DELETE');
const screen = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
ck('mobile form shows timezone and rejects empty weekly selection', screen.includes('每天 ${spec.time} · ${timezone}') && screen.includes("kind === 'weekly' && weekdays.length === 0"));
ck('mobile form exposes catch-up and skip policies and discloses the effective value',
  screen.includes("'catch_up_once'") && screen.includes("'skip'") && screen.includes('misfire_policy: misfirePolicy') && screen.includes('错过后补跑一次') && screen.includes('错过后跳过'));
ck('mobile cards edit only active or paused schedules and prefill every mutable field',
  screen.includes("setEditing(row); setShowForm(true)") && screen.includes("['active', 'paused'].includes(row.status)") &&
  ['setName(editing.name)', 'setTask(editing.task_content)', 'setTarget(editing.target_node_id)',
    'setPriority(editing.priority)', 'setTimezone(editing.timezone)', 'intervalFormValue'].every(value => screen.includes(value)));
ck('mobile edit uses full update API and refreshes authoritative data on revision conflict',
  screen.includes('if (editing) await updateScheduledTask') && screen.includes("e.code === 'revision_conflict'") &&
  screen.includes('已刷新最新内容，请重新编辑'));

// ── RFC-036 节点外部计划 ────────────────────────────────────────────────

const externalFetch = (globalThis as any).fetch;
(globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  if (url.includes('/api/status')) {
    return response({ sessions: [
      // 无快照的会话必须被跳过（分母:确实进入了响应）
      { alias: 'no-snapshot', node_id: 'n_bare', updated_at: '2026-08-10T01:00:00Z' },
      // 无 node_id 的纯会话代理也必须被跳过
      { alias: 'session-only', external_schedules: { observed_at: '2026-08-10T01:00:00Z', schedules: [] } },
      // 同一节点两条会话:取 updated_at 较新的那条快照
      { alias: 'worker-old', node_id: 'n_9', updated_at: '2026-08-09T00:00:00Z', external_schedules: { observed_at: '2026-08-09T00:00:00Z', schedules: [] } },
      { alias: 'worker', node_id: 'n_9', updated_at: '2026-08-10T02:00:00Z', external_schedules: {
        observed_at: '2026-08-10T02:00:00Z',
        schedules: [
          { id: 'cron.news', name: '新闻抓取', kind: 'cron', frequency: '*/30 * * * *', last_run_at: '2026-08-10T01:30:00Z', last_status: 'success', last_error: null, next_run_at: '2026-08-10T02:30:00Z', log_ref: null, enabled: true, editable: true, revision: 4 },
          { id: 'systemd.backup', name: '备份', kind: 'systemd', frequency: 'daily', last_run_at: null, last_status: 'unknown', last_error: null, next_run_at: null, log_ref: null, enabled: true },
        ],
      } },
    ] });
  }
  if (url.includes('/external-schedule-edits') && (init.method || 'GET') === 'GET') {
    return response({ ok: true, edits: [{ intent_id: 'sei_1', node_id: 'n_9', schedule_id: 'cron.news', base_revision: 4, patch: { enabled: false }, status: 'applied', expires_at: '', created_at: '', delivered_at: null, acked_at: null, result_revision: 5, error_code: null }] });
  }
  if (url.includes('/external-schedule-edits') && init.method === 'POST') {
    const body = JSON.parse(String(init.body || '{}'));
    if (body.base_revision === 3) return response({ ok: false, error: 'revision_conflict', current_revision: 4 }, 409);
    return response({ ok: true, intent: { intent_id: 'sei_2', status: 'pending' } }, 202);
  }
  return externalFetch(url, init);
};

const externalNodes = await fetchExternalSchedules(cfg);
ck('external fetch uses FULL status (light=1 strips the snapshot)',
  calls.at(-1)!.url.endsWith('/api/status?network_id=net_alpha') && !calls.at(-1)!.url.includes('light'));
ck('external rows dedupe per node keeping the newest snapshot and skip snapshotless/session-only rows',
  externalNodes.length === 1 && externalNodes[0].node_id === 'n_9' && externalNodes[0].alias === 'worker' &&
  externalNodes[0].observed_at === '2026-08-10T02:00:00Z' && externalNodes[0].schedules.length === 2);
ck('editable marker survives the projection (only managed cron rows carry it)',
  externalNodes[0].schedules[0].editable === true && externalNodes[0].schedules[0].revision === 4 &&
  externalNodes[0].schedules[1].editable === undefined);

await fetchExternalScheduleEdits(cfg, 'n_9');
ck('intent list is node and network scoped',
  calls.at(-1)!.url.endsWith('/api/nodes/n_9/external-schedule-edits?network_id=net_alpha'));

await createExternalScheduleEdit(cfg, 'n_9', { schedule_id: 'cron.news', base_revision: 4, patch: { enabled: false } });
const intentCall = calls.at(-1)!;
const intentBody = JSON.parse(String(intentCall.init.body));
ck('intent POST sends exactly the four contract keys (Hub exactKeys would reject extras)',
  intentCall.init.method === 'POST' &&
  Object.keys(intentBody).sort().join(',') === 'base_revision,network_id,patch,schedule_id' &&
  intentBody.network_id === 'net_alpha' && intentBody.base_revision === 4 && intentBody.patch.enabled === false);
ck('intent auth stays in header, not body/url',
  (intentCall.init.headers as any).Authorization === 'Bearer utok_test' && !intentCall.url.includes('utok_test') && !JSON.stringify(intentBody).includes('utok_test'));

let intentConflict: unknown;
try {
  await createExternalScheduleEdit(cfg, 'n_9', { schedule_id: 'cron.news', base_revision: 3, patch: { cron: '0 9 * * *' } });
} catch (error) { intentConflict = error; }
ck('stale base_revision surfaces machine-readable 409 for refresh UX',
  intentConflict instanceof ScheduledTaskError && intentConflict.status === 409 && intentConflict.code === 'revision_conflict');

const screen2 = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
ck('mobile screen gates edit actions on editable cron rows with a numeric revision',
  screen2.includes("sch.editable === true && sch.kind === 'cron' && typeof sch.revision === 'number'"));
ck('mobile cron input pre-validates the five-field shape and never sends commands',
  screen2.includes('looksLikeCron') && screen2.includes('分 时 日 月 周') && screen2.includes('绝不下发命令'));
ck('mobile surfaces intent lifecycle wording for every terminal state',
  ['待节点领取', '节点已领取', '已应用', '被节点拒绝', '已过期'].every(value => screen2.includes(value)));

console.log(`scheduled tasks api: ${passed} checks passed`);
