// 任务详情的渐进展开:常显字段的顺序、「更多」里装了什么、收起时的一行摘要、本机记住展开状态。
import { readFileSync } from 'node:fs';
import { moreSummary, parseMoreOpen } from './task-detail-more';
import { t as translate, setLanguagePreference } from './i18n';
import './i18n-tasks';
import type { Requirement } from './requirements-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const R = (id: string, extra: Partial<Requirement> = {}): Requirement => ({ id, name: `任务${id}`, assignee: '', priority: 'normal', due: '', column: 'pool', createdAt: '', ...extra } as Requirement);
setLanguagePreference('zh');
const say = (item: Requirement, draft: { priority: Requirement['priority']; parentId: string | null }, items: Requirement[]) => moreSummary(item, draft, items).map(x => translate(x.key, x.values)).join(' · ');

console.log('# 摘要');
{
  const parent = R('p', { name: '登录页' });
  const item = R('a', { priority: 'high', parentId: 'p', checklist: [{ id: '1', text: 'x', done: true }, { id: '2', text: 'y', done: false }, { id: '3', text: 'z', done: false }], participants: [{ kind: 'user', id: 'u' }, { kind: 'node', id: 'n' }] as any, issues: [{ url: 'https://github.com/a/b/issues/1' }] as any, tags: ['前端', '紧急'] });
  const kid = R('k', { parentId: 'a' });
  ck('全有 = 按「更多」里的顺序一行说完(子任务 / 检查项 / 标签 / 优先级 / 参与人常显,不在摘要里)', say(item, { priority: 'high', parentId: 'p' }, [parent, item, kid]) === '母任务 登录页 · 1 个 Issue');
  ck('普通优先级、什么都没设 = 不说(「更多」后面空着)', moreSummary(R('b'), { priority: 'normal', parentId: null }, []).length === 0);
  ck('优先级不进摘要(已常显在状态下面)', say(R('b'), { priority: 'low', parentId: null }, []) === '' && say(R('b'), { priority: 'lowest', parentId: null }, []) === '');
  ck('按草稿说(改了还没保存也算)', say(R('b'), { priority: 'normal', parentId: 'gone' }, []) === '有母任务');
  ck('母任务不在列表里 = 「有母任务」,不显示 id', say(R('b', { parentId: 'gone' }), { priority: 'normal', parentId: 'gone' }, []) === '有母任务');
  ck('子任务常显在左栏(#701),不进摘要', say(R('b', { children: { total: 4, done: 1 } } as any), { priority: 'normal', parentId: null }, []) === '');
  setLanguagePreference('en');
  ck('English', say(item, { priority: 'high', parentId: 'p' }, [parent, item, kid]) === 'Parent: 登录页 · 1 issues');
  setLanguagePreference('zh');
}

console.log('# 本机记住');
ck('存 1 / 0,读回布尔;没存过 = null(按收起)', parseMoreOpen('1') === true && parseMoreOpen('0') === false && parseMoreOpen(null) === null && parseMoreOpen('x') === null);

console.log('# 接线(源码)');
{
  // #701 布局:头部 = 标题 + 状态 / 优先级 pill;左栏 = 描述 · 子任务 · 动态;右栏 = 属性 + 「更多」。
  const panel = readFileSync(new URL('./TaskDetailPanel.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const props = panel.slice(panel.indexOf('const properties = ('), panel.indexOf('const banners = ('));
  const at = (needle: string) => props.indexOf(needle);
  const more = at('testID="req-more"');
  const always = ['<RoleFields', "<Field label={tr('tasks.copy.53')}>", '<ProjectSelect', "<Field label={tr('tasks.copy.119')}>", '<TaskTags'].map(at);
  ck('属性:负责人/负责 Agent · 参与人 · 项目 · 预计完成 · 标签,按这个顺序,都在「更多」之前', always.every(i => i > 0 && i < more) && always.every((v, i) => i === 0 || v > always[i - 1]));
  const inside = ["<Field label={tr('detail.start')}>", '<ParentSelect', '<TaskIssueBindings', '<ExternalLink', 'item.createdAt ?'].map(at);
  ck('「更多」里:开始 · 母任务 · GitHub Issue · 同步来源 · 创建于', inside.every(i => i > more) && inside.every((v, i) => i === 0 || v > inside[i - 1]));
  ck('默认收起,本机记住', panel.includes('const [moreOpen, setMoreOpen] = useState(false);') && panel.includes('saveDetailMoreOpen(!v)') && panel.includes('loadDetailMoreOpen()'));
  ck('「更多」里有错误(母任务被拒、开始日期不对)时自动展开', panel.includes("const moreShown = moreOpen || error?.field === 'parent' || error?.field === 'start';"));
  const head = panel.slice(panel.indexOf('const head = ('), panel.indexOf('const content = ('));
  ck('头部:标题 · 状态 pill · 优先级 pill · #编号', [ 'testID="req-edit-name"', "pill('req-status-pill'", "pill('req-priority-pill'", '<TaskIdChip'].map(n => head.indexOf(n)).every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])));
  ck('优先级只在头部(不在属性 / 「更多」里)', !props.includes('<PriorityPicker') && head.includes('<PriorityPicker'));
  const left = panel.slice(panel.indexOf('const description = ('), panel.indexOf('const properties = ('));
  ck('左栏:描述 · 子任务(检查项 + 子任务)· 动态', ['<TaskDescriptionEditor', '{checklistBlock}', '<SubRequirements', '<TaskComments'].map(n => left.indexOf(n)).every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])));
  ck('收起时一行摘要', props.includes("{!moreShown && summary.length ? <Text") && props.includes('testID="req-more-summary"'));
}

setLanguagePreference('system');
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
