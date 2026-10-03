// #506 卡片 / 列表行上的检查项进度 + 最近动静。ck 风格自执行。
// 日期一律注入固定偏移时钟(东八区 / 纽约),结果不随跑测试的机器时区变。
import { activityAgo, cardActivity, checklistProgress, checklistProgressA11y, eventVerbText } from './task-card-activity';
import { activityTime, lastEventFromHub, usableEvent, type RequirementLastEvent } from './requirement-last-event';
import { requirementFromHub } from './requirements-hub';
import { sortRows } from './task-board-model';
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

// ── last_event(Hub ≥ preview.97,agent-network#2308)──
setLanguagePreference('zh');
console.log('# last_event 解析');
const evIso = iso(NOW - 2 * H);
const parsed = lastEventFromHub({ type: 'comment', field: null, actor: { id: 'u1', kind: 'user', display_name: '张三' }, at: evIso, summary: '已经复现，正在修。' });
ck('评论 → type/actor/actorName/summary', !!parsed && parsed.type === 'comment' && parsed.field === null && parsed.actor?.id === 'u1' && parsed.actor.kind === 'user' && parsed.actorName === '张三' && parsed.summary === '已经复现，正在修。');
ck('null / 非对象 / 缺 type / at 读不懂 → null(不抛)', [null, undefined, 'x', 3, {}, { type: 'changed', at: 'nope' }, { type: '', at: evIso }, { type: 'changed' }].every(v => lastEventFromHub(v) === null));
ck('actor null / 形状不对 → actor null', lastEventFromHub({ type: 'changed', field: 'title', actor: null, at: evIso })!.actor === null && lastEventFromHub({ type: 'changed', field: 'title', actor: { id: 'x', kind: 'robot' }, at: evIso })!.actor === null);
ck('display_name null → actorName null;空 summary → null', (() => { const e = lastEventFromHub({ type: 'changed', field: 'owner', actor: { id: 'u1', kind: 'user', display_name: null }, at: evIso, summary: '  ' })!; return e.actorName === null && e.summary === null; })());
const rowNew = requirementFromHub({ id: 'r1', name: 'x', updatedAt: evIso, updated_by: { kind: 'user', id: 'u1' }, last_event: { type: 'created', field: null, actor: null, at: evIso } })!;
const rowNull = requirementFromHub({ id: 'r1', name: 'x', updatedAt: evIso, last_event: null })!;
const rowOld = requirementFromHub({ id: 'r1', name: 'x', updatedAt: evIso })!;
ck('requirementFromHub:有 last_event → lastEvent;null → null;旧 Hub 无字段 → 不出现', rowNew.lastEvent?.type === 'created' && rowNull.lastEvent === null && !('lastEvent' in rowOld));
ck('requirementFromHub:坏的 last_event → null,整行照样读', requirementFromHub({ id: 'r1', name: 'x', last_event: { type: 7 } })?.lastEvent === null);

const ev = (o: Partial<RequirementLastEvent> & { type: string }, atMs = NOW - 2 * H): RequirementLastEvent => ({ field: null, actor: { kind: 'user', id: 'u1' }, actorName: '张三', at: iso(atMs), summary: null, ...o });
const withEv = (e: RequirementLastEvent | null | undefined, updatedMs = NOW - 2 * H) => ({ updatedAt: iso(updatedMs), updatedBy: { kind: 'user' as const, id: 'u1' }, createdAt: created, lastEvent: e });
const line = (e: RequirementLastEvent) => cardActivity(withEv(e), people, NOW, SH)!;

