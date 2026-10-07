// 定时任务内容的 ⤢ 全屏 + 语音(schedule-content-edit.ts / ScheduleContentFullscreen.tsx)。纯逻辑 + 接线(源码)。
import { readFileSync } from 'node:fs';
import { canSaveContent, contentDirty, isRevisionConflict, saveScheduleContent, SCHEDULE_CONTENT_MAX, type ContentSaveDeps } from './schedule-content-edit';
import { t as translate } from './i18n';
import './i18n-schedules';
import type { HubScheduledTask } from './api';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const row = (over: Partial<HubScheduledTask> = {}): HubScheduledTask => ({
  schedule_id: 'sched_1', network_id: 'net', name: '巡检', target_node_id: 'n', target_alias: 'a', task_content: '原来的内容',
  priority: 'normal', schedule: { type: 'interval', every_seconds: 180 }, timezone: 'Asia/Shanghai', misfire_policy: 'skip', status: 'active', revision: 4, ...over,
});
const conflictErr = () => Object.assign(new Error('revision_conflict'), { status: 409, code: 'revision_conflict' });

// 模拟 Hub:PATCH 只认当前 revision;记下每次 PATCH 发了什么。
function hub(initial: HubScheduledTask) {
  let cur = initial;
  const calls: { revision: number; task: string }[] = [];
  const deps: ContentSaveDeps = {
    patch: async (r, task) => {
      calls.push({ revision: r.revision, task });
      if (r.revision !== cur.revision) throw conflictErr();
      cur = { ...cur, task_content: task, revision: cur.revision + 1 };
      return { schedule: cur };
    },
    refetch: async () => cur,
  };
  return { deps, calls, set: (r: HubScheduledTask) => { cur = r; }, get: () => cur };
}

