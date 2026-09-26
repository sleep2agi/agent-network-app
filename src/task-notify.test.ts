// 0.2.109 任务状态通知的纯逻辑(task-notify.ts):终态分类、首份列表只登记、只提醒「刚到终态」、
// 与消息通知的配对窗口。端到端(真 notifier-runtime)在 notifier-runtime-status-e2e.test.ts。
// ck 式自执行脚本(不是 bun:test)。
import {
  initialPairState,
  initialTaskSeen,
  onMessagePosted,
  onTaskFinished,
  PAIR_GRACE_MS,
  pickTaskFinishes,
  takeExpiredMarks,
  taskLabel,
  taskOutcome,
  taskTitle,
} from './task-notify';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra?: unknown) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra === undefined ? '' : JSON.stringify(extra)); };

const NOW = Date.parse('2026-09-26T02:00:00Z');
const ts = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const T = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ task_id: id, from_name: 'admin', to_name: '通信牛', content: `任务 ${id}\n第二行`, status, created_at: ts(NOW - 60_000), updated_at: ts(NOW), ...extra });

ck('replied / completed = 完成', taskOutcome('replied') === 'done' && taskOutcome('completed') === 'done');
ck('failed / expired / timeout = 失败', taskOutcome('failed') === 'failed' && taskOutcome('expired') === 'failed' && taskOutcome('timeout') === 'failed');
ck('进行中 / 取消 / 空 = 非终态(不提醒)', taskOutcome('running') === null && taskOutcome('delivered') === null && taskOutcome('cancelled') === null && taskOutcome(undefined) === null);
ck('标题 = 第一行,截断带省略号', taskTitle('\n  第一行  内容 \n第二行') === '第一行 内容' && taskTitle('x'.repeat(50)).endsWith('…') && Array.from(taskTitle('x'.repeat(50))).length === 41);
ck('标签文案', taskLabel({ agent: 'A', outcome: 'done', title: 't' }) === '✅ A 完成了任务:t' && taskLabel({ agent: 'A', outcome: 'failed', title: '' }) === '❌ A 任务失败');

// 首份列表:只登记,哪怕里面有刚完成的。
let r = pickTaskFinishes(initialTaskSeen(), [T('1', 'running'), T('2', 'replied', { completed_at: ts(NOW) })], 'admin', NOW);
ck('首份列表只登记不提醒', r.finished.length === 0 && r.seen.seeded);
// running → replied:提醒。
r = pickTaskFinishes(r.seen, [T('1', 'replied'), T('2', 'replied')], 'admin', NOW);
ck('running → replied 提醒一次;本来就终态的不提醒', r.finished.length === 1 && r.finished[0].taskId === '1' && r.finished[0].outcome === 'done' && r.finished[0].title === '任务 1');
r = pickTaskFinishes(r.seen, [T('1', 'replied')], 'admin', NOW + 10_000);
ck('同一终态再拉到不重复提醒', r.finished.length === 0);
// 两拍之间开始又结束:没见过、这次就已终态、终态时间新鲜 → 提醒;陈旧 → 不提醒。
r = pickTaskFinishes(r.seen, [T('3', 'failed', { completed_at: ts(NOW - 30_000) }), T('4', 'failed', { completed_at: ts(NOW - 60 * 60_000), updated_at: ts(NOW - 60 * 60_000) })], 'admin', NOW);
ck('没见过但新鲜的终态 → 提醒;一小时前的 → 不提醒', r.finished.length === 1 && r.finished[0].taskId === '3' && r.finished[0].outcome === 'failed');
r = pickTaskFinishes(r.seen, [T('5', 'replied', { from_name: 'someone-else' })], 'admin', NOW);
ck('不是我发的任务不提醒', r.finished.length === 0);

// 配对。
const f = { taskId: '1', agent: '通信牛', outcome: 'done' as const, title: 't' };
let s = initialPairState();
let a = onTaskFinished(s, f, NOW);
ck('任务先到、没有刚发的消息 → pending', a.action === 'pending' && !!a.state.marks['通信牛']);
let m = onMessagePosted(a.state, '通信牛', { identifier: 'x', body: 'b', channelId: 'c' }, NOW + 5_000);
ck('随后消息到 → 取走标签(一条通知)', m.mark?.taskId === '1' && !m.state.marks['通信牛']);
a = onTaskFinished(m.state, { ...f, taskId: '2' }, NOW + 10_000);
ck('消息刚发过 → relabel(不另发)', a.action === 'relabel');
s = onTaskFinished(initialPairState(), f, NOW).state;
let e = takeExpiredMarks(s, NOW + PAIR_GRACE_MS);
ck('窗口内不过期', e.expired.length === 0);
e = takeExpiredMarks(s, NOW + PAIR_GRACE_MS + 1);
ck('过了窗口 → 过期,单独发', e.expired.length === 1 && Object.keys(e.state.marks).length === 0);
m = onMessagePosted(s, '通信牛', { identifier: 'x', body: 'b', channelId: 'c' }, NOW + PAIR_GRACE_MS + 1);
ck('过期的标签不再贴到消息上', m.mark === null);

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
