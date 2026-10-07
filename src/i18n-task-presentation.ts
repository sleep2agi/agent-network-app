import { currentLanguage, t } from './i18n';
import { taskText } from './i18n-tasks';
import * as model from './task-board-model';
import { formatDueFull as rawDueFull } from './due-time';

// Presentation-only adapters. IDs, sorting/filtering and outbound data stay in the model.
export function personDisplay(...args: Parameters<typeof model.personDisplay>) {
 const result = model.personDisplay(...args);
 return result.known ? result : { ...result, name: t('tasks.unknownMember', { id: model.shortId(args[0].id) }) };
}
/** 详情里一个参与人胶囊画什么:Agent =「名字 · Agent」(品牌蓝),人类 =「名字 人类」。 */
export function participantChip(...[ref, people]: Parameters<typeof model.personDisplay>) {
 const d = personDisplay(ref, people);
 const agent = ref.kind === 'node';
 return { ...d, agent, kindLabel: agent ? `· ${t('tasks.peopleAgentTag')}` : t('tasks.copy.1') };
}
export const personName = (...args: Parameters<typeof model.personName>) => personDisplay(...args).name;
export function ownerLabel(...[item, people]: Parameters<typeof model.ownerLabel>) {
 if (item.owner === undefined) return item.assignee || t('tasks.unassigned');
 const names = [item.owner, item.agentOwner].flatMap(ref => ref ? [personName(ref, people)] : []);
 return names.length ? names.join(' · ') : t('tasks.unassigned');
}
export function ownerCounts(...args: Parameters<typeof model.ownerCounts>) {
 return model.ownerCounts(...args).map(row => ({ ...row, name: row.ref ? personName(row.ref, args[1]) : t('tasks.unassigned') }));
}
export function roleAvatars(...args: Parameters<typeof model.roleAvatars>) {
 return model.roleAvatars(...args).map(row => ({ ...row, name: personName(row.ref, args[1]) }));
}
export function participantStack(...[refs, people, max = 3, meKey]: Parameters<typeof model.participantStack>) {
 const raw = model.participantStack(refs, people, max, meKey);
 const ordered = model.participantsMeFirst(refs, meKey);
 const names = ordered.map(ref => personDisplay(ref, people));
 return { ...raw, shown: raw.shown.map((row,i) => ({ ...row, ...names[i] })), all: ordered.map((ref,i) => `${names[i].name} (${i === 0 && raw.shown[0]?.me ? t('tasks.participantMe') : ref.kind === 'user' ? t('tasks.copy.1') : 'Agent'})`).join(', ') };
}
function dueText(value: string): string {
 if (currentLanguage() === 'zh') return value;
 return value.replace(/已?逾期 (\d+) (天|小时|分钟)/g, (_, n, unit) => t(unit === '天' ? 'tasks.overdueDays' : unit === '小时' ? 'tasks.overdueHours' : 'tasks.overdueMinutes', { n }))
  // 到期提示(due-marker.ts):带时刻的先换,再换全天的,最后才是裸的「今天 / 明天」。
  .replace(/(今天|明天) (\d{2}:\d{2}) 到期/g, (_, day, time) => t(day === '今天' ? 'tasks.dueTodayAt' : 'tasks.dueTomorrowAt', { time }))
  .replace(/今天到期/g, t('tasks.dueToday')).replace(/明天到期/g, t('tasks.dueTomorrow'))
  .replace(/(\d+)月(\d+)日/g, (_,m,d) => t('tasks.monthDay',{m,d}))
  .replace(/今天/g, t('tasks.today')).replace(/明天/g, t('tasks.tomorrow')).replace(/全天/g, t('tasks.allDay'));
}
export const formatDueFull = (...args: Parameters<typeof rawDueFull>) => dueText(rawDueFull(...args));
export function dueInfo(...args: Parameters<typeof model.dueInfo>) {
 const result = model.dueInfo(...args);
 return { ...result, label: dueText(result.label), full: dueText(result.full) };
}
export function validationText(message: string): string {
 const key = ({ '先写项目名': 'tasks.projectNameEmpty', '项目名最多 40 个字': 'tasks.projectNameLong', '已经有同名的项目': 'tasks.projectNameDuplicate', '明天': 'tasks.tomorrow', '下周一': 'tasks.nextMonday' } as Record<string,string>)[message];
 return key ? t(key) : taskText(message);
}
