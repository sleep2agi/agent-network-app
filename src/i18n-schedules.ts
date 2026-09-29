import { registerTranslations } from './i18n';
// 定时任务编辑冲突(schedule-edit-merge.ts)的界面文案。
registerTranslations({
  'schedules.conflict.title': ['这条计划在你编辑时被改过', 'This schedule changed while you were editing'],
  'schedules.conflict.body': ['下面这些项两边改得不一样，你的草稿还在，选一个处理方式。', 'These fields were changed differently on both sides. Your draft is kept. Choose how to continue.'],
  'schedules.conflict.mine': ['你的修改', 'Your change'],
  'schedules.conflict.theirs': ['最新版本', 'Latest version'],
  'schedules.conflict.useMine': ['用我的覆盖', 'Keep mine'],
  'schedules.conflict.useTheirs': ['用最新的', 'Use latest'],
  'schedules.conflict.keepEditing': ['继续编辑', 'Keep editing'],
  'schedules.conflict.retryAgain': ['保存时计划又被更新了一次，你的修改已保留在表单里，请再点一次保存。', 'The schedule changed again while saving. Your changes are still in the form; save again.'],
  'schedules.conflict.gone': ['这条计划已被取消或删除，无法保存。你的修改仍在表单里，可以复制后新建。', 'This schedule was cancelled or deleted, so it cannot be saved. Your changes are still in the form; copy them into a new schedule.'],
  'schedules.conflict.refetchFailed': ['保存冲突，读取最新版本失败：{message}。你的修改已保留，请重试。', 'Save conflict, and the latest version could not be loaded: {message}. Your changes are kept; try again.'],
  'schedules.field.name': ['名称', 'Name'],
  'schedules.field.target_node_id': ['执行节点', 'Target node'],
  'schedules.field.task': ['任务内容', 'Task'],
  'schedules.field.priority': ['优先级', 'Priority'],
  'schedules.field.timezone': ['时区', 'Time zone'],
  'schedules.field.schedule': ['执行计划', 'Schedule'],
  'schedules.field.misfire_policy': ['错过执行', 'Missed runs'],
  'schedules.priority.high': ['高', 'High'],
  'schedules.priority.normal': ['普通', 'Normal'],
  'schedules.priority.low': ['低', 'Low'],
  // 复制计划(schedule-copy.ts):源计划预填新建表单。
  'schedules.copy.action': ['复制', 'Copy'],
  'schedules.copy.suffix': [' 副本', ' copy'],
  'schedules.copy.adjusted': ['原定时间 {from} 已过，已顺延到 {to}，请确认。', 'The original time {from} has passed; moved to {to}. Please confirm.'],
  'schedules.once.past': ['执行时间已过去，保存后 Hub 会立即执行一次。', 'This time is in the past; the hub will run it immediately after saving.'],
});