console.log('# last_event → 一句话(zh,每个字段)');
const ZH: [Partial<RequirementLastEvent> & { type: string }, string][] = [
  [{ type: 'created' }, '创建了'],
  [{ type: 'comment', summary: '已经复现' }, '评论了'],
  [{ type: 'changed', field: 'column', summary: 'pool → doing' }, '把状态改成「进行中」'],
  [{ type: 'changed', field: 'column', summary: 'doing → done' }, '把状态改成「完成」'],
  [{ type: 'changed', field: 'column', summary: 'done → pool' }, '把状态改成「需求池」'],
  [{ type: 'changed', field: 'column', summary: 'pool → weird' }, '改了状态'],
  [{ type: 'changed', field: 'column' }, '改了状态'],
  [{ type: 'changed', field: 'priority', summary: 'normal → high' }, '改了优先级'],
  [{ type: 'changed', field: 'owner' }, '改了负责人'],
  [{ type: 'changed', field: 'assignee', summary: 'a → b' }, '改了负责人'],
  [{ type: 'changed', field: 'agent_owner' }, '改了负责 Agent'],
  [{ type: 'changed', field: 'participants' }, '改了参与人'],
  [{ type: 'changed', field: 'due', summary: '— → 2026-10-05' }, '改了预计完成'],
  [{ type: 'changed', field: 'start', summary: '— → 2026-10-01' }, '改了开始时间'],
  [{ type: 'changed', field: 'title', summary: '新标题' }, '改了标题'],
  [{ type: 'changed', field: 'description' }, '改了描述'],
  [{ type: 'changed', field: 'tags', summary: 'bug, ui' }, '改了标签'],
  [{ type: 'changed', field: 'checklist', summary: '2/5' }, '改了检查项'],
  [{ type: 'changed', field: 'checklist_item', summary: '[x] 写测试' }, '勾选了检查项'],
  [{ type: 'changed', field: 'checklist_item', summary: '[ ] 写测试' }, '取消勾选检查项'],
  [{ type: 'changed', field: 'checklist_item' }, '改了检查项'],
  [{ type: 'changed', field: 'project', summary: '— → p1' }, '改了项目'],
  [{ type: 'changed', field: 'parent', summary: '— → r9' }, '改了父任务'],
  [{ type: 'changed', field: 'archived', summary: '0 → 1' }, '归档了'],
  [{ type: 'changed', field: 'archived', summary: 'false → true' }, '归档了'],
  [{ type: 'changed', field: 'archived', summary: '1 → 0' }, '取消归档'],
  [{ type: 'changed', field: 'archived', summary: '1 → —' }, '取消归档'],
  [{ type: 'changed', field: 'archived' }, '更新了'],
  [{ type: 'changed', field: 'some_new_field', summary: 'a → b' }, '更新了'],
  [{ type: 'changed', field: null }, '更新了'],
  [{ type: 'deleted' }, '更新了'],
  [{ type: 'some_future_kind', field: 'column', summary: 'pool → doing' }, '更新了'],
];
for (const [e, verb] of ZH) {
  const a = line(ev(e));
  ck(`${e.type}/${e.field ?? '-'}${e.summary ? `「${e.summary}」` : ''} → 「2 小时前 · 张三${verb}」`, a.text === `2 小时前 · 张三${verb}` && a.source === 'event' && a.verbText === verb, a.text);
}
ck('不露原始 id:没有一句含 pool / doing / done / some_new_field', ZH.every(([e]) => !/pool|doing|done|some_new_field|future/.test(line(ev(e)).text)));
ck('verb 分类:created / commented / changed', line(ev({ type: 'created' })).verb === 'created' && line(ev({ type: 'comment', summary: 'x' })).verb === 'commented' && line(ev({ type: 'changed', field: 'title' })).verb === 'changed' && line(ev({ type: 'changed', field: 'title' })).field === 'title');
ck('eventVerbText 单独可用', eventVerbText({ type: 'changed', field: 'column', summary: 'pool → doing' }).text === '把状态改成「进行中」');

