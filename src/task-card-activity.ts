// 卡片 / 列表行上不点开就能看到的两样东西(#506):检查项进度 和 最近一次动静。纯逻辑·可单测:task-card-activity.test.ts。
//
// 数据只用列表里已经有的字段(不为它多发请求):
//   - 检查项:完整行有 checklist 条目,精简行(view=summary)有 Hub 给的 checklist_count —— board-sync.ts checklistCounts 统一。
//   - 最近动静:Hub ≥ 0.9.0-preview.97 每行带 last_event(agent-network#2308,含评论)→「2 小时前 · 张三把状态改成「进行中」」
//     「张三评论了」(桌面端在同一行后面跟截断的评论预览)。旧 Hub 不给 last_event / 这张卡没有流水 / last_event 比
//     updated_at 还旧(updated_at 被下面说的顺带推后了)→ 退回 #691 的「2 小时前 · 张三 更新」(updated_at + updated_by)。
//   - updated_at 还会被「项目被删 → 清空 project_id」「母任务被删 → 清空 parent_id」顺带推后,而 updated_by 不变 ——
//     那时显示的人是上一个真改过它的人,时间是被顺带推后的时间。不完美,但不会把人认错成别人。
//   - 评论不改卡(updated_at 不动):增量读(changes=1)读不回只加了评论的卡,要等下一次整读(ETag 会变)才显示「评论了」。
import { registerTranslations, t, currentLanguage } from './i18n';
import { systemClock, type Clock } from './due-time';
import { personDisplay } from './i18n-task-presentation';
import type { RequirementPerson, RequirementPersonRef } from './requirement-people';
import { taskTimestamp } from './task-time';
import { taskText } from './i18n-tasks';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, type ReqColumn, type Requirement } from './requirements-model';
import { usableEvent, type RequirementLastEvent } from './requirement-last-event';

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
  // last_event(#506):「<时间> · <谁><干了什么>」。中文名字和动词之间不空格,英文空一格(同上面的「更新」)。
  'cardAct.ev.created': ['创建了', 'created'],
  'cardAct.ev.comment': ['评论了', 'commented'],
  'cardAct.ev.moved': ['把状态改成「{status}」', 'moved to {status}'],
  'cardAct.ev.column': ['改了状态', 'changed status'],
  'cardAct.ev.priority': ['改了优先级', 'changed priority'],
  'cardAct.ev.owner': ['改了负责人', 'changed owner'],
  'cardAct.ev.agent_owner': ['改了负责 Agent', 'changed agent owner'],
  'cardAct.ev.participants': ['改了参与人', 'changed participants'],
  'cardAct.ev.due': ['改了预计完成', 'changed due date'],
  'cardAct.ev.start': ['改了开始时间', 'changed start date'],
  'cardAct.ev.title': ['改了标题', 'changed title'],
  'cardAct.ev.description': ['改了描述', 'changed description'],
  'cardAct.ev.tags': ['改了标签', 'changed tags'],
  'cardAct.ev.checklist': ['改了检查项', 'changed checklist'],
  'cardAct.ev.checked': ['勾选了检查项', 'checked an item'],
  'cardAct.ev.unchecked': ['取消勾选检查项', 'unchecked an item'],
  'cardAct.ev.project': ['改了项目', 'changed project'],
  'cardAct.ev.parent': ['改了父任务', 'changed parent task'],
  'cardAct.ev.archived': ['归档了', 'archived'],
  'cardAct.ev.unarchived': ['取消归档', 'unarchived'],
  'cardAct.ev.updated': ['更新了', 'updated'],
  'cardAct.previewSep': ['：', ': '],
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

/** 动词的种类:updated / created 是 #691 按 updated_at 推的;commented / changed 只来自 last_event。 */
export type ActivityVerb = 'updated' | 'created' | 'commented' | 'changed';

export interface CardActivity {
  /** 相对时间文字。 */
  ago: string;
  /** 这一行按哪个时刻算的(Date 毫秒)。 */
  at: number;
  verb: ActivityVerb;
  /** changed 时改的字段(last_event.field);其余 null。 */
  field: string | null;
  /** last_event = Hub 的最新动态;updatedAt = 旧 Hub / 退回 #691 的推法。 */
  source: 'event' | 'updatedAt';
  /** 动它的人 / Agent;Hub 没给(旧卡、受限成员看不到的节点)= null。 */
  actor: { name: string; agent: boolean; known: boolean } | null;
  /** 动词文字(「更新」/「把状态改成「进行中」」/ commented …)。 */
  verbText: string;
  /** 评论正文(一行;桌面端在动词后面截断显示,手机不显示)。没有 = null。 */
  preview: string | null;
  /** 一整行(也是测试 / 读屏用的,不含评论预览):「2 小时前 · 张三把状态改成「进行中」」。 */
  text: string;
  /** 读屏:前缀 + text + 评论预览。 */
  a11y: string;
}

const isColumn = (v: string): v is ReqColumn => (REQ_COLUMNS as readonly string[]).includes(v);
/** 「pool → doing」取箭头后面那个;读不懂 = null。 */
const newValue = (summary: string | null): string | null => {
  if (!summary) return null;
  const i = summary.lastIndexOf('→');
  return (i < 0 ? summary : summary.slice(i + 1)).trim() || null;
};

