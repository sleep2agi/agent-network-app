// 定时任务页的纯视图模型(Vincent 0.2.104 反馈「这个定时任务也挺难看的,重新设计一下」)。
//
// 旧页面把每条计划画成一张大卡片、状态用英文 `cancelled`、已取消的排在最前,
// 真正在跑的计划被埋在下面。这里把「显示什么、按什么顺序、叫什么名字」全部收成
// 纯函数,屏幕只负责摆放 —— 这样筛选/计数/排序/中文文案/相对时间都能脱离设备测。

import type { HubExternalSchedule, HubExternalScheduleEditIntent, HubMisfirePolicy, HubNodeExternalSchedules, HubScheduledRun, HubScheduledTask, HubScheduleSpec } from './api';
import { parseHubTime } from './time';

export type ScheduleStatus = HubScheduledTask['status'];

/** 状态筛选:顺序即 chip 顺序;第一个是默认。 */
export const SCHEDULE_FILTERS: readonly ScheduleStatus[] = ['active', 'paused', 'completed', 'cancelled'];
/** 筛选:某一个状态,或「全部」(看板卡「定时任务筛选加『全部』」:第一个 chip,默认仍是「进行中」)。 */
export type ScheduleFilter = ScheduleStatus | 'all';
export const DEFAULT_SCHEDULE_FILTER: ScheduleFilter = 'active';

export type StatusTone = 'running' | 'blocked' | 'rest' | 'failed';

const STATUS_META: Record<ScheduleStatus, { label: string; tone: StatusTone }> = {
  active: { label: '进行中', tone: 'running' },
  paused: { label: '已暂停', tone: 'blocked' },
  completed: { label: '已完成', tone: 'rest' },
  cancelled: { label: '已取消', tone: 'rest' },
};

/** 计划状态 → 中文 + 语义色。不认识的状态原样显示、用中性色 —— 不往「正常」那边兜。 */
export function scheduleStatusMeta(status: string): { label: string; tone: StatusTone } {
  return (STATUS_META as Record<string, { label: string; tone: StatusTone }>)[status] ?? { label: status || '未知', tone: 'rest' };
}

const RUN_STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  delivered: { label: '已送达', tone: 'running' },
  queued: { label: '排队中 · 节点离线', tone: 'blocked' },
  pending: { label: '处理中', tone: 'blocked' },
  skipped: { label: '已跳过', tone: 'rest' },
  failed: { label: '失败', tone: 'failed' },
};

/** 执行记录状态(Hub scheduled_task_runs.status)→ 中文。未知值原样、中性色。 */
export function runStatusMeta(status: string): { label: string; tone: StatusTone } {
  return RUN_STATUS_META[status] ?? { label: status || '未知', tone: 'rest' };
}

const RUN_ERROR_TEXT: Record<string, string> = {
  previous_run_active: '上一次还没结束',
  target_node_not_found: '节点已不存在',
  target_not_active: '节点不可用',
};

export const runErrorText = (run: Pick<HubScheduledRun, 'error_code' | 'error_message'>): string =>
  run.error_code ? (RUN_ERROR_TEXT[run.error_code] ?? run.error_code) : (run.error_message ?? '');

export function countByStatus(items: readonly Pick<HubScheduledTask, 'status'>[]): Record<ScheduleStatus, number> {
  const counts: Record<ScheduleStatus, number> = { active: 0, paused: 0, completed: 0, cancelled: 0 };
  for (const item of items) if (item.status in counts) counts[item.status] += 1;
  return counts;
}

const timeOf = (raw?: string | null): number | null => {
  const d = parseHubTime(raw ?? undefined);
  return d ? d.getTime() : null;
};

/**
 * 排序:下次执行最早的在前;没有下次时间的(暂停/已结束)排在后面,
 * 其中最近执行过的在前;都没有就按名称。稳定,不改入参。
 */
export function sortSchedules<T extends Pick<HubScheduledTask, 'name' | 'next_run_at' | 'last_run_at' | 'schedule_id'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const an = timeOf(a.next_run_at); const bn = timeOf(b.next_run_at);
    if (an !== null && bn !== null && an !== bn) return an - bn;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    const al = timeOf(a.last_run_at); const bl = timeOf(b.last_run_at);
    if (al !== null && bl !== null && al !== bl) return bl - al;
    if (al !== null && bl === null) return -1;
    if (al === null && bl !== null) return 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN') || a.schedule_id.localeCompare(b.schedule_id);
  });
}

