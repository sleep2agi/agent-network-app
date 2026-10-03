// #506 卡片 / 列表行上的检查项进度 + 最近动静。ck 风格自执行。
// 日期一律注入固定偏移时钟(东八区 / 纽约),结果不随跑测试的机器时区变。
import { activityAgo, cardActivity, checklistProgress, checklistProgressA11y } from './task-card-activity';
import { checklistCounts } from './board-sync';
import { fixedOffsetClock } from './due-time';
import { setLanguagePreference } from './i18n';
import { readFileSync } from 'node:fs';
import type { RequirementPerson } from './requirement-people';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const SH = fixedOffsetClock(480);
const NY = fixedOffsetClock(-240);
const NOW = Date.parse('2026-10-03T04:00:00Z'); // 东八区 12:00
const ago = (ms: number) => NOW - ms;
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

setLanguagePreference('zh');
console.log('# 检查项进度');
ck('没有检查项(total 0)→ null,不画', checklistProgress({ total: 0, done: 0 }) === null);
ck('缺(undefined / null)→ null', checklistProgress(undefined) === null && checklistProgress(null) === null);
ck('坏值(NaN / 负数)→ null', checklistProgress({ total: Number.NaN, done: 1 }) === null && checklistProgress({ total: -3, done: 0 }) === null);
const p35 = checklistProgress({ total: 5, done: 3 })!;
ck('3/5 → ratio 0.6、60%、未完成', p35.done === 3 && p35.total === 5 && Math.abs(p35.ratio - 0.6) < 1e-9 && p35.pct === 60 && !p35.complete);
ck('0/4 → 0%、未完成', checklistProgress({ total: 4, done: 0 })!.pct === 0 && !checklistProgress({ total: 4, done: 0 })!.complete);
const full = checklistProgress({ total: 5, done: 5 })!;
ck('5/5 → 100%、complete(画成功色)', full.pct === 100 && full.complete);
ck('199/200 不四舍五入成 100%(100% 只留给全勾完)', checklistProgress({ total: 200, done: 199 })!.pct === 99 && !checklistProgress({ total: 200, done: 199 })!.complete);
ck('1/200 → 1%(四舍五入到 0 也行,但不为负)', checklistProgress({ total: 200, done: 1 })!.pct >= 0);
ck('done > total 夹到 total(Hub 给的计数坏了也不画 7/5)', checklistProgress({ total: 5, done: 7 })!.done === 5);
ck('done 负数夹到 0', checklistProgress({ total: 5, done: -2 })!.done === 0);
ck('小数取整', checklistProgress({ total: 5.9, done: 2.7 })!.total === 5 && checklistProgress({ total: 5.9, done: 2.7 })!.done === 2);
ck('完整行按条目数', JSON.stringify(checklistProgress(checklistCounts({ checklist: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: false }] }))) === JSON.stringify({ done: 1, total: 2, ratio: 0.5, pct: 50, complete: false }));
ck('精简行按 Hub 的 checklist_count', checklistProgress(checklistCounts({ checklistCount: { total: 7, done: 3 } }))!.total === 7);
ck('空的条目数组 → null', checklistProgress(checklistCounts({ checklist: [] })) === null);
ck('读屏文字 zh', checklistProgressA11y(p35) === '检查项 3/5' && checklistProgressA11y(full) === '检查项全部完成 5/5');

console.log('# 相对时间(zh)');
ck('不到 1 分钟 → 刚刚', activityAgo(NOW - 59_999, NOW, SH) === '刚刚');
ck('正好 1 分钟 → 1 分钟前', activityAgo(NOW - MIN, NOW, SH) === '1 分钟前');
ck('59 分 59 秒 → 59 分钟前', activityAgo(NOW - H + 1000, NOW, SH) === '59 分钟前');
ck('正好 1 小时 → 1 小时前', activityAgo(NOW - H, NOW, SH) === '1 小时前');
ck('23 小时 59 分 → 23 小时前', activityAgo(NOW - D + MIN, NOW, SH) === '23 小时前');
ck('正好 1 天 → 1 天前', activityAgo(NOW - D, NOW, SH) === '1 天前');
ck('6 天 23 小时 → 6 天前', activityAgo(NOW - 7 * D + H, NOW, SH) === '6 天前');
ck('满 7 天 → 本地日期 9月26日', activityAgo(NOW - 7 * D, NOW, SH) === '9月26日', activityAgo(NOW - 7 * D, NOW, SH));
ck('跨年 → 带年份', activityAgo(Date.parse('2025-12-31T02:00:00Z'), NOW, SH) === '2025年12月31日');
ck('日期按本地时区算(UTC 9-20 20:00 = 东八区 9-21、纽约 9-20)',
  activityAgo(Date.parse('2026-09-20T20:00:00Z'), NOW, SH) === '9月21日' && activityAgo(Date.parse('2026-09-20T20:00:00Z'), NOW, NY) === '9月20日');
ck('未来时刻(本机时钟慢)→ 刚刚,不写负数', activityAgo(NOW + 5 * MIN, NOW, SH) === '刚刚');
ck('NaN → 刚刚(不抛)', activityAgo(Number.NaN, NOW, SH) === '刚刚');

