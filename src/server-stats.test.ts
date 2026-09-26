// 服务器页数据层 + 卡片→列表导航接线 —— run: bun src/server-stats.test.ts
//
// 判据纪律:
//   - 「在线 ≠ 总数」的回归必须用**含离线**的输入,并且断言两个数都对 —— 只断言 online
//     小于 total 守不住「online 算成了 working」这类错。
//   - 卡片的数字必须等于列表筛选器筛出来的行数:两边各算一遍,不同源。
//   - 源码契约只管接线(谁把 filter 传给谁),行为由上面的纯函数断言钉住。

import fs from 'node:fs';
import path from 'node:path';
import type { Session } from './api';
import { buildSections } from './agents-list';
import {
  agentListScreen,
  applyAgentFilter,
  bucketOf,
  compactId,
  describeFailure,
  filterLabel,
  formatDuration,
  formatLatency,
  groupHealth,
  isFilterActive,
  latencyTone,
  nextConnectedSince,
  statusCards,
  summarize,
} from './server-stats';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const S = (alias: string, status: string): Session => ({ alias, status } as Session);

// 占位数据:3 组、混合状态(没有真实别名)。
const fleet: Session[] = [
  S('甲组-1', 'idle'), S('甲组-2', 'working'), S('甲组-3', 'running'), S('甲组-4', 'offline'), S('甲组-5', 'error'),
  S('乙组-1', 'offline'), S('乙组-2', 'offline'), S('乙组-3', 'idle'), S('乙组-4', 'blocked'), S('乙组-5', 'working'),
  S('丙组-1', 'offline'), S('丙组-2', 'offline'), S('丙组-3', 'offline'), S('丙组-4', 'idle'),
  // ↑ 在线 8 / 工作中 3 / 异常 2 / 离线 6:四张卡的数故意两两不等 —— 相等时「离线卡片筛成在线」这类错会空过(变异实测过)。
];

// ── 1. 303 回归:在线不是总数 ──
{
  const st = summarize(fleet);
  ck('total = 全部会话数(14)', st.total === 14, String(st.total));
  ck('online = 非 offline(8),不是 total', st.online === 8, String(st.online));
  ck('regression: online !== total when some sessions are offline', st.online !== st.total);
  ck('offline = 6', st.offline === 6, String(st.offline));
  ck('working 折叠 working+running(3)', st.working === 3, String(st.working));
  ck('error 收 error/failed/blocked(2)', st.error === 2, String(st.error));
  ck('idle = 3', st.idle === 3, String(st.idle));
  ck('四个桶互斥且覆盖全部', st.working + st.error + st.idle + st.offline === st.total);
  ck('online = working + error + idle', st.online === st.working + st.error + st.idle);
  // 与 Agent 列表分组头同一口径:各组 online 之和 = summarize 的 online。
  const listOnline = buildSections(fleet, '').reduce((n, g) => n + g.online, 0);
  ck('online 与 Agent 列表分组头口径一致', listOnline === st.online, `${listOnline} vs ${st.online}`);
  const allOn = summarize([S('a', 'idle'), S('b', 'working')]);
  ck('全在线时 online === total(不是恒小于)', allOn.online === 2 && allOn.total === 2);
  ck('空列表全 0', JSON.stringify(summarize([])) === JSON.stringify({ total: 0, online: 0, working: 0, error: 0, idle: 0, offline: 0 }));
}

// ── 2. 单个会话的归类 ──
ck('offline → offline', bucketOf(S('x', 'offline')) === 'offline');
ck('running → working', bucketOf(S('x', 'running')) === 'working');
ck('failed → error', bucketOf(S('x', 'failed')) === 'error');
ck('blocked → error', bucketOf(S('x', 'blocked')) === 'error');
ck('idle → idle', bucketOf(S('x', 'idle')) === 'idle');
ck('未知状态算在线空闲(与列表 isOffline 同:只有 offline 才离线)', bucketOf(S('x', 'waiting')) === 'idle');

