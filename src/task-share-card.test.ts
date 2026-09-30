// 分享图(方向 A「大字报」):哪些块出现的规则、人名怎么显示、排版几何。ck 风格自执行(scripts/run-tests.mjs 逐个跑)。
process.env.TZ = 'Asia/Shanghai';
import './i18n-tasks';
import { setLanguagePreference } from './i18n';
import {
  CHART30_MIN_ACTIVE, CHART7_MIN_ACTIVE, HEAT_MIN_SPAN, MIN_TITLE_ROWS, PAD, SHARE_H, SHARE_W,
  shareCardLayout, shareModules, specOf, type Rect, type ShareSpec,
} from './task-share-card';
import { shareModel, shareName } from './task-share-model';
import { dayList, type DashData } from './task-dashboard-model';
import { listRequirementPeople } from './requirement-people-api';
import type { RequirementPerson } from './requirement-people';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
setLanguagePreference('zh');

// daily 以今天结尾:activeDays 个有完成的天,落在最后 window 天里(其余为 0);firstAgo = 最早一次完成在几天前。
const daily = (len: number, activeAgo: number[]) => Array.from({ length: len }, (_, i) => ({ n: activeAgo.includes(len - 1 - i) ? 3 : 0 }));
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

console.log('\n哪些块出现(shareModules)');
ck('常量就是 README 写的数', CHART30_MIN_ACTIVE === 7 && CHART7_MIN_ACTIVE === 5 && HEAT_MIN_SPAN === 30);
// 30 天:6 天不画、7 天画(活跃日分散在近 30 天,近 7 天里只有 1 天,排除 7 天那条路)
const d6 = daily(371, [0, 8, 12, 16, 20, 24]);
const d7 = daily(371, [0, 8, 12, 16, 20, 24, 28]);
ck('近 30 天 6 个活跃日:不画 30 天图', shareModules(d6).active30 === 6 && shareModules(d6).chart === null, JSON.stringify(shareModules(d6)));
ck('近 30 天 7 个活跃日:画 30 天图', shareModules(d7).active30 === 7 && shareModules(d7).chart === '30d');
ck('第 31 天前的活跃日不算进近 30 天', shareModules(daily(371, [0, 8, 12, 16, 20, 24, 30])).active30 === 6);
// 7 天:4 天不画、5 天画(近 30 天总数 < 7)
const w4 = daily(371, [0, 1, 2, 3]);
const w5 = daily(371, [0, 1, 2, 3, 4]);
ck('近 7 天 4 个活跃日:不画图', shareModules(w4).active7 === 4 && shareModules(w4).chart === null);
ck('近 7 天 5 个活跃日:画 7 天图', shareModules(w5).active7 === 5 && shareModules(w5).chart === '7d');
ck('近 7 天 6 天 + 更早 1 天(近 30 天共 7):30 天图优先', shareModules(daily(371, [0, 1, 2, 3, 4, 5, 20])).chart === '30d');
// 热力图:最早一次完成 29 天前不画、30 天前画;只画那以来的周数
const h29 = daily(371, [0, 29]);
const h30 = daily(371, [0, 30]);
ck('历史 29 天:不画热力图', shareModules(h29).span === 29 && shareModules(h29).heatWeeks === null);
ck('历史 30 天:画热力图,5 周', shareModules(h30).span === 30 && shareModules(h30).heatWeeks === 5, String(shareModules(h30).heatWeeks));
ck('历史很长:最多 53 周', shareModules(daily(371, [0, 370])).heatWeeks === 53);
ck('截图那天的数据(2 个活跃日、历史 1 天):不画任何图', (() => { const m = shareModules(daily(371, [0, 1])); return m.chart === null && m.heatWeeks === null; })());
ck('完全没有完成:不画图、不画热力图', (() => { const m = shareModules(daily(371, [])); return m.chart === null && m.heatWeeks === null && m.span === 0; })());