/** 一条 last_event 的动词文字。字段 / 类型不认识(Hub 以后加的)→「更新了」,不露原始 id。 */
export function eventVerbText(ev: Pick<RequirementLastEvent, 'type' | 'field' | 'summary'>): { verb: ActivityVerb; text: string } {
  if (ev.type === 'created') return { verb: 'created', text: t('cardAct.ev.created') };
  if (ev.type === 'comment') return { verb: 'commented', text: t('cardAct.ev.comment') };
  if (ev.type !== 'changed' || !ev.field) return { verb: 'changed', text: t('cardAct.ev.updated') };
  switch (ev.field) {
    case 'column': {
      const to = newValue(ev.summary);
      return { verb: 'changed', text: to && isColumn(to) ? t('cardAct.ev.moved', { status: taskText(REQ_COLUMN_LABEL[to]) }) : t('cardAct.ev.column') };
    }
    case 'owner': case 'assignee': return { verb: 'changed', text: t('cardAct.ev.owner') };
    case 'checklist_item': {
      const s = ev.summary ?? '';
      return { verb: 'changed', text: t(/^\[x\]/i.test(s) ? 'cardAct.ev.checked' : /^\[ \]/.test(s) ? 'cardAct.ev.unchecked' : 'cardAct.ev.checklist') };
    }
    case 'archived': {
      const to = newValue(ev.summary);
      const on = to === '1' || to === 'true', off = to === '0' || to === 'false' || to === '—' || to === 'null';
      return { verb: 'changed', text: t(on ? 'cardAct.ev.archived' : off ? 'cardAct.ev.unarchived' : 'cardAct.ev.updated') };
    }
    case 'priority': case 'agent_owner': case 'participants': case 'due': case 'start': case 'title': case 'description':
    case 'tags': case 'checklist': case 'project': case 'parent':
      return { verb: 'changed', text: t(`cardAct.ev.${ev.field}`) };
    default: return { verb: 'changed', text: t('cardAct.ev.updated') };
  }
}

/** 评论预览前面那个冒号(中文「：」/ 英文「: 」)+ 正文。 */
export const previewText = (preview: string): string => `${t('cardAct.previewSep')}${preview}`;

const actorOf = (ref: RequirementPersonRef, people: readonly RequirementPerson[], hubName: string | null = null): CardActivity['actor'] => {
  const d = personDisplay(ref, people);
  // 本机名单里没有(离开了网络 / 名单还没读到)但 Hub 给了名字 → 用 Hub 的。
  if (!d.known && hubName) return { name: hubName, agent: ref.kind === 'node', known: true };
  return { name: d.name, agent: ref.kind === 'node', known: d.known };
};

function line(ago: string, actor: CardActivity['actor'], verbText: string): string {
  const zh = currentLanguage() === 'zh';
  return actor ? `${ago} · ${actor.name}${actor.agent ? t('cardAct.agent') : ''}${zh ? '' : ' '}${verbText}` : `${ago} · ${verbText}`;
}

/**
 * 卡片底部那一行。
 *   - 有 last_event(Hub ≥ preview.97)且不比 updatedAt 旧 → 「<时间> · <谁><干了什么>」;没有操作者(Hub 隐去 / 系统写入)就只有「<时间> · <干了什么>」。
 *   - 否则(旧 Hub / 没有流水 / 本机刚改完)= #691:updatedAt 缺 / 空 / 读不懂 = null 不画;与 createdAt 同一刻 =「创建」,否则「更新」。
 */
export function cardActivity(
  item: Pick<Requirement, 'updatedAt' | 'updatedBy' | 'createdAt' | 'lastEvent'>,
  people: readonly RequirementPerson[],
  now: number,
  clock: Clock = systemClock,
): CardActivity | null {
  const hit = usableEvent(item);
  if (hit) {
    const { ev, ms } = hit;
    const ago = activityAgo(ms, now, clock);
    const { verb, text: verbText } = eventVerbText(ev);
    const actor = ev.actor ? actorOf(ev.actor, people, ev.actorName) : null;
    const preview = ev.type === 'comment' && ev.summary ? ev.summary.replace(/\s+/g, ' ').trim() || null : null;
    const text = line(ago, actor, verbText);
    const full = preview ? `${text}${previewText(preview)}` : text;
    return { ago, at: ms, verb, field: ev.type === 'changed' ? ev.field : null, source: 'event', actor, verbText, preview, text, a11y: t('cardAct.a11y', { text: full }) };
  }
  const ms = taskTimestamp(item.updatedAt);
  if (ms === null) return null;
  const created = taskTimestamp(item.createdAt);
  const verb = created !== null && Math.abs(created - ms) < 1000 ? 'created' : 'updated';
  const ago = activityAgo(ms, now, clock);
  const verbText = t(verb === 'created' ? 'cardAct.created' : 'cardAct.updated');
  const ref = item.updatedBy ?? null;
  const actor = ref ? actorOf(ref, people) : null;
  const text = actor ? line(ago, actor, verbText) : t(verb === 'created' ? 'cardAct.anonCreated' : 'cardAct.anonUpdated', { ago });
  return { ago, at: ms, verb, field: null, source: 'updatedAt', actor, verbText, preview: null, text, a11y: t('cardAct.a11y', { text }) };
}