// ── 3. 分组聚合 ──
{
  const g = groupHealth(fleet);
  ck('三组', g.length === 3, JSON.stringify(g.map(x => x.title)));
  const by = Object.fromEntries(g.map(x => [x.title, x]));
  ck('甲组 4/5', by['甲组']?.online === 4 && by['甲组']?.total === 5, JSON.stringify(by['甲组']));
  ck('乙组 3/5', by['乙组']?.online === 3 && by['乙组']?.total === 5, JSON.stringify(by['乙组']));
  ck('丙组 1/4', by['丙组']?.online === 1 && by['丙组']?.total === 4, JSON.stringify(by['丙组']));
  ck('ratio = online/total', Math.abs((by['甲组']?.ratio ?? 0) - 0.8) < 1e-9);
  ck('分组顺序与 Agent 列表相同', g.map(x => x.title).join() === buildSections(fleet, '').map(x => x.title).join());
  ck('没有「新消息」「置顶」伪组', !g.some(x => x.title === '新消息' || x.title === '置顶'));
  ck('各组 total 之和 = 总数', g.reduce((n, x) => n + x.total, 0) === fleet.length);
}

// ── 4. 卡片 → 筛选:卡片上的数 = 列表筛出来的行数 ──
{
  const st = summarize(fleet);
  const cards = statusCards(st);
  ck('四张卡:在线/工作中/异常/离线', cards.map(c => c.label).join() === '在线,工作中,异常,离线');
  ck('在线卡带总数', cards[0].of === st.total && cards[0].value === st.online);
  ck('每张卡的筛选状态 = 卡片自己', cards.every(c => c.filter.status === c.key && !c.filter.group));
  ck('各卡数字两两不同(否则下面的等式分辨不出接错了哪张)', new Set(cards.map(c => c.value)).size === cards.length, JSON.stringify(cards.map(c => c.value)));
  for (const c of cards) {
    const rows = applyAgentFilter(fleet, agentListScreen(c.filter, 'mobile').filter).length;
    ck(`card ${c.key}: 卡片数字 ${c.value} = 列表筛出 ${rows} 行`, rows === c.value && rows > 0 && rows < fleet.length);
  }
  ck('手机端进 agents', agentListScreen({ status: 'working' }, 'mobile').name === 'agents');
  ck('桌面端进 serverNodes', agentListScreen({ status: 'working' }, 'desktop').name === 'serverNodes');
  ck('filter 原样带过去', agentListScreen({ status: 'error' }, 'mobile').filter.status === 'error');
  const f = { status: 'online' as const };
  ck('每次导航一个新对象(列表靠对象身份重新应用筛选)', agentListScreen(f, 'mobile').filter !== f);
  // 分组行 → 该组全部成员
  ck('分组筛选 = 该组全部成员', applyAgentFilter(fleet, { group: '乙组' }).length === 5);
  ck('分组 + 状态 组合', applyAgentFilter(fleet, { group: '甲组', status: 'working' }).map(s => s.alias).join() === '甲组-2,甲组-3');
  ck('无筛选 = 全部', applyAgentFilter(fleet, null).length === fleet.length && applyAgentFilter(fleet, {}).length === fleet.length);
  ck('isFilterActive', isFilterActive({ group: 'x' }) && !isFilterActive({}) && !isFilterActive(null));
  ck('filterLabel', filterLabel({ group: '甲组', status: 'offline' }) === '甲组 · 离线' && filterLabel({ status: 'error' }) === '异常');
}

