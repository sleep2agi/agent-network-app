// 定时任务列表的搜索 + 节点筛选(Hub 计划 / 节点计划)。ck 风格,scripts/run-tests.mjs 直接跑。
import { readFileSync } from 'node:fs';
import type { HubExternalSchedule, HubNodeExternalSchedules, HubScheduledTask } from './api';
import {
  countByStatus,
  emptyStateFor,
  externalEmptyState,
  externalEnabledChips,
  externalNodeOptions,
  externalScheduleMatchesQuery,
  externalSchedulesMatching,
  externalScopeActive,
  filterExternalNodes,
  filterNodeOptions,
  nodeFilterLabel,
  reconcileNodeFilter,
  scheduleMatchesQuery,
  scheduleNodeOptions,
  schedulesInScope,
  scopeNarrows,
  visibleSchedules,
} from './scheduled-view-model';

let passed = 0;
const ck = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) { console.error(`FAIL: ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); process.exit(1); }
  passed++;
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ck(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

const mk = (over: Partial<HubScheduledTask>): HubScheduledTask => ({
  schedule_id: 's', network_id: 'net', name: '任务', target_node_id: 'n1', target_alias: '示例节点',
  task_content: '做点事', priority: 'normal', schedule: { type: 'interval', every_seconds: 3600 },
  timezone: 'Asia/Shanghai', misfire_policy: 'skip', status: 'active', next_run_at: null, last_run_at: null, revision: 1,
  ...over,
});

const ext = (over: Partial<HubExternalSchedule> = {}): HubExternalSchedule => ({
  id: 'cron_a', name: '备份', kind: 'cron', frequency: '0 3 * * *', last_run_at: null, last_status: 'unknown',
  last_error: null, next_run_at: null, log_ref: null, enabled: true, ...over,
});

const node = (over: Partial<HubNodeExternalSchedules> & Pick<HubNodeExternalSchedules, 'node_id' | 'alias'>): HubNodeExternalSchedules => ({
  observed_at: '2026-10-11T00:00:00.000Z', schedules: [], ...over,
});

// 截图里那一条:标题「更新最新的任务列表」,执行节点 TMA需求鲸,内容里有 Hub / TMAI。
const listed = mk({
  schedule_id: 'listed',
  name: '更新最新的任务列表',
  task_content: '全盘 review 一下 Hub 中 TMAI相关的所有任务的状态，更新下面里面的任务状态。',
  target_node_id: 'node-tma',
  target_alias: 'TMA需求鲸',
  status: 'active',
  next_run_at: '2026-10-11T01:00:00.000Z',
});
const sameTitleOtherNode = mk({
  schedule_id: 'paused-copy',
  name: '更新最新的任务列表',
  task_content: '另一台机器上的副本',
  target_node_id: 'node-dev',
  target_alias: 'daemon-dev',
  status: 'paused',
  last_run_at: '2026-10-10T01:00:00.000Z',
});
const otherActive = mk({
  schedule_id: 'weekly',
  name: '周报',
  task_content: '汇总本周',
  target_node_id: 'node-tma',
  target_alias: 'TMA需求鲸',
  status: 'active',
  next_run_at: '2026-10-12T01:00:00.000Z',
});
const cancelled = mk({
  schedule_id: 'old',
  name: '更新索引',
  task_content: '任务列表在附件里',
  target_node_id: 'node-tma',
  target_alias: 'TMA需求鲸',
  status: 'cancelled',
});
const noNode = mk({
  schedule_id: 'orphan',
  name: '未指定节点',
  task_content: '还没选执行节点',
  target_node_id: '',
  target_alias: '',
  status: 'active',
});
const items = [cancelled, listed, sameTitleOtherNode, otherActive, noNode];

// ── 关键字:标题 + 内容,不是节点别名 ─────────────────────────────────────
ck('整句标题命中', scheduleMatchesQuery(listed, '更新最新的任务列表'));
ck('首尾空白不影响', scheduleMatchesQuery(listed, '  更新最新的任务列表  '));
ck('标题里的一段命中', scheduleMatchesQuery(listed, '任务列表'));
ck('内容里的词命中(大小写不敏感)', scheduleMatchesQuery(listed, 'hub'));
ck('标题和内容各一个词,要同时命中', scheduleMatchesQuery(listed, '更新 review'));
ck('内容里的 TMAI 命中', scheduleMatchesQuery(listed, 'TMAI'));
ck('空串不过滤', scheduleMatchesQuery(listed, '   '));
ck('节点别名不在搜索范围', !scheduleMatchesQuery(listed, 'TMA需求鲸'));
ck('多个词有一个不在标题或内容里就不命中', !scheduleMatchesQuery(listed, '更新最新的任务列表 不存在'));
ck('只在别的计划里的词不命中', !scheduleMatchesQuery(listed, '周报'));

// ── 状态 × 节点 × 关键字 ────────────────────────────────────────────────
{
  const scoped = schedulesInScope(items, { query: '更新最新的任务列表', nodeId: 'node-tma' });
  eq('标题 + 节点:只留这个节点上的那一条', scoped.map(row => row.schedule_id), ['listed']);
  eq('再叠进行中', visibleSchedules(scoped, 'active').map(row => row.schedule_id), ['listed']);
  eq('同一范围里没有已暂停', visibleSchedules(scoped, 'paused').map(row => row.schedule_id), []);
  eq('状态计数跟着搜索和节点走,不是全表', countByStatus(scoped), { active: 1, paused: 0, completed: 0, cancelled: 0 });
  eq('换一个节点:同名计划的已暂停那条', visibleSchedules(schedulesInScope(items, { query: '更新最新的任务列表', nodeId: 'node-dev' }), 'paused').map(row => row.schedule_id), ['paused-copy']);
  eq('节点对了但状态不对 → 空', visibleSchedules(schedulesInScope(items, { query: '任务列表', nodeId: 'node-dev' }), 'active').map(row => row.schedule_id), []);
  // 「任务列表」同时在 listed 的标题和 cancelled 的内容里;进行中只留 listed,且下次更早的在前。
  eq('关键字 + 进行中,不带节点', visibleSchedules(schedulesInScope(items, { query: '任务列表' }), 'active').map(row => row.schedule_id), ['listed']);
  eq('全部:进行中在已取消前', visibleSchedules(schedulesInScope(items, { query: '任务列表', nodeId: 'node-tma' }), 'all').map(row => row.schedule_id), ['listed', 'old']);
  eq('不指定节点时,没有 node_id 的计划还在', schedulesInScope(items, { query: '未指定' }).map(row => row.schedule_id), ['orphan']);
  eq('指定节点后,没有 node_id 的计划不出现', schedulesInScope(items, { nodeId: 'node-tma' }).some(row => row.schedule_id === 'orphan'), false);
  const frozen = items.map(row => row.schedule_id).join();
  schedulesInScope(items, { query: '更新', nodeId: 'node-tma' });
  visibleSchedules(schedulesInScope(items, { query: '更新' }), 'all');
  eq('搜索和筛选不改入参顺序', items.map(row => row.schedule_id).join(), frozen);
}

// ── 节点选项来自列表里真实出现的执行节点 ────────────────────────────────
{
  const opts = scheduleNodeOptions(items);
  eq('没有 target_node_id 的不进选项', opts.map(option => option.id).sort(), ['node-dev', 'node-tma']);
  eq('计数是该节点上的计划数', opts.find(option => option.id === 'node-tma')?.count, 3);
  eq('别名用列表上的 target_alias', opts.find(option => option.id === 'node-dev')?.label, 'daemon-dev');
  const labels = opts.map(option => option.label);
  eq('按别名排序', labels, [...labels].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
  eq('选项消失后,选中的节点回到全部', reconcileNodeFilter(opts, 'gone'), '');
  eq('空选就是全部', reconcileNodeFilter(opts, ''), '');
  eq('还在的节点留着', reconcileNodeFilter(opts, 'node-tma'), 'node-tma');
  eq('未选时的按钮文案', nodeFilterLabel(opts, ''), '全部节点');
  eq('选中时用别名', nodeFilterLabel(opts, 'node-tma'), 'TMA需求鲸');
  eq('对不上的 id 不当成一个假节点', nodeFilterLabel(opts, 'gone'), '全部节点');
  eq('选择器搜索:子串', filterNodeOptions(opts, 'daemon').map(option => option.id), ['node-dev']);
  eq('选择器搜索:节点 id 也能中', filterNodeOptions(opts, 'node-tma').map(option => option.id), ['node-tma']);
  eq('选择器搜索走调用方的匹配(拼音)', filterNodeOptions(opts, 'xqj', (text, q) => q === 'xqj' && text === 'TMA需求鲸').map(option => option.id), ['node-tma']);
  eq('空搜索返回全部选项', filterNodeOptions(opts, '  ').map(option => option.id), opts.map(option => option.id));
  ck('有关键字或节点才算收窄', scopeNarrows({ query: '更新', nodeId: '' }) && scopeNarrows({ nodeId: 'node-tma' }));
  ck('空白关键字 + 全部节点不算收窄', !scopeNarrows({ query: '  ', nodeId: '' }));
}

// ── 空状态:滤空 ≠ 还没有计划 ────────────────────────────────────────────
eq('收窄后一条都不剩', emptyStateFor('active', 0, true), { title: '没有匹配的计划', body: '试试别的关键词，或换一个节点。', showCreate: false });
eq('收窄后这个状态没有,但别的状态还有', emptyStateFor('paused', 2, true).title, '没有暂停的计划');
eq('没搜也没选节点、列表本来就是空', emptyStateFor('all', 0).title, '还没有定时任务');
ck('滤空不提供新建', !emptyStateFor('all', 0, true).showCreate);

// ── 节点计划:名称 / 频率 / 类型,加上启用态和节点 ────────────────────────
{
  const dev = node({
    node_id: 'node-dev', alias: 'daemon-dev', schedules: [
      ext({ id: 'listed', name: '更新最新的任务列表', frequency: '*/3 * * * *', enabled: true }),
      ext({ id: 'night', name: '夜间同步', kind: 'systemd', frequency: 'hourly', enabled: false }),
    ],
  });
  const whale = node({
    node_id: 'node-tma', alias: 'TMA需求鲸', schedules: [
      ext({ id: 'backup', name: '备份', frequency: '0 3 * * *', enabled: true }),
    ],
  });
  const empty = node({ node_id: 'node-empty', alias: '空节点', schedules: [] });
  const nodes = [dev, whale, empty];
  const frozen = nodes.map(row => `${row.node_id}:${row.schedules.map(schedule => schedule.id).join('+')}`).join();

  ck('节点计划标题整句命中', externalScheduleMatchesQuery(dev.schedules[0], '更新最新的任务列表'));
  ck('频率命中', externalScheduleMatchesQuery(whale.schedules[0], '0 3'));
  ck('类型中文命中', externalScheduleMatchesQuery(dev.schedules[1], 'systemd'));
  ck('节点别名不在计划搜索里', !externalScheduleMatchesQuery(dev.schedules[0], 'daemon-dev'));

  eq('不筛选:空节点也留着', filterExternalNodes(nodes, {}).map(row => row.node_id), ['node-dev', 'node-tma', 'node-empty']);
  eq('标题搜索只留命中的那一行', filterExternalNodes(nodes, { query: '更新最新的任务列表' }).map(row => row.schedules.map(schedule => schedule.id)), [['listed']]);
  eq('类型 + 停用', filterExternalNodes(nodes, { query: 'systemd', enabled: 'disabled' }).map(row => row.schedules.map(schedule => schedule.id)), [['night']]);
  eq('节点 + 启用', filterExternalNodes(nodes, { nodeId: 'node-dev', enabled: 'enabled' }).map(row => row.schedules.map(schedule => schedule.id)), [['listed']]);
  eq('节点对、状态不对 → 这张卡不留', filterExternalNodes(nodes, { nodeId: 'node-tma', enabled: 'disabled' }), []);
  eq('只选本来就没上报的节点:留空卡', filterExternalNodes(nodes, { nodeId: 'node-empty' }).map(row => row.node_id), ['node-empty']);
  eq('启用态把空卡滤掉', filterExternalNodes(nodes, { nodeId: 'node-empty', enabled: 'enabled' }), []);
  eq('计数忽略启用态,好让三颗 chip 还对得上', externalSchedulesMatching(nodes, { nodeId: 'node-dev' }).map(schedule => schedule.id), ['listed', 'night']);
  eq('启用 / 停用 chip', externalEnabledChips(externalSchedulesMatching(nodes, { query: '更新' }), 'enabled').map(chip => `${chip.label}${chip.count}${chip.selected ? '*' : ''}`), ['全部1', '启用1*', '停用0']);
  eq('节点选项含空节点(计数 0)', externalNodeOptions(nodes).map(option => `${option.id}:${option.count}`).sort(), ['node-dev:2', 'node-empty:0', 'node-tma:1']);
  // 别名序:daemon-dev / 空节点 / TMA需求鲸 —— 用同一套 localeCompare,不写死谁在前。
  const optLabels = externalNodeOptions(nodes).map(option => option.label);
  eq('节点选项按别名排', optLabels, [...optLabels].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN') || 0));
  ck('关键字、节点、启用态都算收窄', externalScopeActive({ query: 'a' }) && externalScopeActive({ nodeId: 'node-dev' }) && externalScopeActive({ enabled: 'disabled' }));
  ck('三个都是默认不算收窄', !externalScopeActive({ query: ' ', nodeId: '', enabled: 'all' }));
  eq('有上报但被滤光', externalEmptyState(nodes.length, true), { title: '没有匹配的节点计划', body: '试试别的关键词，或清除节点和状态筛选。' });
  eq('本来就没有节点计划', externalEmptyState(0, false).title, '暂无节点计划');
  eq('筛选不改节点上的原计划', nodes.map(row => `${row.node_id}:${row.schedules.map(schedule => schedule.id).join('+')}`).join(), frozen);
  const listedOnly = filterExternalNodes(nodes, { query: '更新最新的任务列表' })[0];
  ck('滤完的行还是原来的对象', listedOnly.schedules[0] === dev.schedules[0]);
  ck('没滤掉的节点沿用原对象', filterExternalNodes(nodes, { nodeId: 'node-dev' })[0] === dev);
}

// ── 接线:两个 tab 都有搜索、状态 chip、节点筛选 ─────────────────────────
{
  const screen = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
  const has = (label: string, needle: string) => ck(`wiring: ${label}`, screen.includes(needle), needle);
  has('Hub 搜索框', 'testID="schedule-search"');
  has('Hub 按标题或内容搜', 'placeholder="搜索任务标题或内容"');
  has('节点计划搜索框', 'testID="external-schedule-search"');
  has('节点计划按名称或频率搜', 'placeholder="搜索计划名称或频率"');
  ck('两个 tab 各一块筛选条', screen.split('<ScheduleFilterBar').length - 1 === 2);
  has('Hub 先收窄再按状态排', 'schedulesInScope(items, hubScope)');
  has('Hub 列表仍走原来的状态排序', 'visibleSchedules(hubScoped, filter)');
  has('状态 chip 还在', 'filterChips(counts, filter)');
  has('状态计数来自收窄后的列表', 'countByStatus(hubScoped)');
  has('节点计划走启用态和节点', 'filterExternalNodes(external, { ...extTextScope, enabled: extEnabled })');
  has('节点计划的状态 chip', 'externalEnabledChips(extMatching, extEnabled)');
  has('节点按钮写全部节点', "'全部节点'");
  has('清除搜索', 'accessibilityLabel="清除搜索"');
  has('清除节点', 'accessibilityLabel="清除节点筛选"');
  has('节点选择器用拼音', 'filterNodeOptions(options, query, pinyinMatch)');
  has('窄屏换行', "flexWrap: 'wrap'");
  has('搜索框用输入底色', 'backgroundColor: colors.inputBg');
  has('节点按钮用卡片底', 'backgroundColor: colors.card');
  has('圆角用 control token', 'borderRadius: radius.control');
  has('选中节点用强调色底', 'backgroundColor: colors.tonalBg');
  has('搜索框至少 40 高,手指点得到', 'minHeight: 40');
  has('节点行至少 44 高', 'minHeight: 44');
  has('从节点页落进来时清掉 Hub 搜索', "setHubQuery('');");
  has('节点计划落点清掉启用态筛选', "setExtEnabled('all')");
}

console.log(`schedule list filter: ${passed} checks passed`);