console.log('\n人名(不把 admin 这类账号名印到图上)');
const P = (o: Partial<RequirementPerson> & { kind: 'user' | 'node'; id: string }): RequirementPerson => ({ networkId: 'net', name: o.id, ...o });
const people = [
  P({ kind: 'user', id: 'u_old', name: 'admin' }), // 旧 Hub:没有 displayName 字段
  P({ kind: 'user', id: 'u_empty', name: 'admin', displayName: '' }), // 新 Hub:没设显示名
  P({ kind: 'user', id: 'u_named', name: '示例成员', displayName: '示例成员' }),
  P({ kind: 'user', id: 'u_blank', name: 'someone', displayName: '   ' }),
  P({ kind: 'node', id: 'n_a', name: '示例-A', displayName: '' }),
];
ck('旧 Hub(字段缺失):照旧用 name', shareName({ kind: 'user', id: 'u_old' }, people) === 'admin');
ck('新 Hub、display_name 为空:显示「成员」', shareName({ kind: 'user', id: 'u_empty' }, people) === '成员');
ck('新 Hub、有 display_name:用它', shareName({ kind: 'user', id: 'u_named' }, people) === '示例成员');
ck('display_name 全是空白:当作没设', shareName({ kind: 'user', id: 'u_blank' }, people) === '成员');
ck('节点:用 name(Hub 已按 display_name → alias 回落)', shareName({ kind: 'node', id: 'n_a' }, people) === '示例-A');
ck('找不到的成员 / 节点:「成员」/「Agent」,不印 id', shareName({ kind: 'user', id: 'u_zz' }, people) === '成员' && shareName({ kind: 'node', id: 'n_zz' }, people) === 'Agent');
ck('没有完成者:null(不画)', shareName(null, people) === null);

{
  const realFetch = globalThis.fetch;
  const rows = [
    { kind: 'user', id: 'u1', networkId: 'net', name: 'admin', display_name: '' },
    { kind: 'user', id: 'u2', networkId: 'net', name: '示例成员', display_name: '示例成员' },
    { kind: 'node', id: 'n1', networkId: 'net', name: '示例-A' },
  ];
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true, people: rows }), { status: 200 });
  const got = await listRequirementPeople({ serverUrl: 'http://hub.invalid', token: 't', networkId: 'net' } as any);
  (globalThis as any).fetch = realFetch;
  ck('读 people:display_name 为空串 → displayName ""', got[0].displayName === '' && got[0].name === 'admin');
  ck('读 people:display_name 有值 → displayName', got[1].displayName === '示例成员');
  ck('读 people:旧 Hub 没这个字段 → displayName 缺失(不是 "")', !('displayName' in got[2]));
}

console.log('\n内容(shareModel)');
const NOW = Date.parse('2026-09-30T09:30:00Z');
const days = dayList(NOW, 371);
const mkData = (activeAgo: Record<number, number>, extra: Partial<DashData> = {}): DashData => ({
  source: 'hub', approx: false, partial: false, todayDone: 57, yesterdayDone: 98, weekDone: 155, lastWeekDone: 0, doing: 165,
  rate: 0.36, rateCreated: 100, rateDone: 36, periodDone: 155,
  daily: days.map((date, i) => ({ date, n: activeAgo[days.length - 1 - i] ?? 0 })),
  byProject: [],
  leaders: [{ kind: 'node', id: 'n_a', n: 101, spark: [] }, { kind: 'user', id: 'u_empty', n: 38, spark: [] }, { kind: 'node', id: 'n_b', n: 16, spark: [] }],
  recent: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, seq: i + 1, name: `示例任务 ${i + 1}`, projectId: null, at: NOW - i * 60000, approx: false, by: i % 3 === 1 ? { kind: 'user' as const, id: 'u_empty' } : { kind: 'node' as const, id: 'n_a' }, archived: false })),
  ...extra,
});
const m = shareModel(mkData({ 0: 57, 1: 98 }), 'week', people, new Set(['r2']), NOW);
ck('大数字 = 本周完成', m.big === 155 && m.total === 155);
ck('Agent 那句带占比', m.agentLine === '其中 117 个由 Agent 完成，占 75%', String(m.agentLine));
ck('三格:今天完成 / 单日最高 / 协作者;没有完成率', m.stats.map(s => s.label).join('|') === '今天完成|单日最高|协作者' && !JSON.stringify(m).includes('36%'), m.stats.map(s => s.label).join('|'));
ck('单日最高 = busiestDay(98,09.29)', m.stats[1].value === '98' && m.stats[1].unit.includes('09.29'), JSON.stringify(m.stats[1]));
ck('协作者 = 1 人 + 2 Agent', m.stats[2].value === '3' && m.stats[2].unit === '1 人 + 2 Agent');
ck('取消勾选的不在标题里;每条带完成者', m.titles.length === 19 && !m.titles.some(t => t.text.includes('示例任务 3')) && m.titles[0].who === '示例-A' && m.titles[1].who === '成员');
ck('完成榜里的成员也是「成员」不是 admin', m.who?.top[1].name === '成员' && !JSON.stringify(m).includes('admin'));
ck('截图那天的数据:没有柱图、没有热力图', m.chart === null && m.heat === null);
const rich = shareModel(mkData(Object.fromEntries(range(0, 40).map(i => [i, i % 4 ? 5 : 0]))), 'week', people, new Set(), NOW);
ck('历史够长:有 30 天柱图(30 根)和热力图', rich.chart?.bars.length === 30 && !!rich.heat, `${rich.chart?.bars.length} ${!!rich.heat}`);
const today = shareModel(mkData({ 0: 57, 1: 98 }), 'today', people, new Set(), NOW);
ck('「今天」期:第一格换成本周完成', today.big === 57 && today.stats[0].label === '本周完成' && today.stats[0].value === '155');

