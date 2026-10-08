// 分享图的内容(纯数据):从仪表盘数据 DashData 算出 ShareCardModel。排版和画在 task-share-card.ts。
// 单独一个文件,ck 测试(task-share-card.test.ts)不用加载 RN 组件就能测「人名怎么显示」「哪些块出现」。
import { t as tr } from './i18n';
import { titleText } from './requirements-model';
import type { RequirementPerson, RequirementPersonRef } from './requirement-people';
import { agentShare, busiestDay, dayList, heatCells, periodStart, ymd, type DashData, type DashPeriod } from './task-dashboard-model';
import { shareModules, type ShareCardModel } from './task-share-card';

/** 分享图上的人名。成员:Hub 给了 displayName(#2183 起)就只用它,空的显示「成员」—— 不把 admin 之类的账号名印到对外的图上;
 *  旧 Hub 没有这个字段 → 用 name(和以前一样)。找不到这个人 → 「成员」/「Agent」,不印 id。 */
export function shareName(ref: RequirementPersonRef | null, people: readonly RequirementPerson[]): string | null {
  if (!ref) return null;
  const hit = people.find(p => p.kind === ref.kind && p.id === ref.id);
  if (ref.kind === 'user') {
    if (hit && hit.displayName !== undefined) return hit.displayName.trim() || tr('dash.member');
    return hit?.name.trim() || tr('dash.member');
  }
  return hit?.name.trim() || tr('dash.agent');
}

const pctText = (v: number) => `${Math.round(v * 100)}%`;
const mdDot = (date: string) => `${date.slice(5, 7)}.${date.slice(8, 10)}`;

/** excluded:用户在对话框里取消勾选的任务 id。 */
export function shareModel(data: DashData, period: DashPeriod, people: readonly RequirementPerson[], excluded: ReadonlySet<string>, now: number): ShareCardModel {
  const big = period === 'today' ? data.todayDone : period === 'week' ? data.weekDone : data.periodDone;
  const agentDone = data.leaders.filter(l => l.kind === 'node').reduce((a, l) => a + l.n, 0);
  const userDone = data.leaders.filter(l => l.kind === 'user').reduce((a, l) => a + l.n, 0);
  const share = agentShare(data.leaders);
  const humans = data.leaders.filter(l => l.kind === 'user').length;
  const agents = data.leaders.filter(l => l.kind === 'node').length;
  const start = periodStart(period, now);
  const dateLabel = start === null || period === 'today' ? ymd(now).replace(/-/g, '.') : `${ymd(start).replace(/-/g, '.')} – ${ymd(now).slice(5).replace('-', '.')}`;
  const best = busiestDay(data.daily);
  const mods = shareModules(data.daily);
  const byDate = new Map(data.daily.map(d => [d.date, d.n]));
  const chartDays = mods.chart ? dayList(now, mods.chart === '30d' ? 30 : 7) : [];
  const chartSum = chartDays.reduce((a, d) => a + (byDate.get(d) ?? 0), 0);
  const allSum = data.daily.reduce((a, d) => a + d.n, 0);
  return {
    period,
    reportLabel: tr(`card.report.${period}`),
    dateLabel,
    kicker: tr(`card.kicker.${period}`),
    big,
    unit: tr('card.unit'),
    agentLine: agentDone && share !== null ? tr('card.byAgentsPct', { n: agentDone, p: pctText(share) }) : null,
    stats: [
      period === 'today' ? { label: tr('dash.weekDone'), value: String(data.weekDone), unit: tr('card.statUnit') } : { label: tr('dash.todayDone'), value: String(data.todayDone), unit: tr('card.statUnit') },
      best ? { label: tr('card.best'), value: String(best.n), unit: tr('card.bestUnit', { md: mdDot(best.date) }) } : { label: tr('card.best'), value: '—', unit: '' },
      { label: tr('card.crew'), value: String(humans + agents), unit: tr('card.crewUnit', { h: humans, a: agents }) },
    ],
    titlesHeading: period === 'today' ? tr('card.titles.today') : tr('card.titles.period'),
    titlesRight: tr('card.titlesTotal', { n: big }),
    titles: data.recent.filter(r => !excluded.has(r.id)).map(r => ({ text: titleText(r), who: shareName(r.by, people) })),
    total: big,
    moreTitlesLabel: n => tr('card.moreTitles', { n }),
    chart: mods.chart ? {
      heading: mods.chart === '30d' ? tr('card.daily') : tr('card.daily7'),
      right: tr('card.chartRight', { n: chartSum, avg: (chartSum / chartDays.length).toFixed(1) }),
      bars: chartDays.map((d, i) => ({
        n: byDate.get(d) ?? 0,
        label: i === chartDays.length - 1 ? tr('dash.today') : mods.chart === '7d' || i % 7 === (chartDays.length - 1) % 7 ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '',
      })),
    } : null,
    heat: mods.heatWeeks ? {
      heading: tr('card.year'),
      right: tr('dash.total', { n: allSum }),
      cells: heatCells(data.daily, mods.heatWeeks).map(c => ({ row: c.row, col: c.col, level: c.level })),
    } : null,
    who: data.leaders.length ? {
      heading: tr('card.who'),
      right: tr('card.top'),
      agentLabel: tr('card.whoAgent', { n: agentDone, p: pctText(agentDone / Math.max(1, agentDone + userDone)) }),
      userLabel: tr('card.whoUser', { n: userDone, p: pctText(userDone / Math.max(1, agentDone + userDone)) }),
      agent: agentDone, user: userDone,
      top: data.leaders.slice(0, 3).map(l => ({ name: shareName(l, people) ?? '', sub: `${tr('card.topItem', { n: l.n })} · ${l.kind === 'node' ? tr('dash.agent') : tr('dash.member')}` })),
    } : null,
    brand: 'ANet',
    brandSub: tr('card.brandSub'),
    footer: tr('card.footer', { h: humans, a: agents }),
    link: 'github.com/sleep2agi/agent-network',
    approxNote: data.approx ? tr('card.approx') : null,
  };
}
