// ck-style self-executing test (run by scripts/run-tests.mjs under bun). NOT bun:test.
import { readFileSync } from 'node:fs';
import type { HubScheduledTask } from './api';
import {
  DEFAULT_SCHEDULE_FILTER,
  SCHEDULE_FILTERS,
  countByStatus,
  describeInterval,
  describeMisfire,
  describeSchedule,
  describeWeekdays,
  emptyStateFor,
  filterChips,
  formatAbsolute,
  formatRelative,
  isMasterDetail,
  masterListWidth,
  reconcileSelection,
  runErrorText,
  runStatusMeta,
  scheduleRowModel,
  scheduleStatusMeta,
  sortSchedules,
  visibleSchedules,
} from './scheduled-view-model';

let passed = 0;
const ck = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) { console.error(`FAIL: ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); process.exit(1); }
  passed++;
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ck(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

// Fixed "now" built from LOCAL components so every expectation is timezone-independent.
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();
const at = (mins: number) => new Date(NOW + mins * 60000).toISOString();
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();

const mk = (over: Partial<HubScheduledTask>): HubScheduledTask => ({
  schedule_id: 's', network_id: 'net', name: '任务', target_node_id: 'n1', target_alias: '示例节点',
  task_content: '做点事', priority: 'normal', schedule: { type: 'interval', every_seconds: 3600 },
  timezone: 'Asia/Shanghai', misfire_policy: 'skip', status: 'active', next_run_at: null, last_run_at: null, revision: 1,
  ...over,
});

// ── status mapping ─────────────────────────────────────────────────────
eq('active → 进行中/running', scheduleStatusMeta('active'), { label: '进行中', tone: 'running' });
eq('paused → 已暂停/blocked', scheduleStatusMeta('paused'), { label: '已暂停', tone: 'blocked' });
eq('completed → 已完成/rest', scheduleStatusMeta('completed'), { label: '已完成', tone: 'rest' });
eq('cancelled → 已取消/rest', scheduleStatusMeta('cancelled'), { label: '已取消', tone: 'rest' });
eq('unknown status shown raw with a neutral tone (never the good side)', scheduleStatusMeta('archived'), { label: 'archived', tone: 'rest' });
ck('no English status label leaks for known statuses',
  SCHEDULE_FILTERS.every(s => !/[a-z]/i.test(scheduleStatusMeta(s).label)));
eq('run delivered', runStatusMeta('delivered'), { label: '已送达', tone: 'running' });
eq('run queued says the node is offline', runStatusMeta('queued'), { label: '排队中 · 节点离线', tone: 'blocked' });
eq('run skipped', runStatusMeta('skipped'), { label: '已跳过', tone: 'rest' });
eq('run failed', runStatusMeta('failed'), { label: '失败', tone: 'failed' });
eq('run unknown raw + neutral', runStatusMeta('weird'), { label: 'weird', tone: 'rest' });
eq('run error code → Chinese', runErrorText({ error_code: 'previous_run_active', error_message: null }), '上一次还没结束');
eq('run unknown error code shown raw', runErrorText({ error_code: 'x_y', error_message: 'm' }), 'x_y');
eq('run error message used when no code', runErrorText({ error_code: null, error_message: 'boom' }), 'boom');
eq('run no error → empty', runErrorText({ error_code: null, error_message: null }), '');

// ── filtering + counts ─────────────────────────────────────────────────
const items = [
  mk({ schedule_id: 'c1', name: '旧巡检', status: 'cancelled', last_run_at: at(-600) }),
  mk({ schedule_id: 'a1', name: '晨报', status: 'active', next_run_at: at(90) }),
  mk({ schedule_id: 'p1', name: '周报', status: 'paused', last_run_at: at(-60) }),
  mk({ schedule_id: 'a2', name: '新闻', status: 'active', next_run_at: at(3) }),
  mk({ schedule_id: 'c2', name: '清理', status: 'cancelled' }),
];
eq('counts per status', countByStatus(items), { active: 2, paused: 1, completed: 0, cancelled: 2 });
eq('counts ignore unknown statuses', countByStatus([{ status: 'weird' as any }]), { active: 0, paused: 0, completed: 0, cancelled: 0 });
eq('default filter is 进行中', DEFAULT_SCHEDULE_FILTER, 'active');
eq('default view hides cancelled and sorts by next run', visibleSchedules(items, DEFAULT_SCHEDULE_FILTER).map(r => r.schedule_id), ['a2', 'a1']);
eq('cancelled filter shows only cancelled', visibleSchedules(items, 'cancelled').map(r => r.schedule_id), ['c1', 'c2']);
eq('paused filter', visibleSchedules(items, 'paused').map(r => r.schedule_id), ['p1']);
const chips = filterChips(countByStatus(items), 'active');
eq('chips: completed hidden at 0; order and counts', chips.map(c => `${c.label}${c.count}${c.selected ? '*' : ''}`), ['进行中2*', '已暂停1', '已取消2']);
eq('chips: completed shown when it has rows', filterChips({ active: 0, paused: 0, completed: 1, cancelled: 0 }, 'active').map(c => c.status), ['active', 'paused', 'completed', 'cancelled']);
eq('chips: completed kept while selected even at 0', filterChips({ active: 0, paused: 0, completed: 0, cancelled: 0 }, 'completed').map(c => c.status), ['active', 'paused', 'completed', 'cancelled']);

// ── sorting ────────────────────────────────────────────────────────────
const unsorted = [
  mk({ schedule_id: 'x', name: '乙', next_run_at: null, last_run_at: null }),
  mk({ schedule_id: 'y', name: 'B', next_run_at: null, last_run_at: at(-5) }),
  mk({ schedule_id: 'z', name: 'C', next_run_at: at(600) }),
  mk({ schedule_id: 'w', name: 'D', next_run_at: at(5) }),
  mk({ schedule_id: 'v', name: 'E', next_run_at: null, last_run_at: at(-500) }),
  mk({ schedule_id: 'u', name: '甲', next_run_at: null, last_run_at: null }),
];
const frozen = unsorted.map(r => r.schedule_id).join();
eq('sort: next asc, then no-next by last desc, then name', sortSchedules(unsorted).map(r => r.schedule_id), ['w', 'z', 'y', 'v', 'u', 'x']);
eq('sort does not mutate its input', unsorted.map(r => r.schedule_id).join(), frozen);
eq('sort accepts SQLite UTC timestamps', sortSchedules([
  mk({ schedule_id: 'late', next_run_at: '2026-09-27 10:00:00' }),
  mk({ schedule_id: 'early', next_run_at: '2026-09-27 09:00:00' }),
]).map(r => r.schedule_id), ['early', 'late']);

// ── schedule → Chinese ─────────────────────────────────────────────────
eq('600s', describeInterval(600), '每 10 分钟');
eq('60s', describeInterval(60), '每分钟');
eq('3600s', describeInterval(3600), '每小时');
eq('7200s', describeInterval(7200), '每 2 小时');
eq('5400s stays in minutes', describeInterval(5400), '每 90 分钟');
eq('86400s', describeInterval(86400), '每天');
eq('172800s', describeInterval(172800), '每 2 天');
eq('604800s', describeInterval(604800), '每周');
eq('90s', describeInterval(90), '每 90 秒');
eq('0 is not a schedule', describeInterval(0), '间隔未知');
eq('weekdays 1,3,5', describeWeekdays([5, 1, 3]), '每周一、三、五');
eq('weekdays Mon–Fri', describeWeekdays([1, 2, 3, 4, 5]), '工作日');
eq('weekend', describeWeekdays([6, 0]), '周末');
eq('all seven', describeWeekdays([0, 1, 2, 3, 4, 5, 6]), '每天');
eq('Sunday sorts last (Monday-first)', describeWeekdays([0, 1]), '每周一、日');
eq('daily, same tz → no tz suffix', describeSchedule({ type: 'daily', time: '09:00' }, 'Asia/Shanghai', 'Asia/Shanghai', NOW), '每天 09:00');
eq('daily, other tz → tz suffix', describeSchedule({ type: 'daily', time: '09:00' }, 'UTC', 'Asia/Shanghai', NOW), '每天 09:00 (UTC)');
eq('weekly', describeSchedule({ type: 'weekly', time: '18:30', weekdays: [1, 2, 3, 4, 5] }, 'Asia/Shanghai', 'Asia/Shanghai', NOW), '工作日 18:30');
eq('interval', describeSchedule({ type: 'interval', every_seconds: 600 }, 'UTC', 'Asia/Shanghai', NOW), '每 10 分钟');
eq('once', describeSchedule({ type: 'once', run_at: local(2026, 9, 27, 9, 0) }, 'Asia/Shanghai', 'Asia/Shanghai', NOW), '单次 · 9月27日 09:00');
eq('misfire skip', describeMisfire('skip').short, '错过后跳过');
eq('misfire catch-up', describeMisfire('catch_up_once').short, '错过后补跑一次');
eq('misfire default (older hubs omit it) = catch-up', describeMisfire(undefined).short, '错过后补跑一次');
ck('misfire long text is plain words', describeMisfire('skip').long.includes('等下一次') && describeMisfire('catch_up_once').long.includes('最多补跑一次'));

// ── relative + absolute time ───────────────────────────────────────────
eq('+3 min', formatRelative(at(3), NOW), '3 分钟后');
eq('+59 min', formatRelative(at(59), NOW), '59 分钟后');
eq('+60 min → hours', formatRelative(at(60), NOW), '1 小时后');
eq('-2 h', formatRelative(at(-120), NOW), '2 小时前');
eq('+30 s', formatRelative(new Date(NOW + 30000).toISOString(), NOW), '即将');
eq('-10 s', formatRelative(new Date(NOW - 10000).toISOString(), NOW), '刚刚');
eq('+23 h', formatRelative(at(23 * 60 + 59), NOW), '23 小时后');
eq('+3 d', formatRelative(at(3 * 1440), NOW), '3 天后');
eq('-6 d', formatRelative(at(-6 * 1440 - 1), NOW), '6 天前');
eq('+10 d → absolute date', formatRelative(local(2026, 10, 6, 12, 0), NOW), '10月6日 12:00');
eq('missing → empty', formatRelative(null, NOW), '');
eq('garbage → empty', formatRelative('not a date', NOW), '');
eq('SQLite UTC string is parsed as UTC', formatRelative(new Date(NOW + 5 * 60000).toISOString().replace('T', ' ').slice(0, 19), NOW), '5 分钟后');
eq('absolute, same year', formatAbsolute(local(2026, 9, 27, 9, 5), NOW), '9月27日 09:05');
eq('absolute, other year', formatAbsolute(local(2027, 1, 2, 8, 0), NOW), '2027年1月2日 08:00');

// ── row model ──────────────────────────────────────────────────────────
const activeRow = scheduleRowModel(mk({ name: '晨报', next_run_at: at(3), last_run_at: at(-57), schedule: { type: 'interval', every_seconds: 600 } }), NOW, 'Asia/Shanghai');
eq('active row: next as relative', activeRow.when?.text, '下次 3 分钟后');
eq('active row: absolute kept for the detail', activeRow.when?.absolute, formatAbsolute(at(3), NOW));
eq('active row: schedule chip', activeRow.scheduleText, '每 10 分钟');
eq('active row: toggle on', activeRow.toggle, true);
eq('active row: Chinese status', activeRow.status.label, '进行中');
const pausedRow = scheduleRowModel(mk({ status: 'paused', next_run_at: at(30), last_run_at: at(-120) }), NOW);
eq('paused row: stale next_run_at is not shown; last run is', pausedRow.when?.text, '上次 2 小时前');
eq('paused row: toggle off', pausedRow.toggle, false);
eq('row with no next and no last draws no time at all', scheduleRowModel(mk({ status: 'active' }), NOW).when, null);
eq('cancelled row: no toggle', scheduleRowModel(mk({ status: 'cancelled' }), NOW).toggle, null);
eq('completed row: no toggle', scheduleRowModel(mk({ status: 'completed' }), NOW).toggle, null);
eq('row target is the alias', scheduleRowModel(mk({ target_alias: '节点乙' }), NOW).target, '节点乙');

// ── selection + layout ─────────────────────────────────────────────────
const vis = [{ schedule_id: 'a' }, { schedule_id: 'b' }];
eq('selection kept when visible', reconcileSelection(vis, 'b', true), 'b');
eq('wide: falls to first when selection filtered out', reconcileSelection(vis, 'zz', true), 'a');
eq('wide: first by default', reconcileSelection(vis, null, true), 'a');
eq('narrow: nothing selected by default (list first)', reconcileSelection(vis, null, false), null);
eq('narrow: filtered-out selection returns to the list', reconcileSelection(vis, 'zz', false), null);
eq('wide + empty list', reconcileSelection([], 'a', true), null);
ck('master-detail at 720', isMasterDetail(720));
ck('phone below 720', !isMasterDetail(719.5));
ck('390 phone is not master-detail', !isMasterDetail(390));
eq('list width at the 720 edge leaves room for the detail', masterListWidth(720), 340);
eq('list width on a 1128 pane', masterListWidth(1128), 429);
eq('list width capped', masterListWidth(2000), 440);

// ── empty states ───────────────────────────────────────────────────────
const empties = SCHEDULE_FILTERS.map(f => emptyStateFor(f, 3));
ck('each filter has its own empty title', new Set(empties.map(e => e.title)).size === SCHEDULE_FILTERS.length);
ck('empty 进行中 offers create', emptyStateFor('active', 3).showCreate);
ck('empty 已取消 does not offer create', !emptyStateFor('cancelled', 3).showCreate);
eq('no schedules at all → onboarding copy regardless of filter', emptyStateFor('cancelled', 0).title, '还没有定时任务');

// ── wiring (source) ────────────────────────────────────────────────────
const screen = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
const has = (label: string, needle: string) => ck(`wiring: ${label}`, screen.includes(needle), needle);
has('filter state starts at the default', 'useState<ScheduleStatus>(DEFAULT_SCHEDULE_FILTER)');
has('list = filtered + sorted', 'visibleSchedules(items, filter)');
has('chips come from counts', 'filterChips(counts, filter)');
has('counts from all items', 'countByStatus(items)');
has('rows use the row model', 'scheduleRowModel(row, now, DEVICE_TIMEZONE)');
has('row time only when present', '{vm.when ? <Text');
has('status pill uses the Chinese label', '<StatusPill label={vm.status.label} tone={vm.status.tone} />');
has('inline toggle only when the model allows it', '{vm.toggle !== null ? (');
has('toggle calls the pause/resume action', "onToggle={() => void act(row, 'toggle')}");
has('toggle action flips active⇄paused via the API', "setScheduledTaskStatus(cfg, row, row.status === 'active' ? 'paused' : 'active')");
has('master-detail from measured width', 'isMasterDetail(measuredWidth ?? windowWidth)');
has('list column gets a fixed width in master-detail', 'width: masterListWidth(measuredWidth ?? windowWidth)');
has('selection reconciled per filter', 'reconcileSelection(visible, selectedId, wide)');
has('phone detail replaces the list', '{!wide && selected ? detail : <>');
has('hardware back closes the phone detail', "BackHandler.addEventListener('hardwareBackPress', () => { setSelectedId(null); return true; })");
has('history is loaded for the selected schedule', 'fetchScheduledRuns(cfg, scheduleId)');
has('prompt is selectable', '<Text style={s.prompt} selectable>{row.task_content}</Text>');
has('detail actions gated by scheduledTaskActions', 'scheduledTaskActions(row.status)');
has('run-now action', "onAction(row, 'run')");
has('empty state per filter', 'emptyStateFor(filter, items.length)');
ck('wiring: raw status is never rendered as text', !screen.includes('>{row.status}<'));
ck('wiring: the old full-card history modal is gone', !screen.includes('HistoryModal'));
ck('wiring: old big subtitle is gone', !screen.includes('Hub 统一调度 · 节点离线自动排队'));

console.log(`scheduled view model: ${passed} checks passed`);
