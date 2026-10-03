// 卡片 / 列表行上不点开就能看到的两样东西(#506):检查项进度 和 最近一次动静。纯逻辑·可单测:task-card-activity.test.ts。
//
// 数据只用列表里已经有的字段(不为它多发请求):
//   - 检查项:完整行有 checklist 条目,精简行(view=summary)有 Hub 给的 checklist_count —— board-sync.ts checklistCounts 统一。
//   - 最近动静:Hub 列表行只有 updated_at + updated_by({kind,id}),没有「改了哪个字段」的摘要(那在 requirement_events 里,
//     要按卡逐个查)。所以这里画的是「2 小时前 · 张三 更新」;想要「更新了状态」需要 Hub 在列表行上加一个 last_event 摘要。
//   - updated_at 还会被「项目被删 → 清空 project_id」「母任务被删 → 清空 parent_id」顺带推后,而 updated_by 不变 ——
//     那时显示的人是上一个真改过它的人,时间是被顺带推后的时间。不完美,但不会把人认错成别人。
import { registerTranslations, t, currentLanguage } from './i18n';
import { systemClock, type Clock } from './due-time';
import { personDisplay } from './i18n-task-presentation';
import type { Requirement } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { taskTimestamp } from './task-time';

registerTranslations({
  'cardAct.now': ['刚刚', 'just now'],
  'cardAct.min': ['{n} 分钟前', '{n}m ago'],
  'cardAct.hr': ['{n} 小时前', '{n}h ago'],
  'cardAct.day': ['{n} 天前', '{n}d ago'],
  'cardAct.date': ['{m}月{d}日', '{mon} {d}'],
  'cardAct.dateYear': ['{y}年{m}月{d}日', '{mon} {d}, {y}'],
  'cardAct.updated': ['更新', 'updated'],
  'cardAct.created': ['创建', 'created'],
  'cardAct.anonUpdated': ['{ago}更新', 'Updated {ago}'],
  'cardAct.anonCreated': ['{ago}创建', 'Created {ago}'],
  'cardAct.a11y': ['最近动静：{text}', 'Latest activity: {text}'],
  'cardAct.agent': ['（Agent）', ' (Agent)'],
  'cardAct.progress': ['检查项 {done}/{total}', 'Checklist {done}/{total}'],
  'cardAct.progressDone': ['检查项全部完成 {done}/{total}', 'Checklist complete {done}/{total}'],
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ── 检查项进度 ──────────────────────────────────────────────────────────

export interface ChecklistProgressInfo { done: number; total: number; ratio: number; pct: number; complete: boolean }

/** {total, done} → 画进度要的数。没有检查项(total 0 / 缺 / 坏值)= null,卡片上就不画。done 夹在 [0, total]。 */
export function checklistProgress(c: { total: number; done: number } | null | undefined): ChecklistProgressInfo | null {
  if (!c) return null;
  const total = Number.isFinite(c.total) && c.total > 0 ? Math.floor(c.total) : 0;
  if (!total) return null;
  const done = Number.isFinite(c.done) ? Math.min(total, Math.max(0, Math.floor(c.done))) : 0;
  const ratio = done / total;
  // 没全勾完就不显示 100%(199/200 四舍五入会成 100,和「全部完成」的绿色撞)。
  const pct = done === total ? 100 : Math.min(99, Math.round(ratio * 100));
  return { done, total, ratio, pct, complete: done === total };
}

export const checklistProgressA11y = (p: ChecklistProgressInfo): string =>
  t(p.complete ? 'cardAct.progressDone' : 'cardAct.progress', { done: p.done, total: p.total });

// ── 相对时间 ────────────────────────────────────────────────────────────

/**
 * 「刚刚 / N 分钟前 / N 小时前 / N 天前 / 9月28日 / 2025年12月31日」(英文 just now / 5m ago / 2h ago / 3d ago / Sep 28 / Dec 31, 2025)。
 * 未来的时刻(本机时钟比 Hub 慢)按「刚刚」,不写「-3 分钟前」。7 天及以上写日期,日期按本地(clock)算。
 */
export function activityAgo(ms: number, now: number, clock: Clock = systemClock): string {
  const diff = now - ms;
  if (!Number.isFinite(diff) || diff < MIN) return t('cardAct.now');
  if (diff < HOUR) return t('cardAct.min', { n: Math.floor(diff / MIN) });
  if (diff < DAY) return t('cardAct.hr', { n: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t('cardAct.day', { n: Math.floor(diff / DAY) });
  const at = clock.toLocal(ms), today = clock.toLocal(now);
  const v = { y: at.y, m: at.m, d: at.d, mon: MONTHS[at.m - 1] };
  return t(at.y === today.y ? 'cardAct.date' : 'cardAct.dateYear', v);
}

// ── 最近动静 ────────────────────────────────────────────────────────────

export interface CardActivity {
  /** 相对时间文字。 */
  ago: string;
  verb: 'updated' | 'created';
  /** 动它的人 / Agent;Hub 没给(旧卡、受限成员看不到的节点)= null。 */
  actor: { name: string; agent: boolean; known: boolean } | null;
  /** 动词文字(「更新」/ updated)。 */
  verbText: string;
  /** 一整行(也是测试 / 读屏用的):「2 小时前 · 张三 更新」。 */
  text: string;
  a11y: string;
}

/**
 * 卡片底部那一行。updatedAt 缺(旧 Hub 不给)/ 空 / 读不懂 = null,不画。
 * updatedAt 与 createdAt 是同一刻(建了以后没人动过)= 「创建」。
 */
export function cardActivity(
  item: Pick<Requirement, 'updatedAt' | 'updatedBy' | 'createdAt'>,
  people: readonly RequirementPerson[],
  now: number,
  clock: Clock = systemClock,
): CardActivity | null {
  const ms = taskTimestamp(item.updatedAt);
  if (ms === null) return null;
  const created = taskTimestamp(item.createdAt);
  const verb = created !== null && Math.abs(created - ms) < 1000 ? 'created' : 'updated';
  const ago = activityAgo(ms, now, clock);
  const verbText = t(verb === 'created' ? 'cardAct.created' : 'cardAct.updated');
  const ref = item.updatedBy ?? null;
  const actor = ref ? (() => { const d = personDisplay(ref, people); return { name: d.name, agent: ref.kind === 'node', known: d.known }; })() : null;
  const zh = currentLanguage() === 'zh';
  const text = actor
    ? `${ago} · ${actor.name}${actor.agent ? t('cardAct.agent') : ''}${zh ? '' : ' '}${verbText}`
    : t(verb === 'created' ? 'cardAct.anonCreated' : 'cardAct.anonUpdated', { ago });
  return { ago, verb, actor, verbText, text, a11y: t('cardAct.a11y', { text }) };
}
