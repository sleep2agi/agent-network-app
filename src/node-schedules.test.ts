// ck-style self-executing test (run by scripts/run-tests.mjs under bun). NOT bun:test.
// 节点页「定时任务」分区:按 node_id 挑出这个节点的计划(Hub 计划 + 节点计划),行模型,以及接线。
import { readFileSync as readRaw } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import type { HubExternalSchedule, HubExternalScheduleEditIntent, HubNodeExternalSchedules, HubScheduledRun, HubScheduledTask } from './api';
import {
  NODE_PLAN_OWNER_HINT,
  NODE_PLAN_READ_ONLY_HINT,
  NODE_SCHEDULES_EMPTY,
  externalLastResult,
  externalSchedulesForNode,
  hubLastResult,
  hubSchedulesForNode,
  hubToggle,
  lastRunKey,
  nodePlanToggle,
  nodeScheduleRows,
} from './node-schedules';

let passed = 0;
const ck = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) { console.error(`FAIL: ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); process.exit(1); }
  passed++;
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ck(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

// 占位 id / alias,不用任何真实节点名。
const ME = 'node_fixture_a';
const OTHER = 'node_fixture_b';
const NOW = Date.parse('2026-09-27T04:00:00.000Z');

const sched = (over: Partial<HubScheduledTask>): HubScheduledTask => ({
  schedule_id: 'sched_x', network_id: 'net_fixture', name: '计划', target_node_id: ME, target_alias: 'fixture-a',
  task_content: '做点事', priority: 'normal', schedule: { type: 'daily', time: '09:00' }, timezone: 'Asia/Shanghai',
  status: 'active', next_run_at: '2026-09-27T06:00:00.000Z', last_run_at: null, revision: 1, ...over,
});
const ext = (over: Partial<HubExternalSchedule>): HubExternalSchedule => ({
  id: 'cron_x', name: '备份', kind: 'cron', frequency: '0 3 * * *', last_run_at: null, last_status: 'unknown', last_error: null,
  next_run_at: null, log_ref: null, enabled: true, ...over,
});
const run = (over: Partial<HubScheduledRun>): HubScheduledRun => ({
  run_id: 'srun_1', schedule_id: 'sched_x', scheduled_for: '2026-09-27T02:00:00.000Z', task_id: 'task_1', status: 'replied',
  error_code: null, error_message: null, created_at: '2026-09-27 02:00:00', completed_at: '2026-09-27 02:01:00', ...over,
});

// ── 按 node_id 过滤(不按 alias)───────────────────────────────────────────
const hubAll = [
  sched({ schedule_id: 'sched_mine', name: '我的巡检' }),
  sched({ schedule_id: 'sched_renamed', name: '改名前建的', target_alias: 'old-alias', next_run_at: '2026-09-27T07:00:00.000Z' }),            // alias 不同,node_id 相同 → 算我的
  sched({ schedule_id: 'sched_other', name: '别人的', target_node_id: OTHER, target_alias: 'fixture-a' }), // alias 撞了,node_id 不同 → 不算
  sched({ schedule_id: 'sched_other2', name: '别人的 2', target_node_id: OTHER, target_alias: 'fixture-b' }),
];
eq('hub:只收 target_node_id = 本节点(含 alias 已改名的)', hubSchedulesForNode(hubAll, ME).map(r => r.schedule_id), ['sched_mine', 'sched_renamed']);
ck('hub:alias 相同但 node_id 不同 → 排除', !hubSchedulesForNode(hubAll, ME).some(r => r.schedule_id === 'sched_other'));
eq('hub:另一个节点只看到它自己的', hubSchedulesForNode(hubAll, OTHER).map(r => r.schedule_id), ['sched_other', 'sched_other2']);
eq('hub:空 / null node_id 一条都不认', [hubSchedulesForNode(hubAll, '').length, hubSchedulesForNode(hubAll, null).length, hubSchedulesForNode([sched({ target_node_id: '' })], '').length], [0, 0, 0]);

const externalAll: HubNodeExternalSchedules[] = [
  { node_id: OTHER, alias: 'fixture-a', observed_at: '2026-09-27T03:00:00.000Z', schedules: [ext({ id: 'cron_other', name: '别人的 cron' })] },
  { node_id: ME, alias: 'fixture-a-renamed', observed_at: '2026-09-27T03:00:00.000Z', schedules: [
    ext({ id: 'cron_b', name: '清理日志', editable: true, revision: 3 }),
    ext({ id: 'sysd_a', name: '同步', kind: 'systemd', frequency: 'hourly', enabled: false }),
  ] },
];
eq('node:按 node_id 取快照(alias 不同也认)', externalSchedulesForNode(externalAll, ME)?.schedules.map(s => s.id), ['cron_b', 'sysd_a']);
eq('node:没上报过 → null', externalSchedulesForNode(externalAll, 'node_fixture_none'), null);
eq('node:空 node_id → null(不去撞 alias)', externalSchedulesForNode(externalAll, ''), null);

// ── 合成行:两个来源、带来源标签、排除别人的 ───────────────────────────────
const rows = nodeScheduleRows({ nodeId: ME, hub: hubAll, external: externalAll, nowMs: NOW, deviceTimezone: 'Asia/Shanghai' });
eq('两个来源都在,别的节点的一条都没有', rows.map(r => r.key), ['hub:sched_mine', 'hub:sched_renamed', 'node:cron_b', 'node:sysd_a']);
eq('来源标签', rows.map(r => r.sourceLabel), ['Hub 计划', 'Hub 计划', '节点计划', '节点计划']);
ck('行里没有别的节点的名字', !rows.some(r => r.name.startsWith('别人的')));
eq('另一个节点:只有它自己的(Hub + 节点计划)', nodeScheduleRows({ nodeId: OTHER, hub: hubAll, external: externalAll, nowMs: NOW }).map(r => r.key), ['hub:sched_other', 'hub:sched_other2', 'node:cron_other']);
eq('没有 node_id → 空表', nodeScheduleRows({ nodeId: null, hub: hubAll, external: externalAll, nowMs: NOW }), []);
eq('空态文案', NODE_SCHEDULES_EMPTY, '这个节点还没有定时任务');

// ── 行模型:频率 / 下次 / 上次 / 开关 ──────────────────────────────────────
const mine = rows[0];
eq('频率走 describeSchedule(同时区不附时区)', mine.frequency, '每天 09:00');
eq('跨时区附上时区', nodeScheduleRows({ nodeId: ME, hub: [sched({})], external: [], nowMs: NOW, deviceTimezone: 'UTC' })[0].frequency, '每天 09:00 (Asia/Shanghai)');
ck('下次:相对 + 绝对', mine.next.startsWith('下次 2 小时后 · ') && /\d+月\d+日 \d\d:\d\d$/.test(mine.next), mine.next);
eq('节点计划频率:crontab · 原样频率', rows[2].frequency, 'crontab · 0 3 * * *');
eq('节点计划 systemd', rows[3].frequency, 'systemd · hourly');
eq('停用的节点计划:下次说「已停用」', rows[3].next, '已停用');
eq('启用但没有下次时间:「暂无下次」', rows[2].next, '暂无下次');
eq('暂停的 Hub 计划:下次说「已暂停」', nodeScheduleRows({ nodeId: ME, hub: [sched({ status: 'paused' })], external: [], nowMs: NOW })[0].next, '已暂停');
eq('已取消的 Hub 计划:下次说「已取消」', nodeScheduleRows({ nodeId: ME, hub: [sched({ status: 'cancelled', next_run_at: null })], external: [], nowMs: NOW })[0].next, '已取消');
eq('排序同定时任务页:下次最早的在前,没下次的在后', nodeScheduleRows({ nodeId: ME, hub: [
  sched({ schedule_id: 'late', next_run_at: '2026-09-28T01:00:00.000Z' }),
  sched({ schedule_id: 'none', status: 'paused', next_run_at: null }),
  sched({ schedule_id: 'soon', next_run_at: '2026-09-27T04:30:00.000Z' }),
], external: [], nowMs: NOW }).map(r => r.scheduleId), ['soon', 'late', 'none']);

// 上次结果:与 #442 执行记录同一套映射
eq('上次:还没执行过 → null', mine.last, null);
eq('上次:replied → 已完成', hubLastResult(run({ status: 'replied' }))?.label, '已完成');
eq('上次:failed/expired/cancelled → 失败', ['failed', 'expired', 'cancelled'].map(st => hubLastResult(run({ status: st }))?.label), ['失败', '失败', '失败']);
eq('上次:delivered + 任务 running → 执行中', hubLastResult(run({ status: 'delivered', completed_at: null }), { status: 'running' })?.label, '执行中');
eq('上次:delivered 没读任务 → 已送达', hubLastResult(run({ status: 'delivered', completed_at: null }))?.label, '已送达');
eq('上次:skipped → 已跳过', hubLastResult(run({ status: 'skipped', task_id: null }))?.label, '已跳过');
eq('上次:没有 run → null', hubLastResult(null), null);
const withRun = nodeScheduleRows({ nodeId: ME, hub: [sched({ schedule_id: 'sched_mine' })], external: [], nowMs: NOW,
  lastRuns: { sched_mine: { run: run({ status: 'failed', error_code: 'task_failed' }) } } });
eq('行里带上次结果 + 色调', withRun[0].last, { label: '失败', tone: 'failed' });
eq('节点计划上次:success/failed/running', [externalLastResult(ext({ last_status: 'success' }))?.label, externalLastResult(ext({ last_status: 'failed' }))?.label, externalLastResult(ext({ last_status: 'running' }))?.label], ['已完成', '失败', '执行中']);
eq('节点计划上次:unknown 但跑过 → 未知(中性色,不往好的兜)', externalLastResult(ext({ last_status: 'unknown', last_run_at: '2026-09-27T03:00:00.000Z' })), { label: '未知', tone: 'rest' });
eq('节点计划上次:从没跑过 → null', externalLastResult(ext({})), null);

// 开关
eq('Hub active → 开、可按', hubToggle({ status: 'active' }), { value: true, disabled: false, hint: null });
eq('Hub paused → 关、可按', hubToggle({ status: 'paused' }), { value: false, disabled: false, hint: null });
ck('Hub 已结束 → 置灰并说明', hubToggle({ status: 'cancelled' }).disabled && hubToggle({ status: 'completed' }).hint === '已完成,不会再执行');
eq('托管 cron → 可按', rows[2].toggle, { value: true, disabled: false, hint: null });
eq('非托管(systemd)→ 置灰 + 只读说明', rows[3].toggle, { value: false, disabled: true, hint: NODE_PLAN_READ_ONLY_HINT });
eq('cron 但没有 editable → 置灰', nodePlanToggle(ext({ revision: 2 }), ME, {}).disabled, true);
eq('editable 但没有 revision → 置灰', nodePlanToggle(ext({ editable: true }), ME, {}).disabled, true);
eq('不是节点 owner(意向记录 403)→ 置灰 + owner 说明', nodePlanToggle(ext({ editable: true, revision: 3 }), ME, {}, true), { value: true, disabled: true, hint: NODE_PLAN_OWNER_HINT });
const intent = (over: Partial<HubExternalScheduleEditIntent>): HubExternalScheduleEditIntent => ({
  intent_id: 'i1', node_id: ME, schedule_id: 'cron_b', base_revision: 3, patch: { enabled: false }, status: 'pending',
  expires_at: '2026-09-27T05:00:00.000Z', created_at: '2026-09-27T03:59:00.000Z', delivered_at: null, acked_at: null, result_revision: null, error_code: null, ...over,
});
const pendingToggle = nodePlanToggle(ext({ id: 'cron_b', editable: true, revision: 3 }), ME, { [`${ME}:cron_b`]: intent({}) });
ck('意向在途 → 画成意向要的值(关)并置灰', pendingToggle.value === false && pendingToggle.disabled, pendingToggle);
ck('意向在途说明带状态和目标', pendingToggle.hint === '意向在途(待节点领取):等节点应用「停用」', pendingToggle.hint);
eq('别的节点同 id 的意向不影响我', nodePlanToggle(ext({ id: 'cron_b', editable: true, revision: 3 }), ME, { [`${OTHER}:cron_b`]: intent({ node_id: OTHER }) }).disabled, false);

eq('lastRunKey 跟 last_run_at / revision 变', [lastRunKey(sched({})), lastRunKey(sched({ last_run_at: '2026-09-27T02:00:00.000Z', revision: 2 }))], ['sched_x::1', 'sched_x:2026-09-27T02:00:00.000Z:2']);

// ── 接线(读源码;CRLF 规整,路径统一成 POSIX)──────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readRaw(join(here, name), 'utf8').replace(/\r\n?/g, '\n');
const posix = (p: string) => p.split(sep).join('/');
ck('collect: scans the src directory', posix(here).endsWith('/src'), posix(here));
const section = read('NodeSchedulesSection.tsx');
const page = read('NodeDetailScreen.tsx');
const screen = read('ScheduledTasksScreen.tsx');
const app = read('../App.tsx');
const has = (label: string, src: string, needle: string) => ck(`wiring: ${label}`, src.includes(needle), needle);
has('section reuses the schedules list API', section, 'fetchScheduledTasks(cfg)');
has('section reuses the node-plan API', section, 'fetchExternalSchedules(cfg)');
has('section filters by node_id', section, 'hubSchedulesForNode(scheduleData.schedules || [], nodeId)');
has('last run = runs?limit=1', section, 'fetchScheduledRuns(cfg, row.schedule_id, 1)');
has('hub toggle = the schedules screen PATCH', section, "setScheduledTaskStatus(cfg, target, target.status === 'active' ? 'paused' : 'active')");
has('node toggle = the RFC-036 edit intent', section, 'createExternalScheduleEdit(cfg, nodeId,');
has('loading state', section, 'testID="node-schedules-loading"');
has('error state offers retry', section, 'testID="node-schedules-retry"');
has('empty state + 新建', section, 'testID="node-schedules-empty-create"');
ck('ui-text: section takes Text from the wrapper, not react-native',
  section.includes("import { Text } from './ui-text'") && !/import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(section));
has('page renders the section', page, '<NodeSchedulesSection');
has('page: executor id is the authoritative node_id', page, 'node?.node_id ?? s.node_id ?? null');
has('page: 新建 in the section header', page, 'testID="node-schedules-create"');
has('page: rows open the schedules screen at that row', page, "{ kind: 'hub', scheduleId: row.scheduleId, seq: Date.now() }");
has('screen: create prefills the executor', screen, "setTarget(initialTarget ?? '')");
has('screen: hub focus switches the filter to the row\'s status', screen, 'if (row) { setFilter(row.status); setSelectedId(row.schedule_id); }');
ck('app: every node page that can navigate wires onOpenScheduled',
  app.split("onOpenScheduled={open => setScreen({ name: 'scheduled', open, back: screen })}").length - 1 === 7);
has('app: back from a node-page jump returns to that node page', app, "if (screen.name === 'scheduled' && screen.back) {");

console.log(`node schedules: ${passed} checks passed`);
