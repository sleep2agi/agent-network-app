// 仪表盘视图的纯逻辑 + 分享图排版。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
// 「哪一天」按本机时区:固定成东八区,结果不随跑测试的机器变。
process.env.TZ = 'Asia/Shanghai';
import { readFileSync } from 'node:fs';
import {
  agentShare, busiestDay, completionOf, dayList, deltaPct, fromHubStats, fromItems, heatCells, newlyCompleted, parseHubStats, periodStart, relativeTime, streaks, ymd,
} from './task-dashboard-model';
import { fitText, SHARE_H, SHARE_W, shareFileName } from './task-share-card';
import { listAllRequirementsForDashboard, requirementFromHub } from './requirements-hub';
import type { Requirement } from './requirements-model';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// 2026-09-30 周三 17:30 东八区
const NOW = Date.parse('2026-09-30T09:30:00Z');
const at = (iso: string) => iso; // 可读性
const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name: `任务${id}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-01T00:00:00Z', owner: null, participants: [], ...o,
});

console.log('\n期的边界(本机时区,周一开头)');
ck('今天 = 本地 00:00', ymd(periodStart('today', NOW)!) === '2026-09-30' && new Date(periodStart('today', NOW)!).getHours() === 0);
ck('本周 = 周一 09-28', ymd(periodStart('week', NOW)!) === '2026-09-28');
ck('周一当天本周从当天开始', ymd(periodStart('week', Date.parse('2026-09-28T01:00:00Z'))!) === '2026-09-28');
ck('周日属于上周一开头的那周', ymd(periodStart('week', Date.parse('2026-10-04T12:00:00Z'))!) === '2026-09-28');
ck('本月 = 09-01', ymd(periodStart('month', NOW)!) === '2026-09-01');
ck('全部 = null', periodStart('all', NOW) === null);
ck('东八区 UTC 16:30 已经是第二天', ymd(Date.parse('2026-09-30T16:30:00Z')) === '2026-10-01');
const days = dayList(NOW, 371);
ck('dayList 371 天,以今天结尾', days.length === 371 && days[370] === '2026-09-30' && days[369] === '2026-09-29');

console.log('\n完成时刻:completedAt 优先,旧 Hub 退回 updatedAt(近似)');
const exact = completionOf(R('a', { column: 'done', completedAt: '2026-09-30T08:00:00Z', completedBy: { kind: 'node', id: 'n1' }, updatedAt: '2026-09-30T09:00:00Z' }));
ck('有 completedAt:用它,不近似,完成者 = completedBy', exact?.at === Date.parse('2026-09-30T08:00:00Z') && exact?.approx === false && exact?.by?.id === 'n1');
const legacy = completionOf(R('b', { column: 'done', updatedAt: '2026-09-30T07:00:00Z', updatedBy: { kind: 'user', id: 'u1' } }));
ck('没有 completedAt:用 updatedAt,标近似,完成者 = 最后改的人', legacy?.at === Date.parse('2026-09-30T07:00:00Z') && legacy?.approx === true && legacy?.by?.id === 'u1');
const backfilled = completionOf(R('c', { column: 'done', completedAt: '2026-09-01T00:00:00Z', completedAtApprox: true, completedBy: null, updatedBy: { kind: 'user', id: 'u9' } }));
ck('Hub 补的近似值:近似,不拿最后改的人冒充完成者', backfilled?.approx === true && backfilled?.by === null);
ck('不在完成列 = null', completionOf(R('d', { column: 'doing', completedAt: null })) === null);
ck('旧 SQLite 时间形状也认', completionOf(R('e', { column: 'done', updatedAt: '2026-09-30 01:00:00' }))?.at === Date.parse('2026-09-30T01:00:00Z'));

console.log('\n本机估(fromItems)');
const items: Requirement[] = [
  R('t1', { column: 'done', completedAt: at('2026-09-30T02:00:00Z'), completedBy: { kind: 'node', id: 'n1' }, projectId: 'p1', createdAt: '2026-09-30T01:00:00Z', seq: 11 }),
  R('t2', { column: 'done', completedAt: at('2026-09-30T05:00:00Z'), completedBy: { kind: 'user', id: 'u1' }, projectId: 'p1', createdAt: '2026-09-29T01:00:00Z' }),
  R('t3', { column: 'done', completedAt: at('2026-09-29T05:00:00Z'), completedBy: { kind: 'node', id: 'n1' }, projectId: null, archived: true }),
  R('t4', { column: 'done', completedAt: at('2026-09-22T05:00:00Z'), completedBy: { kind: 'user', id: 'u1' } }),
  R('t5', { column: 'doing', createdAt: '2026-09-30T03:00:00Z' }),
  R('t6', { column: 'doing', archived: true }),
  R('t7', { column: 'done', completedAt: at('2026-10-02T00:00:00Z'), completedBy: { kind: 'user', id: 'u1' } }), // 未来(时钟偏差):不算
];
const wk = fromItems(items, 'week', NOW);
ck('今天 2(东八区 09-30)', wk.todayDone === 2, String(wk.todayDone));
ck('昨天 1(归档的也算)', wk.yesterdayDone === 1);
ck('本周 3', wk.weekDone === 3);
ck('上周同期 1(09-22 周二 ≤ 上周三此刻)', wk.lastWeekDone === 1);
ck('进行中 1(归档的不算)', wk.doing === 1);
ck('完成率:本周新建 t1 t2 t5 → 2/3', wk.rateCreated === 3 && wk.rateDone === 2 && Math.abs((wk.rate ?? 0) - 2 / 3) < 1e-9);
ck('本周完成 3,最近完成新 → 旧', wk.periodDone === 3 && wk.recent.map(r => r.id).join() === 't2,t1,t3');
ck('最近完成带短号 / 项目 / 归档', wk.recent[1].seq === 11 && wk.recent[1].projectId === 'p1' && wk.recent[2].archived === true);
ck('按项目:p1 2,未分 1', JSON.stringify(wk.byProject) === JSON.stringify([{ projectId: 'p1', n: 2 }, { projectId: null, n: 1 }]));
ck('完成榜:n1 2、u1 1', wk.leaders.map(l => `${l.kind}:${l.id}=${l.n}`).join() === 'node:n1=2,user:u1=1');
ck('完成榜 spark 14 天,最后一格 = 今天', wk.leaders[0].spark.length === 14 && wk.leaders[0].spark[13] === 1 && wk.leaders[0].spark[12] === 1);
ck('每日曲线 371 天,今天 2', wk.daily.length === 371 && wk.daily[370].n === 2 && wk.daily[369].n === 1);
ck('全是 completedAt:不近似', wk.approx === false && wk.source === 'client');
const legacyData = fromItems([R('x', { column: 'done', updatedAt: '2026-09-30T02:00:00Z' })], 'today', NOW);
ck('有按 updatedAt 估的:整页近似', legacyData.approx === true && legacyData.todayDone === 1);
ck('partial 原样带出', fromItems([], 'all', NOW, true).partial === true);
ck('没有新建 → 完成率 null', fromItems([], 'today', NOW).rate === null);

console.log('\nHub 统计(fromHubStats)');
const hubRaw = {
  ok: true,
  totals: { done: 5, done_approx: 1, created: 7, created_done: 5, completion_rate: 5 / 7, doing: 2, pool: 3 },
  daily: dayList(NOW, 371).map((date, i) => ({ date, n: i === 370 ? 4 : i === 369 ? 2 : i === 363 ? 1 : 0 })),
  by_project: [{ project_id: null, n: 4 }, { project_id: 'p1', n: 1 }],
  by_completer: [{ kind: 'user', id: 'u1', n: 3, spark: Array(14).fill(0) }, { kind: 'bad' }],
  unattributed: 1,
  recent: [{ id: 'r1', seq: 3, name: '标题', project_id: null, completed_at: '2026-09-30T09:00:00.000Z', completed_at_approx: false, completed_by: { kind: 'node', id: 'n1' }, archived: true }],
};
const stats = parseHubStats(hubRaw);
ck('parse:坏的完成者丢掉', stats?.by_completer.length === 1);
ck('parse:形状不对 → null', parseHubStats({ totals: null }) === null && parseHubStats(null) === null);
const hd = fromHubStats(stats!, NOW);
ck('今天 / 昨天从每日曲线取', hd.todayDone === 4 && hd.yesterdayDone === 2);
ck('本周(周一到今天)= 6;上周同期(上周一到上周三)= 1', hd.weekDone === 6 && hd.lastWeekDone === 1, `${hd.weekDone}/${hd.lastWeekDone}`);
ck('进行中 / 完成率 / 期内完成来自 totals', hd.doing === 2 && hd.periodDone === 5 && hd.rateDone === 5);
ck('done_approx > 0 → 近似', hd.approx === true && hd.source === 'hub');
ck('recent 转成 DashCompletion', hd.recent[0].id === 'r1' && hd.recent[0].by?.kind === 'node' && hd.recent[0].archived === true && hd.recent[0].seq === 3);
ck('旧 stats 没有 recent:空列表', fromHubStats({ ...stats!, recent: undefined }, NOW).recent.length === 0);

console.log('\n派生');
const d = (ns: number[]) => ns.map((n, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, n }));
ck('连续:最长 3,当前 2', JSON.stringify(streaks(d([1, 1, 1, 0, 1, 1]))) === JSON.stringify({ current: 2, longest: 3 }));
ck('今天还是 0 不算断', streaks(d([1, 1, 0])).current === 2);
ck('昨天是 0 = 断了', streaks(d([1, 0, 0])).current === 0);
ck('最忙的一天(同数取后一天)', busiestDay(d([2, 5, 1, 5]))?.date === '2026-09-04' && busiestDay(d([0, 0])) === null);
ck('变化百分比', deltaPct(47, 38) === 24 && deltaPct(3, 0) === null && deltaPct(1, 2) === -50);
ck('Agent 占比', agentShare([{ kind: 'node', id: 'a', n: 3, spark: [] }, { kind: 'user', id: 'b', n: 1, spark: [] }]) === 0.75 && agentShare([]) === null);
ck('相对时间', relativeTime(NOW - 30_000, NOW).key === 'now' && relativeTime(NOW - 5 * 60_000, NOW).n === 5
  && relativeTime(NOW - 3 * 3_600_000, NOW).key === 'hour' && relativeTime(Date.parse('2026-09-29T12:00:00Z'), NOW).key === 'yesterday'
  && relativeTime(Date.parse('2026-09-20T12:00:00Z'), NOW).m === 9);
const heat = heatCells(dayList(NOW, 371).map(date => ({ date, n: date === '2026-09-30' ? 8 : date === '2026-09-28' ? 2 : 0 })), 53);
const last = heat[heat.length - 1];
ck('热力图:最后一格是今天,周三 = 第 3 行(周一 = 0)', last.date === '2026-09-30' && last.row === 2 && last.col === 52 && last.level === 4);
ck('热力图:0 = level 0,小值 ≥ 1', heat.find(x => x.date === '2026-09-28')?.level === 1 && heat[0].level === 0);
ck('热力图:列数 = 周数', Math.max(...heat.map(x => x.col)) === 52);
ck('新完成:第一轮不算', newlyCompleted(null, wk.recent).length === 0);
ck('新完成:上一轮没有的 id', newlyCompleted(['t1', 't3'], wk.recent).join() === 't2');

console.log('\nHub 行 → completedAt');
const row = requirementFromHub({ id: 'r', name: 'n', column: 'done', createdAt: 'x', completedAt: '2026-09-30T00:00:00Z', completedAtApprox: true, completedBy: { kind: 'user', id: 'u' } });
ck('三个字段读进来', row?.completedAt === '2026-09-30T00:00:00Z' && row?.completedAtApprox === true && row?.completedBy?.id === 'u');
const oldRow = requirementFromHub({ id: 'r', name: 'n', column: 'done', createdAt: 'x' });
ck('旧 Hub:字段不存在(undefined),不是 null', oldRow !== null && !('completedAt' in oldRow));

console.log('\n整张表翻页(cursor + 归档)');
{
  const calls: string[] = [];
  const pages: Record<string, unknown> = {
    '': { requirements: [{ id: 'a', name: 'A', column: 'done', createdAt: 'x' }], has_more: true, next_cursor: 'c2' },
    'c2': { requirements: [{ id: 'b', name: 'B', column: 'pool', createdAt: 'x' }], has_more: false, next_cursor: null },
    'arch': { requirements: [{ id: 'z', name: 'Z', column: 'done', createdAt: 'x' }, { id: 'b', name: 'B2', column: 'done', createdAt: 'x' }], has_more: false, next_cursor: null },
  };
  (globalThis as any).fetch = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const key = u.searchParams.get('archived') === 'true' ? 'arch' : u.searchParams.get('cursor') ?? '';
    return new Response(JSON.stringify(pages[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const got = await listAllRequirementsForDashboard({ serverUrl: 'http://hub.invalid', token: 't', networkId: 'net' } as any);
  ck('读了三页:第一页、cursor=c2、archived=true', calls.length === 3 && calls[1].includes('cursor=c2') && calls[2].includes('archived=true'), calls.join(' | '));
  ck('每页带 limit 和 network_id', calls.every(c => c.includes('limit=1000') && c.includes('network_id=net')));
  ck('归档的标 archived,同 id 留后读到的', got.rows.length === 3 && got.rows.find(r => r.id === 'z')?.archived === true && got.rows.find(r => r.id === 'b')?.name === 'B2');
  ck('分页 Hub:不是 partial', got.partial === false);
  calls.length = 0;
  (globalThis as any).fetch = async (url: string) => {
    calls.push(url);
    const archived = new URL(url).searchParams.get('archived') === 'true';
    return new Response(JSON.stringify({ requirements: Array.from({ length: archived ? 3 : 500 }, (_, i) => ({ id: `${archived ? 'z' : 'r'}${i}`, name: 'n', column: 'done', createdAt: 'x' })) }), { status: 200 });
  };
  const old = await listAllRequirementsForDashboard({ serverUrl: 'http://hub2.invalid', token: 't', networkId: 'net' } as any);
  ck('旧 Hub(没有 has_more)满 500 张:partial,不再翻页', old.partial === true && calls.length === 2 && old.rows.length === 503);
}

console.log('\n分享图(排版与规则在 task-share-card.test.ts)');
ck('尺寸 1080×1920 / 1080×1350', SHARE_W === 1080 && SHARE_H.portrait === 1920 && SHARE_H.feed === 1350);
const measure = (s: string) => [...s].length * 10;
ck('fitText:放得下原样', fitText(measure, '短标题', 100) === '短标题');
ck('fitText:放不下截断加 …,宽度不超', fitText(measure, '一个非常非常长的任务标题', 60) === '一个非常非…' && measure(fitText(measure, '一个非常非常长的任务标题', 60)) <= 60);
ck('文件名不带用户 / 网络', shareFileName('today', '2026-09-30', 'portrait') === 'agent-network-today-2026-09-30-1080x1920.png');

console.log('\n接线');
const board = src('./RequirementBoard.tsx');
ck('分段里有仪表盘', /key: 'dashboard', label: tr\('dash\.view'\)/.test(board));
ck('TaskSection 有 dashboard', /TaskSection = [^;]*'dashboard'/.test(src('./task-board-store.ts')));
ck('仪表盘不显示筛选 / 新建 / 搜索', /section === 'dispatch' \|\| section === 'dashboard' \? null/.test(board) && /canSearch = section !== 'dispatch' && section !== 'dashboard'/.test(board));
ck('点最近完成里不在看板上的卡:按 id 读来开详情', /getRequirementOnHub\(cfg, id\)/.test(board));
ck('Hub 有 stats 才问 /stats', /statsCapable=\{statsCapable\}/.test(board) && /includes\('stats'\)/.test(board));

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