const people: RequirementPerson[] = [
  { kind: 'user', id: 'u1', networkId: 'n', name: '张三' } as RequirementPerson,
  { kind: 'node', id: 'nd1', networkId: 'n', name: '示例Agent' } as RequirementPerson,
];
const iso = (ms: number) => new Date(ms).toISOString();
const created = iso(NOW - 3 * D);

console.log('# 最近动静(zh)');
const human = cardActivity({ updatedAt: iso(NOW - 2 * H), updatedBy: { kind: 'user', id: 'u1' }, createdAt: created }, people, NOW, SH)!;
ck('人类:「2 小时前 · 张三更新」', human.text === '2 小时前 · 张三更新' && human.verb === 'updated' && human.actor?.agent === false && human.actor.known, human.text);
ck('读屏前缀', human.a11y === '最近动静：2 小时前 · 张三更新');
const agent = cardActivity({ updatedAt: iso(NOW - 5 * MIN), updatedBy: { kind: 'node', id: 'nd1' }, createdAt: created }, people, NOW, SH)!;
ck('Agent:标出 Agent、agent=true', agent.text === '5 分钟前 · 示例Agent（Agent）更新' && agent.actor?.agent === true, agent.text);
const unknown = cardActivity({ updatedAt: iso(NOW - 5 * MIN), updatedBy: { kind: 'user', id: 'u_zzzzzzzz' }, createdAt: created }, people, NOW, SH)!;
ck('认不出的人 → 「未知成员」,不露裸 id 全文', unknown.actor?.known === false && /未知成员/.test(unknown.text), unknown.text);
const anon = cardActivity({ updatedAt: iso(NOW - 3 * H), updatedBy: null, createdAt: created }, people, NOW, SH)!;
ck('没有 updated_by → 「3 小时前更新」', anon.text === '3 小时前更新' && anon.actor === null, anon.text);
const fresh = cardActivity({ updatedAt: created, updatedBy: { kind: 'user', id: 'u1' }, createdAt: created }, people, NOW, SH)!;
ck('updatedAt == createdAt → 「创建」', fresh.verb === 'created' && fresh.text === '3 天前 · 张三创建', fresh.text);
ck('updatedAt 缺(旧 Hub)→ null', cardActivity({ updatedBy: null, createdAt: created }, people, NOW, SH) === null);
ck('updatedAt null / 空 / 读不懂 → null', [null, '', 'not-a-date'].every(v => cardActivity({ updatedAt: v as string | null, createdAt: created }, people, NOW, SH) === null));
ck('createdAt 空也能算(按「更新」)', cardActivity({ updatedAt: iso(NOW - MIN), createdAt: '' }, people, NOW, SH)?.verb === 'updated');

setLanguagePreference('en');
console.log('# en');
ck('just now / 5m ago / 2h ago / 3d ago', [activityAgo(NOW, NOW, SH), activityAgo(NOW - 5 * MIN, NOW, SH), activityAgo(NOW - 2 * H, NOW, SH), activityAgo(NOW - 3 * D, NOW, SH)].join('|') === 'just now|5m ago|2h ago|3d ago');
ck('date: Sep 26 / Dec 31, 2025', activityAgo(NOW - 7 * D, NOW, SH) === 'Sep 26' && activityAgo(Date.parse('2025-12-31T02:00:00Z'), NOW, SH) === 'Dec 31, 2025');
const humanEn = cardActivity({ updatedAt: iso(NOW - 2 * H), updatedBy: { kind: 'user', id: 'u1' }, createdAt: created }, people, NOW, SH)!;
ck('human: 「2h ago · 张三 updated」', humanEn.text === '2h ago · 张三 updated', humanEn.text);
const agentEn = cardActivity({ updatedAt: iso(NOW - 2 * H), updatedBy: { kind: 'node', id: 'nd1' }, createdAt: created }, people, NOW, SH)!;
ck('agent: 「2h ago · 示例Agent (Agent) updated」', agentEn.text === '2h ago · 示例Agent (Agent) updated', agentEn.text);
ck('anon: 「Updated 3h ago」/「Created …」', anon && cardActivity({ updatedAt: iso(NOW - 3 * H), createdAt: created }, people, NOW, SH)!.text === 'Updated 3h ago'
  && cardActivity({ updatedAt: created, createdAt: created }, people, NOW, SH)!.text === 'Created 3d ago');
ck('checklist a11y en', checklistProgressA11y(p35) === 'Checklist 3/5' && checklistProgressA11y(full) === 'Checklist complete 5/5');
setLanguagePreference('zh');

console.log('# 接线(源码)');
const board = readFileSync(new URL('./RequirementBoard.tsx', import.meta.url), 'utf8');
const table = readFileSync(new URL('./TaskListTable.tsx', import.meta.url), 'utf8');
ck('看板卡片和手机列表行都画 CardActivityLine', (board.match(/<CardActivityLine /g) ?? []).length === 2);
ck('手机列表行的子任务进度是紧凑胶囊(compact)', /meId=\{meId\} compact \/>/.test(board));
ck('桌面表格标题格有紧凑进度', /<ChecklistCompact item=\{item\} s=\{s\} testID=\{`task-row-checklist-/.test(table));
ck('桌面表格「更新时间」列把更新者写在时间后面', /byInline=\{/.test(table));

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