console.log('# 评论预览 / 操作者');
const cm = line(ev({ type: 'comment', summary: '已经复现，\n  正在修。' }));
ck('评论:preview = 正文(压空白一行),text 不含预览', cm.preview === '已经复现， 正在修。' && cm.text === '2 小时前 · 张三评论了', JSON.stringify(cm));
ck('评论:读屏带上预览', cm.a11y === '最近动静：2 小时前 · 张三评论了：已经复现， 正在修。', cm.a11y);
ck('评论没有 summary → 没有预览', line(ev({ type: 'comment' })).preview === null);
ck('非评论的 summary 不当预览(状态的「pool → doing」不出现)', line(ev({ type: 'changed', field: 'column', summary: 'pool → doing' })).preview === null);
const nodeEv = line(ev({ type: 'changed', field: 'column', summary: 'pool → doing', actor: { kind: 'node', id: 'nd1' }, actorName: 'hub里的名字' }));
ck('Agent 操作者:本机名单的名字 + （Agent）、agent=true', nodeEv.text === '2 小时前 · 示例Agent（Agent）把状态改成「进行中」' && nodeEv.actor?.agent === true, nodeEv.text);
const hubName = line(ev({ type: 'comment', actor: { kind: 'user', id: 'u_left' }, actorName: '已离开的成员', summary: 'x' }));
ck('本机名单没有这个人 → 用 Hub 给的 display_name', hubName.text === '2 小时前 · 已离开的成员评论了' && hubName.actor?.known === true, hubName.text);
const noName = line(ev({ type: 'comment', actor: { kind: 'user', id: 'u_zzzzzzzz' }, actorName: null, summary: 'x' }));
ck('名单没有、Hub 也没给名字 → 「未知成员」', /未知成员/.test(noName.text) && noName.actor?.known === false, noName.text);
const anonEv = line(ev({ type: 'changed', field: 'column', summary: 'pool → doing', actor: null, actorName: null }));
ck('actor null → 不写人:「2 小时前 · 把状态改成「进行中」」', anonEv.text === '2 小时前 · 把状态改成「进行中」' && anonEv.actor === null, anonEv.text);

console.log('# 什么时候用 last_event,什么时候退回 #691');
ck('lastEvent undefined(旧 Hub)→ #691「更新」', cardActivity(withEv(undefined), people, NOW, SH)!.text === '2 小时前 · 张三更新' && cardActivity(withEv(undefined), people, NOW, SH)!.source === 'updatedAt');
ck('lastEvent null(没有流水)→ #691', cardActivity(withEv(null), people, NOW, SH)!.source === 'updatedAt');
const newerComment = cardActivity(withEv(ev({ type: 'comment', summary: 'hi' }, NOW - 5 * MIN), NOW - 2 * H), people, NOW, SH)!;
ck('评论比 updated_at 新 → 用评论、时间取评论的(5 分钟前)', newerComment.source === 'event' && newerComment.text === '5 分钟前 · 张三评论了', newerComment.text);
const stale = cardActivity(withEv(ev({ type: 'changed', field: 'title' }, NOW - 3 * H), NOW - 1 * H), people, NOW, SH)!;
ck('last_event 比 updated_at 旧(> 2s)→ 退回「1 小时前 · 张三更新」', stale.source === 'updatedAt' && stale.text === '1 小时前 · 张三更新', stale.text);
ck('同一次写入(相差 < 2s)→ 用 last_event', cardActivity(withEv(ev({ type: 'changed', field: 'title' }, NOW - 2 * H - 1500), NOW - 2 * H), people, NOW, SH)!.source === 'event');
ck('updatedAt 缺但有 last_event → 照样用 last_event', cardActivity({ createdAt: created, lastEvent: ev({ type: 'created' }) }, people, NOW, SH)?.text === '2 小时前 · 张三创建了');
ck('usableEvent:at 读不懂 → null', usableEvent({ updatedAt: iso(NOW), lastEvent: { ...ev({ type: 'created' }), at: 'bad' } }) === null);
ck('activityTime:评论新于 updated_at 取评论;旧 Hub 取 updated_at;都没有 null',
  activityTime(withEv(ev({ type: 'comment' }, NOW - MIN), NOW - H)) === NOW - MIN && activityTime(withEv(undefined, NOW - H)) === NOW - H && activityTime({ updatedAt: null }) === null);

const sorted = sortRows([
  { id: 'a', name: 'a', priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: created, updatedAt: iso(NOW - H) },
  { id: 'b', name: 'b', priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: created, updatedAt: iso(NOW - 2 * H), lastEvent: ev({ type: 'comment', summary: 'x' }, NOW - MIN) },
], { key: 'updated', dir: 'desc' }, people).map(r => r.id).join(',');
ck('「更新时间」排序按卡片上显示的时刻(刚评论的排前面)', sorted === 'b,a', sorted);