console.log('\n排版几何(shareCardLayout)');
const inside = (r: Rect | null, H: number) => !r || (r.x >= PAD && r.y >= 64 && r.x + r.w <= SHARE_W - PAD && r.y + r.h <= H - 64);
const overlap = (a: Rect | null, b: Rect | null) => !!a && !!b && a.y < b.y + b.h && b.y < a.y + a.h;
for (const size of ['portrait', 'feed'] as const) {
  for (const titles of [0, 1, 5, 8, 12, 20]) {
    for (const total of [titles, titles + 140]) {
      for (const [chart, heat, who] of [[false, false, true], [true, true, true], [false, false, false], [true, false, false]] as const) {
        for (const approx of [false, true]) {
          const spec: ShareSpec = { titles, total, chart, heat, who, approx };
          const L = shareCardLayout(size, spec);
          const H = SHARE_H[size];
          const blocks = [L.header, L.kicker, L.big, L.agent, L.stats, L.titles, L.chart, L.heat, L.who, L.footer];
          const tag = `${size} 标题${titles}/${total} 图${+chart}热${+heat}谁${+who}估${+approx}`;
          const bad: string[] = [];
          if (!blocks.every(b => inside(b, H))) bad.push('出安全区');
          if (!blocks.every((a, i) => blocks.every((b, j) => i >= j || !overlap(a, b)))) bad.push('重叠');
          if (!blocks.every(b => !b || (b.x === PAD && SHARE_W - (b.x + b.w) === PAD))) bad.push('左右边距不等');
          const want = titles + (total > titles ? 1 : 0);
          if (want && L.titleRows < Math.min(MIN_TITLE_ROWS, want)) bad.push(`标题只有 ${L.titleRows} 行`);
          if (L.titleRows > want) bad.push('空行');
          if (L.titles && L.titlesShown + (L.moreCount ? 1 : 0) !== L.titleRows) bad.push('还有 N 个 行数不对');
          if (L.titles && L.titlesShown + L.moreCount !== Math.max(total, titles)) bad.push(`还有 N 个 = ${L.moreCount}`);
          if (L.titles && L.titles.h !== 80 + L.titleRows * L.rowH + 14) bad.push('面板高度');
          if (size === 'feed' && (L.heat || (L.who && L.whoFull))) bad.push('4:5 放了热力图 / 完整完成榜');
          ck(tag, bad.length === 0, bad.join(','));
        }
      }
    }
  }
}
// 截图那天:竖版 20 条标题 + 完成榜 → 至少 8 条标题、完成榜完整;有柱图时柱图放得下、完成榜退成占比条
{
  const real = shareCardLayout('portrait', { titles: 20, total: 155, chart: false, heat: false, who: true, approx: false });
  ck('竖版、无图:完整的「谁完成的」+ ≥ 8 条标题', real.whoFull && real.titlesShown >= 8, `${real.whoFull} ${real.titlesShown}`);
  const withChart = shareCardLayout('portrait', { titles: 20, total: 155, chart: true, heat: true, who: true, approx: false });
  ck('竖版、有图:柱图在,「谁完成的」退成占比条,热力图让位,仍 ≥ 8 条', !!withChart.chart && !!withChart.who && !withChart.whoFull && !withChart.heat && withChart.titlesShown >= 8, JSON.stringify({ c: !!withChart.chart, w: withChart.whoFull, h: !!withChart.heat, n: withChart.titlesShown }));
  ck('柱图在「谁完成的」上面', !!withChart.chart && !!withChart.who && withChart.chart.y < withChart.who.y);
  const feed = shareCardLayout('feed', { titles: 20, total: 155, chart: true, heat: true, who: true, approx: true });
  ck('4:5:只放标题,≥ 8 条', feed.titlesShown >= 8 && !feed.chart && !feed.heat, String(feed.titlesShown));
  const spec = specOf({ titles: [], total: 3, chart: null, heat: { heading: '', right: '', cells: [] }, who: null, approxNote: null } as any, { size: 'feed', showHeat: true, showTop: true });
  ck('specOf:4:5 不要热力图,没人上榜不要「谁完成的」', spec.heat === false && spec.who === false);
}

console.log(`\n${p}/${tt} passed`);
process.exit(p === tt ? 0 : 1);