/** 「全部」里状态组的先后:进行中 → 已暂停 → (已完成)→ 已取消;不认识的状态排最后。 */
const statusRank = (status: string): number => {
  const i = (SCHEDULE_FILTERS as readonly string[]).indexOf(status);
  return i === -1 ? SCHEDULE_FILTERS.length : i;
};

export function visibleSchedules<T extends HubScheduledTask>(items: readonly T[], filter: ScheduleFilter): T[] {
  if (filter !== 'all') return sortSchedules(items.filter(item => item.status === filter));
  // 全部:按状态分组,组内沿用单个状态视图的顺序(sortSchedules)。每行仍画自己的状态 pill。
  const sorted = sortSchedules(items);
  return sorted
    .map((item, index) => ({ item, index }))
    .sort((a, b) => statusRank(a.item.status) - statusRank(b.item.status) || a.index - b.index)
    .map(x => x.item);
}

// ── 节点计划(RFC-036)的中文 —— 定时任务页和节点页「定时任务」分区共用 ──────────

export const EXTERNAL_KIND_LABEL: Record<HubExternalSchedule['kind'], string> = {
  cron: 'crontab', systemd: 'systemd', tmux: 'tmux', playwright: 'playwright', custom: '自定义',
};
export const EXTERNAL_STATUS_LABEL: Record<HubExternalSchedule['last_status'], string> = {
  success: '成功', failed: '失败', running: '运行中', unknown: '未知',
};
export const INTENT_STATUS_LABEL: Record<HubExternalScheduleEditIntent['status'], string> = {
  pending: '待节点领取', delivered: '节点已领取', applied: '已应用', rejected: '被节点拒绝', expired: '已过期',
};

// ── 计划 → 中文 ────────────────────────────────────────────────────────

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 固定间隔 → 「每 10 分钟」「每小时」「每 2 天」;除不尽的按最小单位说,不四舍五入。 */
export function describeInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '间隔未知';
  const say = (n: number, unit: string, one: string) => (n === 1 ? one : `每 ${n} ${unit}`);
  if (seconds % 604800 === 0) return say(seconds / 604800, '周', '每周');
  if (seconds % 86400 === 0) return say(seconds / 86400, '天', '每天');
  if (seconds % 3600 === 0) return say(seconds / 3600, '小时', '每小时');
  if (seconds % 60 === 0) return say(seconds / 60, '分钟', '每分钟');
  return say(seconds, '秒', '每秒');
}

