// ck 测试:编辑遇 409 时草稿的三方合并(schedule-edit-merge.ts)。owner 2026-09-29 的现场:
// 每 2 分钟一次的计划,编辑任务内容中途跑了一次 → 旧 Hub revision +1 → 409 → 草稿被扔。
import { changedKeys, fieldsOf, mergeDraft, planConflict, sameField, type ScheduleEditFields } from './schedule-edit-merge';
import type { HubScheduledTask } from './api';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

const base: HubScheduledTask = {
  schedule_id: 'sched_1', network_id: 'net_a', name: '巡检', target_node_id: 'node_a', target_alias: '节点甲',
  task_content: '检查一遍', priority: 'normal', schedule: { type: 'interval', every_seconds: 120 }, timezone: 'Asia/Shanghai',
  misfire_policy: 'catch_up_once', status: 'active', next_run_at: '2026-09-29T10:02:00.000Z', last_run_at: '2026-09-29T10:00:00.000Z', revision: 4,
};
const draftOf = (over: Partial<ScheduleEditFields> = {}): ScheduleEditFields => ({ ...fieldsOf(base), ...over });

// 1. 只有执行状态变了(旧 Hub 的 run 把 revision +1):自动重试,带用户的新内容和新 revision。
{
  const latest = { ...base, revision: 5, last_run_at: '2026-09-29T10:02:00.000Z', next_run_at: '2026-09-29T10:04:00.000Z' };
  const plan = planConflict(base, latest, draftOf({ task: '检查两遍' }));
  ck('run-only change ⇒ retry', plan.kind === 'retry');
  ck('retry keeps the user edit', plan.kind === 'retry' && plan.input.task === '检查两遍');
  ck('retry targets the new revision', plan.kind === 'retry' && plan.base.revision === 5);
}
// 2. 别处改了另一项:合并(不回滚别人的名字),仍自动重试。
{
  const latest = { ...base, revision: 5, name: '每日巡检' };
  const plan = planConflict(base, latest, draftOf({ task: '检查两遍' }));
  ck('disjoint fields ⇒ retry', plan.kind === 'retry');
  ck('merge keeps their name', plan.kind === 'retry' && plan.input.name === '每日巡检');
  ck('merge keeps my task', plan.kind === 'retry' && plan.input.task === '检查两遍');
}
// 3. 同一项两边改成不同值:冲突视图,只列那一项。
{
  const latest = { ...base, revision: 5, task_content: '别人的内容', name: '每日巡检' };
  const plan = planConflict(base, latest, draftOf({ task: '检查两遍' }));
  ck('same field, different values ⇒ conflict', plan.kind === 'conflict');
  ck('conflict lists only the overlapping key', plan.kind === 'conflict' && plan.keys.join() === 'task');
  ck('conflict carries the latest row', plan.kind === 'conflict' && plan.base.revision === 5);
  const mine = mergeDraft(base, latest, draftOf({ task: '检查两遍' }), 'mine');
  ck('「用我的覆盖」: my task + their name', mine.task === '检查两遍' && mine.name === '每日巡检');
  const theirs = mergeDraft(base, latest, draftOf({ task: '检查两遍', priority: 'high' }), 'theirs');
  ck('「用最新的」: their task, my untouched-by-them priority survives', theirs.task === '别人的内容' && theirs.priority === 'high');
}
// 4. 两边改成同一个值:不算冲突。
{
  const latest = { ...base, revision: 5, task_content: '检查两遍' };
  ck('same field, same value ⇒ retry', planConflict(base, latest, draftOf({ task: '检查两遍' })).kind === 'retry');
}
// 5. 计划没了。
ck('missing latest ⇒ gone', planConflict(base, undefined, draftOf()).kind === 'gone');
// 6. 比较口径:表单回写的空白、单次时间截到分钟、缺省的 misfire、星期顺序,都不算「改了」。
{
  ck('trim-insensitive strings', sameField('task', ' a ', 'a'));
  const once = { ...base, schedule: { type: 'once' as const, run_at: '2026-09-30T01:00:27.500Z' } };
  ck('once compares at minute precision', changedKeys(fieldsOf(once), { ...fieldsOf(once), schedule: { type: 'once', run_at: '2026-09-30T01:00:00.000Z' } }).length === 0);
  ck('once minute change is a change', changedKeys(fieldsOf(once), { ...fieldsOf(once), schedule: { type: 'once', run_at: '2026-09-30T01:01:00.000Z' } }).join() === 'schedule');
  const noPolicy = { ...base, misfire_policy: undefined };
  ck('missing misfire_policy reads as the form default', changedKeys(fieldsOf(noPolicy), draftOf()).length === 0);
  const weekly = { ...base, schedule: { type: 'weekly' as const, time: '09:00', weekdays: [5, 1] } };
  ck('weekday order is not a change', changedKeys(fieldsOf(weekly), { ...fieldsOf(weekly), schedule: { type: 'weekly', time: '09:00', weekdays: [1, 5] } }).length === 0);
  ck('interval ↔ daily is a change', !sameField('schedule', { type: 'interval', every_seconds: 60 }, { type: 'daily', time: '09:00' }));
  ck('an untouched draft has no changed keys', changedKeys(fieldsOf(base), draftOf()).length === 0);
}
// 7. 表单接线:409 分支不再关表单 / 丢草稿;轮询不重置打开着的表单。
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
  ck('no onConflict that closes the form', !/onConflict/.test(src));
  ck('409 path goes through planConflict', /planConflict\(row, latest, input\)/.test(src));
  const effect = src.match(/setError\(''\); setConflict\(null\); setBase\(editing\);[\s\S]*?\}, \[([^\]]*)\]\);/);
  ck('form fill effect is keyed on visible/editing only (not the polled list)', !!effect && !/items|nodes/.test(effect[1]));
}

// 8. 冲突视图用到的每个 t() 键都有中英文(本屏还不在 i18n-copy-guard 的迁移名单里,这里单独守)。
{
  const { readFileSync } = await import('node:fs');
  const { t: tr } = await import('./i18n');
  await import('./i18n-schedules');
  // The screen also renders skip-group rows (#521), whose strings register in schedule-run-groups.
  await import('./schedule-run-groups');
  const src = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/\bt\('([\w.]+)'/g)].map(m => m[1]);
  const dynamic = ['name', 'target_node_id', 'task', 'priority', 'timezone', 'schedule', 'misfire_policy'].map(k => `schedules.field.${k}`)
    .concat(['high', 'normal', 'low'].map(k => `schedules.priority.${k}`));
  const missing = [...keys, ...dynamic].filter(k => tr(k) === k);
  ck(`every schedules.* key is translated (${keys.length} literal + ${dynamic.length} dynamic)${missing.length ? ': ' + missing.join(', ') : ''}`, keys.length >= 10 && missing.length === 0);
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
