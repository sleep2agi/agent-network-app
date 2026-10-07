// ck-style self-executing test (run by scripts/run-tests.mjs under bun). NOT bun:test.
// 节点页就地编辑定时任务(owner 2026-10-07):点一行 → 编辑器(不切页面);保存 → PATCH + 列表就地刷新;
// 有没保存的修改 → 关闭先确认;「＋ 新建」→ 执行节点预填为这个节点。纯逻辑(schedule-editor-model.ts)+ 接线(源码)。
import { readFileSync } from 'node:fs';
import type { HubScheduledTask } from './api';
import { ScheduledTaskError } from './api';
import type { NodeScheduleRow } from './node-schedules';
import {
  afterEditorSaved,
  closeIntent,
  createEditorFor,
  editorPropsOf,
  formSnapshot,
  isFormDirty,
  nodeRowClick,
  saveScheduleEdit,
  type ScheduleFormState,
  type ScheduleSaveApi,
} from './schedule-editor-model';
import { fieldsOf } from './schedule-edit-merge';

let passed = 0;
const ck = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) { console.error(`FAIL: ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); process.exit(1); }
  passed++;
};

// 占位 id / alias,不用任何真实节点名。
const ME = 'node_fixture_a';
const sched = (over: Partial<HubScheduledTask> = {}): HubScheduledTask => ({
  schedule_id: 'sched_x', network_id: 'net_fixture', name: '团队巡检', target_node_id: ME, target_alias: 'fixture-a',
  task_content: '看一眼', priority: 'normal', schedule: { type: 'interval', every_seconds: 120 }, timezone: 'Asia/Shanghai',
  status: 'active', next_run_at: '2026-10-07T04:02:00.000Z', last_run_at: '2026-10-07T04:00:00.000Z', revision: 3, ...over,
});
const row = (over: Partial<NodeScheduleRow>): Pick<NodeScheduleRow, 'source' | 'scheduleId'> => ({ source: 'hub', scheduleId: 'sched_x', ...over });

// ── 1. 点一行:Hub 计划就地打开编辑器,不切页面 ────────────────────────────────
{
  const hub = [sched(), sched({ schedule_id: 'sched_y', name: '另一条' })];
  // 宿主(NodeSchedulesSection.openRow)的同一形状:editor → setEditor;navigate → 去定时任务页。
  const navigations: unknown[] = [];
  let opened: unknown = null;
  const click = nodeRowClick(row({ scheduleId: 'sched_y' }), hub, ME, 1);
  if (click.kind === 'editor') opened = click.state;
  else if (click.kind === 'navigate') navigations.push(click.request);
  ck('hub row ⇒ editor (no route change)', click.kind === 'editor' && navigations.length === 0);
  ck('hub row ⇒ edits exactly that schedule', (opened as any)?.kind === 'edit' && (opened as any)?.row?.schedule_id === 'sched_y');
  ck('editor gets the row captured at click time (polling replaces the list, not the open form)', (opened as any)?.row === hub[1]);
  ck('hub row that vanished from the list ⇒ nothing (no navigation either)', nodeRowClick(row({ scheduleId: 'gone' }), hub, ME, 1).kind === 'none');
  const ext = nodeRowClick(row({ source: 'node', scheduleId: 'cron_1' }), hub, ME, 7);
  ck('node plan (crontab) still opens the schedules screen at that row', ext.kind === 'navigate' && JSON.stringify(ext.request) === JSON.stringify({ kind: 'node', nodeId: ME, scheduleId: 'cron_1', seq: 7 }));
  const edit = editorPropsOf({ kind: 'edit', row: hub[0] });
  ck('edit props: editing = the row, no copy, no prefilled target', edit.editing === hub[0] && edit.copyFrom === null && edit.initialTarget === undefined);
  const copy = editorPropsOf({ kind: 'copy', row: hub[0] });
  ck('copy props: a new schedule prefilled from the row (source untouched)', copy.editing === null && copy.copyFrom === hub[0]);
  ck('closed editor: nothing to edit', editorPropsOf(null).editing === null && editorPropsOf(null).copyFrom === null);
}

// ── 2. 新建:执行节点预填为当前节点 ─────────────────────────────────────────
{
  const state = createEditorFor(ME);
  const props = editorPropsOf(state);
  ck('新建 ⇒ create editor for this node', state.kind === 'create' && state.nodeId === ME);
  ck('新建 ⇒ initialTarget = this node, empty form (not editing, not a copy)', props.initialTarget === ME && props.editing === null && props.copyFrom === null);
}

// ── 3. 保存:调用 update API,然后宿主就地刷新列表 ─────────────────────────────
const conflict409 = () => new ScheduledTaskError('revision conflict', 409, 'revision_conflict');
const fakeApi = (opts: { failFirst?: unknown; latest?: HubScheduledTask | undefined; refetchThrows?: boolean } = {}) => {
  const updates: { row: HubScheduledTask; input: unknown }[] = [];
  let refetches = 0;
  const api: ScheduleSaveApi = {
    update: async (r, input) => {
      updates.push({ row: r, input });
      if (opts.failFirst && updates.length === 1) throw opts.failFirst;
    },
    refetch: async () => { refetches++; if (opts.refetchThrows) throw new Error('offline'); return opts.latest; },
    is409Conflict: e => e instanceof ScheduledTaskError && e.status === 409 && e.code === 'revision_conflict',
  };
  return { api, updates, refetches: () => refetches };
};
{
  const base = sched();
  const input = { ...fieldsOf(base), task: '看两眼', schedule: { type: 'interval' as const, every_seconds: 300 } };
  const { api, updates } = fakeApi();
  const out = await saveScheduleEdit(api, base, input);
  ck('save ⇒ update API called once with the opened row (its revision) and the form input', updates.length === 1 && updates[0].row === base && updates[0].input === input);
  ck('save ⇒ saved', out.kind === 'saved');

  const order: string[] = [];
  let reloads = 0;
  await afterEditorSaved(() => order.push('close'), async () => { reloads++; order.push('reload'); });
  ck('after save ⇒ editor closes, then the node page list reloads in place (once)', reloads === 1 && order.join(',') === 'close,reload');

  // 编辑途中计划跑了一次(旧 Hub 每次执行 revision +1):没有同字段冲突 ⇒ 合并后自动重试一次,用最新 revision。
  const latest = sched({ revision: 4, last_run_at: '2026-10-07T04:02:00.000Z' });
  const retry = fakeApi({ failFirst: conflict409(), latest });
  const out2 = await saveScheduleEdit(retry.api, base, input);
  ck('409 without field conflict ⇒ refetch + one retry on the latest revision ⇒ saved', out2.kind === 'saved' && retry.updates.length === 2 && retry.updates[1].row.revision === 4 && retry.refetches() === 1);
  ck('retry keeps the user\'s edits', (retry.updates[1].input as any).task === '看两眼' && (retry.updates[1].input as any).schedule.every_seconds === 300);

  // 别处把同一字段改成了别的值 ⇒ 停在冲突视图,不自动覆盖。
  const theirs = sched({ revision: 4, task_content: '别人改的' });
  const clash = fakeApi({ failFirst: conflict409(), latest: theirs });
  const out3 = await saveScheduleEdit(clash.api, base, input);
  ck('409 with a same-field clash ⇒ conflict view (no second write)', out3.kind === 'conflict' && out3.keys.includes('task') && clash.updates.length === 1);
  const gone = fakeApi({ failFirst: conflict409(), latest: undefined });
  ck('409 and the schedule is gone ⇒ gone (draft kept)', (await saveScheduleEdit(gone.api, base, input)).kind === 'gone');
  const offline = fakeApi({ failFirst: conflict409(), refetchThrows: true });
  const out5 = await saveScheduleEdit(offline.api, base, input);
  ck('409 and the refetch fails ⇒ refetchFailed with the message', out5.kind === 'refetchFailed' && out5.message === 'offline');
  let threw = false;
  try { await saveScheduleEdit(fakeApi({ failFirst: new Error('HTTP 500') }).api, base, input); } catch { threw = true; }
  ck('other errors are thrown to the form (shown as the form error)', threw);
}

// ── 4. 没保存的修改:关闭先确认 ──────────────────────────────────────────────
{
  const form: ScheduleFormState = {
    name: '团队巡检', task: '看一眼', target: ME, kind: 'interval', when: '', every: '2', unit: 'minutes', clock: '09:00',
    weekdays: [1], misfirePolicy: 'catch_up_once', priority: 'normal', timezone: 'Asia/Shanghai',
  };
  const pristine = formSnapshot(form);
  ck('untouched form ⇒ not dirty ⇒ closes directly', !isFormDirty(pristine, formSnapshot({ ...form })) && closeIntent(false) === 'close');
  ck('edited content ⇒ dirty ⇒ asks before closing', isFormDirty(pristine, formSnapshot({ ...form, task: '看两眼' })) && closeIntent(true) === 'confirm');
  ck('edited cadence ⇒ dirty', isFormDirty(pristine, formSnapshot({ ...form, every: '5' })) && isFormDirty(pristine, formSnapshot({ ...form, unit: 'hours' })));
  ck('switched type and back ⇒ not dirty', !isFormDirty(pristine, formSnapshot({ ...form, kind: 'interval', clock: '10:00' })));
  ck('fields the current type does not use are ignored', !isFormDirty(pristine, formSnapshot({ ...form, when: '2026-10-08T09:00', weekdays: [2, 3] })));
  ck('trailing spaces only ⇒ not dirty (save trims anyway)', !isFormDirty(pristine, formSnapshot({ ...form, name: '团队巡检 ', task: ' 看一眼' })));
  ck('weekday order is not a change', formSnapshot({ ...form, kind: 'weekly', weekdays: [5, 1] }) === formSnapshot({ ...form, kind: 'weekly', weekdays: [1, 5] }));
  ck('not filled yet (pristine null) ⇒ never dirty', !isFormDirty(null, formSnapshot({ ...form, task: 'x' })));
  ck('while saving ⇒ no confirm (the save closes it)', closeIntent(true, true) === 'close');
}

// ── 5. 接线(源码)──────────────────────────────────────────────────────────
{
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const editor = read('./ScheduleEditor.tsx');
  const section = read('./NodeSchedulesSection.tsx');
  const page = read('./NodeDetailScreen.tsx');
  const screen = read('./ScheduledTasksScreen.tsx');
  const has = (label: string, src: string, needle: string) => ck(`wiring: ${label}`, src.includes(needle), needle);
  // 一个编辑器,两处用:定时任务页不再有自己的表单。
  has('global page renders the shared editor', screen, "import ScheduleEditor, {");
  ck('wiring: global page has no form of its own (no draftInput / fillForm / ScheduleFormModal)', !/draftInput|fillForm|ScheduleFormModal|function ScheduleModal\(/.test(screen));
  ck('wiring: the form logic exists once (draftInput / fillForm only in ScheduleEditor.tsx)', [section, page, screen].every(src => !/const draftInput|const fillForm/.test(src)) && /const draftInput = /.test(editor) && /const fillForm = /.test(editor));
  // 点一行 / 新建 不切页面
  has('section: hub row click opens the editor in place', section, "if (click.kind === 'editor') setEditor(click.state);");
  has('section: only node plans navigate', section, "else if (click.kind === 'navigate') onOpenNodePlan?.(click.request);");
  has('section: 新建 opens the editor prefilled with this node', section, 'setEditor(createEditorFor(nodeId))');
  has('section: editor props come from the captured state', section, '{...editorPropsOf(editor)}');
  has('section: save closes + reloads the list in place', section, 'onSaved={() => void afterEditorSaved(() => setEditor(null), load)}');
  has('section: pause/resume/run-now refresh the list, editor stays open', section, 'onChanged: () => void load(),');
  has('section: 复制 swaps the editor to a prefilled copy', section, "onCopy: row => setEditor({ kind: 'copy', row }),");
  ck('wiring: page 新建 no longer navigates to the schedules screen', !page.includes("onOpenScheduled({ kind: 'create'"));
  // 关闭:✕ / 取消 / Esc(RN-web 的 Modal onRequestClose)/ 遮罩 / 安卓返回 全走 requestClose
  has('editor: every close goes through the guard', editor, '<ScheduleModal visible={visible} onClose={requestClose} sheet testID="schedule-form"');
  has('editor: guard asks when dirty', editor, "if (closeIntent(dirty, busy) === 'confirm') setDiscardThen(() => then); else then();");
  has('editor: discard confirm dialog', editor, 'testID="schedule-discard-confirm"');
  has('editor: Esc / Android back reach the guard (Modal onRequestClose = onClose = requestClose)', editor, 'onRequestClose={onClose}');
  // 动作 + 最近执行
  for (const id of ['schedule-editor-run', 'schedule-editor-toggle', 'schedule-editor-copy', 'schedule-editor-cancel-plan', 'schedule-editor-runs']) has(`editor: ${id}`, editor, `testID="${id}"`);
  has('editor: recent runs are the last few', editor, 'fetchScheduledRuns(cfg, scheduleId, EDITOR_RECENT_RUNS)');
  has('editor: 新建 prefills the target from initialTarget', editor, "setTarget(initialTarget ?? '')");
  has('editor: save goes through updateScheduledTask', editor, 'update: (row, input) => updateScheduledTask(cfg, row, input)');
}

console.log(`\n${passed}/${passed} passed`);
process.exit(0);