/** 每周几 → 「每天」「工作日」「周末」「每周一、三、五」。 */
export function describeWeekdays(days: readonly number[]): string {
  const set = [...new Set(days)].filter(d => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (set.length === 7) return '每天';
  if (set.join() === '1,2,3,4,5') return '工作日';
  if (set.join() === '0,6') return '周末';
  // 按周一在前的中文习惯排:一 … 六、日
  const mondayFirst = [...set.filter(d => d !== 0), ...set.filter(d => d === 0)];
  return `每周${mondayFirst.map(d => WEEKDAY[d]).join('、')}`;
}

/** 绝对时间(设备本地):同年省略年份,「9月27日 09:00」。 */
export function formatAbsolute(raw?: string | null, nowMs: number = Date.now()): string {
  const d = parseHubTime(raw ?? undefined);
  if (!d) return '';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * 计划 → 自然中文。时区只有与设备时区不同时才附上(同一时区写出来是噪音;
 * 不同时区不写会让「每天 09:00」被误读成本地 9 点)。
 */
export function describeSchedule(spec: HubScheduleSpec, timezone: string, deviceTimezone?: string, nowMs: number = Date.now()): string {
  const tz = timezone && deviceTimezone && timezone !== deviceTimezone ? ` (${timezone})` : '';
  if (spec.type === 'once') return `单次 · ${formatAbsolute(spec.run_at, nowMs) || spec.run_at}`;
  if (spec.type === 'interval') return describeInterval(spec.every_seconds);
  if (spec.type === 'daily') return `每天 ${spec.time}${tz}`;
  if (spec.type === 'weekly') return `${describeWeekdays(spec.weekdays)} ${spec.time}${tz}`;
  return '未知计划';
}

/** 错过执行策略的白话说明(详情页用)。 */
export function describeMisfire(policy?: HubMisfirePolicy): { short: string; long: string } {
  return policy === 'skip'
    ? { short: '错过后跳过', long: 'Hub 停机或节点离线期间错过的执行不再补，直接等下一次。' }
    : { short: '错过后补跑一次', long: '恢复后最多补跑一次，不会把错过的每一次都补回来。' };
}

// ── 相对时间 ────────────────────────────────────────────────────────────

/** 「3 分钟后」「2 小时前」「明天 09:00」…;解析不了返回 ''。 */
export function formatRelative(raw?: string | null, nowMs: number = Date.now()): string {
  const d = parseHubTime(raw ?? undefined);
  if (!d) return '';
  const diff = d.getTime() - nowMs;
  const future = diff >= 0;
  const abs = Math.abs(diff);
  const min = Math.floor(abs / 60000);
  if (min < 1) return future ? '即将' : '刚刚';
  if (min < 60) return future ? `${min} 分钟后` : `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return future ? `${hours} 小时后` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return future ? `${days} 天后` : `${days} 天前`;
  return formatAbsolute(raw, nowMs);
}

// ── 列表行 ──────────────────────────────────────────────────────────────

export interface ScheduleRowModel {
  id: string;
  name: string;
  target: string;
  scheduleText: string;
  status: { label: string; tone: StatusTone };
  /** 行尾的时间提示;没有下次也没有上次时为 null —— 那一行不画「—」。 */
  when: { text: string; absolute: string } | null;
  /** 只有 active/paused 能切换;true = 开(进行中)。null = 不给开关。 */
  toggle: boolean | null;
}

export function scheduleRowModel(row: HubScheduledTask, nowMs: number = Date.now(), deviceTimezone?: string): ScheduleRowModel {
  const next = row.status === 'active' ? formatRelative(row.next_run_at, nowMs) : '';
  const last = formatRelative(row.last_run_at, nowMs);
  const when = next
    ? { text: `下次 ${next}`, absolute: formatAbsolute(row.next_run_at, nowMs) }
    : last
      ? { text: `上次 ${last}`, absolute: formatAbsolute(row.last_run_at, nowMs) }
      : null;
  return {
    id: row.schedule_id,
    name: row.name,
    target: row.target_alias,
    scheduleText: describeSchedule(row.schedule, row.timezone, deviceTimezone, nowMs),
    status: scheduleStatusMeta(row.status),
    when,
    toggle: row.status === 'active' ? true : row.status === 'paused' ? false : null,
  };
}

/** 选中项在当前筛选里还在就留着;不在了,宽屏落到第一条,窄屏回列表(null)。 */
export function reconcileSelection(visible: readonly Pick<HubScheduledTask, 'schedule_id'>[], selectedId: string | null, wide: boolean): string | null {
  if (selectedId && visible.some(item => item.schedule_id === selectedId)) return selectedId;
  return wide ? (visible[0]?.schedule_id ?? null) : null;
}

/** 宽度够放「列表 + 详情」时用双栏(Android 展开 / 桌面)。 */
export const SCHEDULE_MASTER_DETAIL_MIN_WIDTH = 720;
export const isMasterDetail = (width: number) => width >= SCHEDULE_MASTER_DETAIL_MIN_WIDTH;
/** 双栏时左侧列表宽:≈38%,夹在 340–440 之间(720 宽时右侧仍有 ≥ 380 给详情)。 */
export const masterListWidth = (width: number) => Math.round(Math.max(340, Math.min(440, width * 0.38)));

// ── 空状态 ──────────────────────────────────────────────────────────────

export function emptyStateFor(filter: ScheduleFilter, total: number, narrowed = false): { title: string; body: string; showCreate: boolean } {
  // 关键字 / 节点把列表滤空:不是「还没有计划」,不要引导去新建。
  if (narrowed && total === 0) return { title: '没有匹配的计划', body: '试试别的关键词，或换一个节点。', showCreate: false };
  if (total === 0 || filter === 'all') return { title: '还没有定时任务', body: '新建一个，由 Hub 按时发给节点；节点离线时自动排队。', showCreate: true };
  if (filter === 'active') return { title: '没有进行中的计划', body: '暂停的计划可以在「已暂停」里恢复，或者新建一个。', showCreate: true };
  if (filter === 'paused') return { title: '没有暂停的计划', body: '进行中的计划可以随时暂停，暂停后不会再触发。', showCreate: false };
  if (filter === 'completed') return { title: '没有已完成的计划', body: '单次计划执行完会出现在这里。', showCreate: false };
  return { title: '没有已取消的计划', body: '取消的计划会留在这里，方便查看执行记录。', showCreate: false };
}

/**
 * 筛选 chip:全部(第一个)/进行中/已暂停/已取消 常驻(带计数);「已完成」只有单次计划跑完才会有,
 * 计数为 0 且没选中时不占位。
 */
export function filterChips(counts: Record<ScheduleStatus, number>, current: ScheduleFilter): { status: ScheduleFilter; label: string; count: number; selected: boolean }[] {
  const byStatus = SCHEDULE_FILTERS
    .filter(status => status !== 'completed' || counts.completed > 0 || current === 'completed')
    .map(status => ({ status: status as ScheduleFilter, label: STATUS_META[status].label, count: counts[status], selected: status === current }));
  // 「全部 N」:N = 各状态之和(已完成为 0 时就是 进行中 + 已暂停 + 已取消)。
  const all = SCHEDULE_FILTERS.reduce((sum, status) => sum + counts[status], 0);
  return [{ status: 'all', label: '全部', count: all, selected: current === 'all' }, ...byStatus];
}

// ── 列表搜索 + 节点筛选(本地;Hub 的 scheduled-tasks 列表没有 search 参数)────────
//
// 关键字只对着标题(name)和任务内容(task_content)。执行节点是单独一维(target_node_id /
// target_alias),不混进搜索,这样「进行中 + 某个节点 + 一个词」可以叠在一起用。
// 节点计划没有 Hub 那种 status,启用/停用是快照上的 enabled;节点是上报快照的 node_id。

export interface ScheduleNodeOption {
  id: string;
  label: string;
  count: number;
}

export interface ScheduleTextScope {
  query?: string;
  /** 空 = 全部节点。Hub 计划用 target_node_id,节点计划用上报快照的 node_id。 */
  nodeId?: string;
}

/** 启用态筛选(节点计划)。Hub 计划的状态仍走 ScheduleFilter。 */
export type ExternalEnabledFilter = 'all' | 'enabled' | 'disabled';

export interface ExternalListScope extends ScheduleTextScope {
  enabled?: ExternalEnabledFilter;
}

const queryTerms = (query: string): string[] | null => {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return q.split(/\s+/);
};

const hayHits = (hay: string, query: string): boolean => {
  const terms = queryTerms(query);
  if (!terms) return true;
  const flat = hay.toLowerCase();
  return terms.every(term => flat.includes(term));
};

/** 标题或任务内容命中。多个词(空白分隔)要同时命中;大小写不敏感。空串 = 不过滤。 */
export function scheduleMatchesQuery(item: Pick<HubScheduledTask, 'name' | 'task_content'>, query: string): boolean {
  return hayHits(`${item.name}\n${item.task_content}`, query);
}

export function scopeNarrows(scope: ScheduleTextScope): boolean {
  return !!scope.query?.trim() || !!scope.nodeId;
}

/** 先按关键字和节点收窄,再交给 visibleSchedules 做状态筛选和排序。不改入参。 */
export function schedulesInScope<T extends Pick<HubScheduledTask, 'name' | 'task_content' | 'target_node_id'>>(
  items: readonly T[],
  scope: ScheduleTextScope,
): T[] {
  const nodeId = scope.nodeId ?? '';
  const query = scope.query ?? '';
  return items.filter(item => {
    if (nodeId && item.target_node_id !== nodeId) return false;
    return scheduleMatchesQuery(item, query);
  });
}

const byNodeLabel = (a: ScheduleNodeOption, b: ScheduleNodeOption) =>
  a.label.localeCompare(b.label, 'zh-Hans-CN') || a.id.localeCompare(b.id);

/** 列表里实际出现过的执行节点。没有 target_node_id 的计划不进选项(仍在「全部节点」里)。 */
export function scheduleNodeOptions(items: readonly Pick<HubScheduledTask, 'target_node_id' | 'target_alias'>[]): ScheduleNodeOption[] {
  const map = new Map<string, ScheduleNodeOption>();
  for (const item of items) {
    const id = item.target_node_id;
    if (!id) continue;
    const prev = map.get(id);
    if (prev) {
      prev.count += 1;
      if (item.target_alias) prev.label = item.target_alias;
    } else {
      map.set(id, { id, label: item.target_alias || id, count: 1 });
    }
  }
  return [...map.values()].sort(byNodeLabel);
}

export function reconcileNodeFilter(options: readonly Pick<ScheduleNodeOption, 'id'>[], nodeId: string): string {
  if (!nodeId) return '';
  return options.some(option => option.id === nodeId) ? nodeId : '';
}

export function nodeFilterLabel(options: readonly Pick<ScheduleNodeOption, 'id' | 'label'>[], nodeId: string): string {
  if (!nodeId) return '全部节点';
  return options.find(option => option.id === nodeId)?.label ?? '全部节点';
}

/** 节点选择器里的搜索。match 默认是子串;界面可传拼音匹配。 */
export function filterNodeOptions<T extends Pick<ScheduleNodeOption, 'id' | 'label'>>(
  options: readonly T[],
  query: string,
  match: (text: string, q: string) => boolean = (text, q) => text.toLowerCase().includes(q.trim().toLowerCase()),
): T[] {
  const q = query.trim();
  if (!q) return [...options];
  const needle = q.toLowerCase();
  return options.filter(option => match(option.label, q) || option.id.toLowerCase().includes(needle));
}

/** 节点计划的标题 / 内容:名称、频率,以及列表上跟频率写在一起的类型。 */
export function externalScheduleMatchesQuery(schedule: Pick<HubExternalSchedule, 'name' | 'frequency' | 'kind'>, query: string): boolean {
  const kind = EXTERNAL_KIND_LABEL[schedule.kind] ?? schedule.kind;
  return hayHits(`${schedule.name}\n${schedule.frequency}\n${kind}`, query);
}

export function externalNodeOptions(nodes: readonly Pick<HubNodeExternalSchedules, 'node_id' | 'alias' | 'schedules'>[]): ScheduleNodeOption[] {
  const opts: ScheduleNodeOption[] = [];
  for (const node of nodes) {
    if (!node.node_id) continue;
    opts.push({ id: node.node_id, label: node.alias || node.node_id, count: node.schedules.length });
  }
  return opts.sort(byNodeLabel);
}

/** 关键字 + 节点收窄后的计划(还没按启用态滤),给「全部 / 启用 / 停用」计数。 */
export function externalSchedulesMatching(
  nodes: readonly HubNodeExternalSchedules[],
  scope: ScheduleTextScope,
): HubExternalSchedule[] {
  const nodeId = scope.nodeId ?? '';
  const query = scope.query ?? '';
  const out: HubExternalSchedule[] = [];
  for (const node of nodes) {
    if (nodeId && node.node_id !== nodeId) continue;
    for (const schedule of node.schedules) {
      if (externalScheduleMatchesQuery(schedule, query)) out.push(schedule);
    }
  }
  return out;
}

const matchesEnabled = (enabled: boolean, filter: ExternalEnabledFilter): boolean => {
  if (filter === 'enabled') return enabled;
  if (filter === 'disabled') return !enabled;
  return true;
};

export function externalScopeActive(scope: ExternalListScope): boolean {
  return scopeNarrows(scope) || (!!scope.enabled && scope.enabled !== 'all');
}

/**
 * 节点计划列表。关键字或启用态把一个节点的计划滤光时,那张卡不留(免得写成「未上报」)。
 * 只按节点收窄、而该节点本来就没上报时,仍留空卡。不改入参。
 */
export function filterExternalNodes(nodes: readonly HubNodeExternalSchedules[], scope: ExternalListScope): HubNodeExternalSchedules[] {
  const nodeId = scope.nodeId ?? '';
  const query = scope.query ?? '';
  const enabled = scope.enabled ?? 'all';
  const textOrStatus = !!query.trim() || enabled !== 'all';
  const out: HubNodeExternalSchedules[] = [];
  for (const node of nodes) {
    if (nodeId && node.node_id !== nodeId) continue;
    const schedules = node.schedules.filter(schedule => matchesEnabled(schedule.enabled, enabled) && externalScheduleMatchesQuery(schedule, query));
    if (schedules.length === 0 && (textOrStatus || node.schedules.length > 0)) continue;
    out.push(schedules.length === node.schedules.length ? node : { ...node, schedules });
  }
  return out;
}

export function externalEnabledChips(
  schedules: readonly Pick<HubExternalSchedule, 'enabled'>[],
  current: ExternalEnabledFilter,
): { status: ExternalEnabledFilter; label: string; count: number; selected: boolean }[] {
  let on = 0;
  for (const schedule of schedules) if (schedule.enabled) on += 1;
  return [
    { status: 'all', label: '全部', count: schedules.length, selected: current === 'all' },
    { status: 'enabled', label: '启用', count: on, selected: current === 'enabled' },
    { status: 'disabled', label: '停用', count: schedules.length - on, selected: current === 'disabled' },
  ];
}

export function externalEmptyState(reportedNodes: number, narrowed: boolean): { title: string; body: string } {
  if (narrowed && reportedNodes > 0) return { title: '没有匹配的节点计划', body: '试试别的关键词，或清除节点和状态筛选。' };
  return { title: '暂无节点计划', body: '节点升级后会自动上报本机 crontab 等计划。' };
}
