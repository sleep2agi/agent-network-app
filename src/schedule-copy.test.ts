// ck 测试:定时任务「复制」预填新建表单(schedule-copy.ts)。owner 2026-09-29:「这个定时任务要支持一下复制的功能…然后可以去改里面的东西」。
import { nextFutureRunAt, scheduleCopyDraft } from './schedule-copy';
import { SCHEDULE_EDIT_KEYS } from './schedule-edit-merge';
import type { HubScheduledTask } from './api';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

const NOW = Date.parse('2026-09-29T10:00:00.000Z');
const row = (over: Partial<HubScheduledTask> = {}): HubScheduledTask => ({
  schedule_id: 'sched_1', network_id: 'net_a', name: '每周巡检', target_node_id: 'node_a', target_alias: '节点甲',
  task_content: '检查一遍日志', priority: 'high', schedule: { type: 'weekly', time: '08:30', weekdays: [1, 3, 5] }, timezone: 'America/Los_Angeles',
  misfire_policy: 'skip', status: 'active', next_run_at: '2026-09-30T15:30:00.000Z', last_run_at: '2026-09-28T15:30:00.000Z', revision: 7,
  ...over,
});

// 1. 每个表单字段都被带过来(名称单独看后缀)。
{
  const src = row();
  const { fields, adjustedFrom } = scheduleCopyDraft(src, NOW, ' 副本');
  ck('copies every form field (7 keys)', SCHEDULE_EDIT_KEYS.length === 7 && Object.keys(fields).sort().join() === [...SCHEDULE_EDIT_KEYS].sort().join());
  ck('target node', fields.target_node_id === 'node_a');
  ck('task content', fields.task === '检查一遍日志');
  ck('priority', fields.priority === 'high');
  ck('timezone', fields.timezone === 'America/Los_Angeles');
  ck('misfire policy', fields.misfire_policy === 'skip');
  ck('weekly spec (time + weekdays)', fields.schedule.type === 'weekly' && fields.schedule.time === '08:30' && fields.schedule.weekdays.join() === '1,3,5');
  ck('recurring schedule is not adjusted', adjustedFrom === null);
}
// 2. 名称后缀按调用方给的语言。
{
  ck('zh suffix 「 副本」', scheduleCopyDraft(row(), NOW, ' 副本').fields.name === '每周巡检 副本');
  ck('en suffix " copy"', scheduleCopyDraft(row({ name: 'Weekly check' }), NOW, ' copy').fields.name === 'Weekly check copy');
}
// 3. interval / daily 原样带过来;缺 misfire_policy 的老行按表单默认补跑一次。
{
  const iv = scheduleCopyDraft(row({ schedule: { type: 'interval', every_seconds: 7200 } }), NOW, ' 副本').fields.schedule;
  ck('interval spec', iv.type === 'interval' && iv.every_seconds === 7200);
  const daily = scheduleCopyDraft(row({ schedule: { type: 'daily', time: '21:05' } }), NOW, ' 副本').fields.schedule;
  ck('daily spec', daily.type === 'daily' && daily.time === '21:05');
  const legacy = scheduleCopyDraft(row({ misfire_policy: undefined as unknown as HubScheduledTask['misfire_policy'] }), NOW, ' 副本').fields;
  ck('missing misfire policy ⇒ catch_up_once', legacy.misfire_policy === 'catch_up_once');
}
// 4. 单次计划:过去的时间顺延整天到未来(保留几点几分)并报出原时间;未来的原样不动。
{
  const past = '2026-09-20T09:00:00.000Z';
  const { fields, adjustedFrom } = scheduleCopyDraft(row({ status: 'completed', schedule: { type: 'once', run_at: past } }), NOW, ' 副本');
  const at = fields.schedule.type === 'once' ? Date.parse(fields.schedule.run_at) : NaN;
  ck('past one-shot is moved into the future', at > NOW);
  ck('moved by whole days (same wall-clock minute)', (at - Date.parse(past)) % 86_400_000 === 0);
  ck('moved to the next such slot, not further', at - NOW <= 86_400_000);
  ck('the original time is reported for the hint', adjustedFrom === past);
  const future = '2026-10-01T09:00:00.000Z';
  const kept = scheduleCopyDraft(row({ schedule: { type: 'once', run_at: future } }), NOW, ' 副本');
  ck('future one-shot kept as is', kept.fields.schedule.type === 'once' && kept.fields.schedule.run_at === future && kept.adjustedFrom === null);
  ck('a time only 1 min ahead is still pushed (≥5 min lead)', Date.parse(nextFutureRunAt('2026-09-29T10:01:00.000Z', NOW)) === Date.parse('2026-09-30T10:01:00.000Z'));
  ck('unparsable run_at ⇒ a future time, never a past one', Date.parse(nextFutureRunAt('garbage', NOW)) > NOW);
}
// 5. 源计划不被改:深比较前后一致,weekdays 不共用同一个数组。
{
  const src = row();
  const before = JSON.stringify(src);
  const { fields } = scheduleCopyDraft(src, NOW, ' 副本');
  if (fields.schedule.type === 'weekly') fields.schedule.weekdays.push(0);
  fields.name = 'x';
  ck('source row unchanged after copying and editing the draft', JSON.stringify(src) === before);
  const once = row({ schedule: { type: 'once', run_at: '2026-09-20T09:00:00.000Z' } });
  const onceBefore = JSON.stringify(once);
  scheduleCopyDraft(once, NOW, ' 副本');
  ck('source one-shot keeps its past run_at', JSON.stringify(once) === onceBefore);
}
// 6. 详情页真的把「复制」接到新建表单(源码层:按钮 + 用 scheduleCopyDraft 预填 + 保存走 createScheduledTask)。
{
  const { readFileSync } = await import('node:fs');
  const src = ['./ScheduledTasksScreen.tsx', './ScheduleEditor.tsx', './schedule-editor-model.ts'].map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  ck('detail renders the copy action', src.includes("availableActions.includes('copy')") && src.includes("t('schedules.copy.action')"));
  ck('form prefills via scheduleCopyDraft', src.includes('scheduleCopyDraft(copyFrom'));
  const { t: tr } = await import('./i18n');
  await import('./i18n-schedules');
  ck('copy strings registered', ['schedules.copy.action', 'schedules.copy.suffix', 'schedules.copy.adjusted', 'schedules.once.past'].every(k => tr(k) !== k));
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