const main = async () => {
  console.log('# 草稿判定');
  ck('只差首尾空白不算改动(Hub 会 trim)', !contentDirty(row(), '  原来的内容\n') && contentDirty(row(), '新的'));
  ck('能保存:有改动、非空、不超长、没在保存', canSaveContent(row(), '新的', false) && !canSaveContent(row(), '新的', true) && !canSaveContent(row(), '原来的内容', false) && !canSaveContent(row(), '   ', false) && !canSaveContent(row(), 'x'.repeat(SCHEDULE_CONTENT_MAX + 1), false) && canSaveContent(row(), 'x'.repeat(SCHEDULE_CONTENT_MAX), false));
  ck('409 判定按 status + code(不 import api 的类)', isRevisionConflict(conflictErr()) && !isRevisionConflict(Object.assign(new Error('x'), { status: 409, code: 'schedule_cancelled' })) && !isRevisionConflict(null));

  console.log('# 保存');
  {
    const h = hub(row());
    const r = await saveScheduleContent(h.deps, row(), '  新的内容 ');
    ck('一次成功:只发一次,revision 是打开时的,内容 trim 过', r.kind === 'saved' && h.calls.length === 1 && h.calls[0].revision === 4 && h.calls[0].task === '新的内容');
  }
  {
    // 编辑中途计划跑了一次 / 别处改了别的字段:revision 变了,任务内容没变 ⇒ 用最新 revision 自动重试一次。
    const h = hub(row());
    h.set(row({ revision: 5, name: '别人改了名字', last_run_at: '2026-09-30T02:00:00Z' }));
    const r = await saveScheduleContent(h.deps, row(), '新的内容');
    ck('只差 revision:409 → 重读 → 带最新 revision 重试,成功', r.kind === 'saved' && h.calls.length === 2 && h.calls[1].revision === 5 && h.calls[1].task === '新的内容' && h.get().task_content === '新的内容');
    ck('别的字段(名字)不被覆盖', h.get().name === '别人改了名字');
  }
  {
    // 别处把任务内容改成了别的 ⇒ 不盲目重试,交给用户选。
    const h = hub(row());
    h.set(row({ revision: 5, task_content: '别的设备的内容' }));
    const r = await saveScheduleContent(h.deps, row(), '我的内容');
    ck('同一字段两边改得不一样:conflict,带最新那份,只发了一次', r.kind === 'conflict' && r.latest.task_content === '别的设备的内容' && h.calls.length === 1);
    // 「用我的覆盖」= 以最新那份为 base 再存
    const again = await saveScheduleContent(h.deps, (r as any).latest, '我的内容');
    ck('用我的覆盖:按最新 revision 写入我的内容', again.kind === 'saved' && h.calls[1].revision === 5 && h.get().task_content === '我的内容');
  }
  {
    const h = hub(row());
    h.set(row({ revision: 5, task_content: '我的内容' }));
    const r = await saveScheduleContent(h.deps, row(), '我的内容');
    ck('别处已改成和我一样:重试(不报冲突)', r.kind === 'saved' && h.calls.length === 2);
  }
  {
    // 重试时又 409:停下来,不无限重试,带回最新 base。
    let n = 0;
    const r = await saveScheduleContent({ patch: async () => { n++; throw conflictErr(); }, refetch: async () => row({ revision: 4 + n }) }, row(), '新的');
    ck('重试还 409:retryAgain(只重试一次)', r.kind === 'retryAgain' && n === 2 && r.latest.revision === 6);
  }
  {
    const r = await saveScheduleContent({ patch: async () => { throw conflictErr(); }, refetch: async () => undefined }, row(), '新的');
    ck('计划没了:gone', r.kind === 'gone');
    const e = await saveScheduleContent({ patch: async () => { throw new Error('HTTP 500'); }, refetch: async () => row() }, row(), '新的');
    ck('其它错误:error 带原文,不重读', e.kind === 'error' && e.message === 'HTTP 500');
  }

  console.log('# 文案');
  {
    const keys = ['schedules.content.fullscreenA11y', 'schedules.content.placeholder', 'schedules.content.unsaved', 'schedules.content.unsavedForm', 'schedules.content.save', 'schedules.content.saving', 'schedules.content.draft', 'schedules.content.resume', 'schedules.content.discard', 'schedules.content.conflict', 'schedules.content.retryAgain', 'schedules.content.gone', 'schedules.content.saveFailed'];
    ck('键都注册上了', keys.every(k => translate(k) !== k));
    ck('占位字没变(端到端脚本按它找输入框)', translate('schedules.content.placeholder') === '节点收到的任务' || translate('schedules.content.placeholder') === 'What the node receives');
  }

  console.log('# 接线(源码)');
  {
    // 表单(任务内容编辑器 + 保存)在 ScheduleEditor.tsx,409 合并在 schedule-editor-model.ts,详情页仍在 ScheduledTasksScreen.tsx。
    const screen = ['./ScheduledTasksScreen.tsx', './ScheduleEditor.tsx', './schedule-editor-model.ts'].map(src).join('\n');
    const full = src('./ScheduleContentFullscreen.tsx');
    const api = src('./api.ts');
    const editor = src('./TaskDescriptionEditor.tsx');
    ck('详情页和表单都用任务描述同一个编辑器(不复制一份)', /import TaskDescriptionEditor from '\.\/TaskDescriptionEditor'/.test(full) && /import TaskDescriptionEditor from '\.\/TaskDescriptionEditor'/.test(screen) && !/PhoneDescriptionPage|DesktopDescriptionFullscreen|useVoiceInput/.test(screen + full));
    ck('详情页的全屏:fullscreenOnly,不放图片、不走富文本、上限 10000', full.includes('fullscreenOnly') && full.includes('images={false}') && full.includes('richText={false}') && full.includes('maxLength={SCHEDULE_CONTENT_MAX}'));
    ck('表单的任务内容:同样关掉图片 / 富文本,一打开就是编辑框', /<TaskDescriptionEditor[\s\S]*?images=\{false\}[\s\S]*?richText=\{false\}[\s\S]*?initialMode="edit"[\s\S]*?testID="schedule-form-task"/.test(screen));
    ck('表单保存路径没动:仍是 draftInput → save(base…) 的 409 合并', screen.includes('if (base) await save(base, input, false);') && screen.includes('const plan = planConflict(row, latest, input);'));
    ck('详情页保存只发 revision + task', /updateScheduledTaskContent[\s\S]{0,300}\{ revision: row\.revision, task \}/.test(api) && full.includes('updateScheduledTaskContent(cfg, row, task)'));
    ck('只有能编辑的计划给 ⤢ 全屏', /availableActions\.includes\('edit'\) \? \(\s*<Pressable[\s\S]{0,600}testID="schedule-content-fullscreen"/.test(screen));
    ck('手机点卡片进全屏,桌面卡片可选中', screen.includes("{!pointerUi() && availableActions.includes('edit') ? (") && screen.includes('<Text style={s.prompt} selectable testID="schedule-content-card">'));
    ck('退出时没改就丢草稿,改了留着(卡片上继续编辑 / 放弃)', screen.includes('if (!contentDirty(openContentDraft.base, openContentDraft.text)) setContentDraft(openContentDraft.base.schedule_id, null);') && screen.includes('testID="schedule-content-draft-resume"') && screen.includes('testID="schedule-content-draft-discard"'));
    ck('关掉全屏时通知调用方(fullscreenOnly 靠它卸载)', /setPage\(false\);\n\s*onFullscreenClose\?\.\(\);/.test(editor));
    ck('images=false 时 🖼 / 粘贴 / 拖入都关', editor.includes('const pickImage = imagesOn ?') && editor.includes('useImageIntake(imagesOn && pointer && shown') && editor.includes('{inlineEditable && imagesOn ? ('));
  }
  console.log(`${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
};
void main();