setLanguagePreference('en');
console.log('# last_event en');
const EN: [Partial<RequirementLastEvent> & { type: string }, string][] = [
  [{ type: 'created' }, 'created'],
  [{ type: 'comment', summary: 'x' }, 'commented'],
  [{ type: 'changed', field: 'column', summary: 'pool → doing' }, 'moved to In progress'],
  [{ type: 'changed', field: 'column', summary: 'doing → done' }, 'moved to Done'],
  [{ type: 'changed', field: 'column', summary: 'done → pool' }, 'moved to Backlog'],
  [{ type: 'changed', field: 'column', summary: '???' }, 'changed status'],
  [{ type: 'changed', field: 'priority' }, 'changed priority'],
  [{ type: 'changed', field: 'owner' }, 'changed owner'],
  [{ type: 'changed', field: 'agent_owner' }, 'changed agent owner'],
  [{ type: 'changed', field: 'participants' }, 'changed participants'],
  [{ type: 'changed', field: 'due' }, 'changed due date'],
  [{ type: 'changed', field: 'start' }, 'changed start date'],
  [{ type: 'changed', field: 'title' }, 'changed title'],
  [{ type: 'changed', field: 'description' }, 'changed description'],
  [{ type: 'changed', field: 'tags' }, 'changed tags'],
  [{ type: 'changed', field: 'checklist' }, 'changed checklist'],
  [{ type: 'changed', field: 'checklist_item', summary: '[x] a' }, 'checked an item'],
  [{ type: 'changed', field: 'checklist_item', summary: '[ ] a' }, 'unchecked an item'],
  [{ type: 'changed', field: 'project' }, 'changed project'],
  [{ type: 'changed', field: 'parent' }, 'changed parent task'],
  [{ type: 'changed', field: 'archived', summary: '0 → 1' }, 'archived'],
  [{ type: 'changed', field: 'archived', summary: '1 → 0' }, 'unarchived'],
  [{ type: 'changed', field: 'whatever' }, 'updated'],
  [{ type: 'mystery' }, 'updated'],
];
for (const [e, verb] of EN) {
  const a = line(ev(e));
  ck(`${e.type}/${e.field ?? '-'} → 「2h ago · 张三 ${verb}」`, a.text === `2h ago · 张三 ${verb}`, a.text);
}
const cmEn = line(ev({ type: 'comment', summary: 'Reproduced, fixing.' }));
ck('en comment a11y: 「Latest activity: 2h ago · 张三 commented: Reproduced, fixing.」', cmEn.a11y === 'Latest activity: 2h ago · 张三 commented: Reproduced, fixing.', cmEn.a11y);
ck('en anon event: 「2h ago · moved to In progress」', line(ev({ type: 'changed', field: 'column', summary: 'pool → doing', actor: null })).text === '2h ago · moved to In progress');
ck('en agent: 「2h ago · 示例Agent (Agent) commented」', line(ev({ type: 'comment', actor: { kind: 'node', id: 'nd1' } })).text === '2h ago · 示例Agent (Agent) commented');
setLanguagePreference('zh');

console.log('# 接线(源码)');
const board = readFileSync(new URL('./RequirementBoard.tsx', import.meta.url), 'utf8');
const table = readFileSync(new URL('./TaskListTable.tsx', import.meta.url), 'utf8');
ck('看板卡片和手机列表行都画 CardActivityLine', (board.match(/<CardActivityLine /g) ?? []).length === 2);
ck('手机列表行的子任务进度是紧凑胶囊(compact)', /meId=\{meId\} compact \/>/.test(board));
ck('桌面表格标题格有紧凑进度', /<ChecklistCompact item=\{item\} s=\{s\} testID=\{`task-row-checklist-/.test(table));
ck('桌面表格「更新时间」列把更新者写在时间后面', /byInline=\{/.test(table));
ck('桌面看板卡片带评论预览(preview={!!desktop}),手机列表行不带', /<CardActivityLine item=\{item\} people=\{people\} s=\{s\} preview=\{!!desktop\} \/>/.test(board) && /<CardActivityLine item=\{item\} people=\{people\} s=\{s\} \/>/.test(board));
ck('桌面表格有 last_event 时写动词 + 评论预览', /verb: ev\.verbText, preview: ev\.preview \? previewText\(ev\.preview\) : null/.test(table));

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