// ── 5. 延迟 / 时长 / id / 失败原因 ──
ck('latency 86.4 → 86 ms', formatLatency(86.4) === '86 ms', formatLatency(86.4));
ck('latency 999 → 999 ms', formatLatency(999) === '999 ms');
ck('latency 1000 → 1.0 s(边界)', formatLatency(1000) === '1.0 s', formatLatency(1000));
ck('latency 2345 → 2.3 s', formatLatency(2345) === '2.3 s');
ck('latency 0.2 → 1 ms(不显示 0 ms)', formatLatency(0.2) === '1 ms');
ck('latency null / NaN / 负数 → —', formatLatency(null) === '—' && formatLatency(NaN) === '—' && formatLatency(-5) === '—');
ck('tone 299 good / 300 fair / 1000 slow', latencyTone(299) === 'good' && latencyTone(300) === 'fair' && latencyTone(999) === 'fair' && latencyTone(1000) === 'slow');
ck('tone null unknown', latencyTone(null) === 'unknown');
ck('duration 59s → 刚刚', formatDuration(59_000) === '刚刚');
ck('duration 60s → 1 分钟', formatDuration(60_000) === '1 分钟');
ck('duration 3h5m', formatDuration((3 * 60 + 5) * 60_000) === '3 小时 5 分', formatDuration((3 * 60 + 5) * 60_000));
ck('duration 2h 整', formatDuration(120 * 60_000) === '2 小时');
ck('duration 2d4h', formatDuration((52 * 60) * 60_000) === '2 天 4 小时', formatDuration(52 * 3600_000));
ck('compactId 长 id 压缩', compactId('net_adac2cb00437') === 'net_adac…0437', compactId('net_adac2cb00437'));
ck('compactId 短 id 原样', compactId('net_abc') === 'net_abc');
ck('compactId 空 → —', compactId(undefined) === '—' && compactId('  ') === '—');
ck('failure 401 → 登录已失效', describeFailure(new Error('HTTP 401 on /api/status')).includes('登录已失效'));
ck('failure 502 → 服务器内部错误', describeFailure(new Error('HTTP 502 on /api/status')).includes('服务器内部错误'));
ck('failure 404 → 拒绝', describeFailure(new Error('HTTP 404 on /api/status')).includes('拒绝'));
{
  const abort = new Error('The operation was aborted.'); abort.name = 'AbortError';
  ck('failure abort → 超时', describeFailure(abort).includes('超时'));
}
ck('failure 网络错带原文', describeFailure(new TypeError('Network request failed')).includes('Network request failed'));
ck('connectedSince: 首次成功开始计时', nextConnectedSince(null, true, 100) === 100);
ck('connectedSince: 连续成功不重置', nextConnectedSince(100, true, 500) === 100);
ck('connectedSince: 失败清空', nextConnectedSince(100, false, 500) === null);
ck('connectedSince: 失败后成功重新计时', nextConnectedSince(nextConnectedSince(100, false, 500), true, 900) === 900);

// ── 6. 接线(源码契约):卡片/分组 → 列表带筛选;列表真的用了这个筛选 ──
{
  const root = path.join(import.meta.dir, '..');
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const agents = fs.readFileSync(path.join(root, 'src/AgentsScreen.tsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'src/ServerScreen.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/ServerSidebar.tsx'), 'utf8');
  ck('手机端服务器页:卡片 → agentListScreen(filter, mobile)', app.includes("onOpenAgents={filter => setScreen(agentListScreen(filter, 'mobile') as Screen)}"));
  ck('桌面端服务器页:卡片 → agentListScreen(filter, desktop)', app.includes("onOpenAgents={filter => setScreen(agentListScreen(filter, 'desktop') as Screen)}"));
  const passes = app.split("filter={screen.name === 'agents' ? screen.filter : undefined}").length - 1;
  ck('手机列表和双栏左侧列表都拿到 filter(2 处)', passes === 2, String(passes));
  ck('桌面节点清单拿到 filter', app.includes('<AgentsScreen cfg={cfg} filter={screen.filter}'));
  ck('列表用 applyAgentFilter 过滤后再分组', agents.includes('buildSections(applyAgentFilter(sessions, activeFilter), query'));
  ck('列表在 filter 变化时重新应用', agents.includes('useEffect(() => { if (filter) setActiveFilter(filter); }, [filter]);'));
  ck('卡片 onPress 传 card.filter', server.includes('onPress={() => onOpenAgents?.(card.filter)}'));
  ck('分组 onPress 传 group', server.includes('onPress={() => onOpenAgents?.({ group: g.title })}'));
  ck('服务器页不再用 sessions.length 当在线数', !/online\s*=\s*sessions\.length/.test(server) && server.includes('summarize(sessions)'));
  ck('侧栏不再用 sessions.length 当在线数', !sidebar.includes('sessions?.length') && sidebar.includes('summarize('));
}

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
