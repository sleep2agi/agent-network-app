import { readFileSync } from 'node:fs';
import { filterAssigneeChoices, migrateLocalRequirements, requirementFromHub, RequirementsHubError } from './requirements-hub';
import type { Requirement } from './requirements-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const row = requirementFromHub({ id: 'req_1', name: '多端', priority: 'high', assignee: 'node-a', due: '2026-10-01', column: 'doing', createdAt: '2026-09-28T00:00:00.000Z' });
ck('Hub 行能变成卡片', !!row && row.column === 'doing' && row.name === '多端' && row.due === '2026-10-01');
ck('坏日期丢掉，缺名字丢掉', requirementFromHub({ id: 'x', name: 'a', due: 'nope' })?.due === '' && requirementFromHub({ id: 'x' }) === null);

{
  const both = requirementFromHub({ id: 'r', name: '两个角色', owner: { kind: 'user', id: 'u' }, participants: [], agent_owner: { kind: 'node', id: 'n' } });
  ck('Hub 行带 agent_owner → agentOwner {node}', JSON.stringify(both?.agentOwner) === '{"kind":"node","id":"n"}' && JSON.stringify(both?.owner) === '{"kind":"user","id":"u"}');
  ck('agent_owner: null → 支持但未分配', requirementFromHub({ id: 'r', name: 'x', owner: null, participants: [], agent_owner: null })?.agentOwner === null);
  ck('旧 Hub 行没有 agent_owner 字段 → undefined(退回单一负责人)', requirementFromHub({ id: 'r', name: 'x', owner: null, participants: [] })?.agentOwner === undefined);
  ck('agent_owner 种类不对当未分配,卡片不丢', requirementFromHub({ id: 'r', name: 'x', owner: null, participants: [], agent_owner: { kind: 'user', id: 'u' } })?.agentOwner === null);
}

{
  const row = requirementFromHub({ id: 'r', name: 'x', description: '# 标题', checklist: [{ id: 'a', text: '一', done: true }, { id: '', text: '坏' }, 'junk', { id: 'b', text: '二' }] });
  ck('描述 / 子任务读进来,坏项丢掉', row?.description === '# 标题' && JSON.stringify(row?.checklist) === '[{"id":"a","text":"一","done":true},{"id":"b","text":"二","done":false}]');
  ck('旧 Hub 没有这两个字段 → undefined', requirementFromHub({ id: 'r', name: 'x' })?.description === undefined && requirementFromHub({ id: 'r', name: 'x' })?.checklist === undefined);
}

{
  ck('project_id 读进来;null / 缺省区分', requirementFromHub({ id: 'r', name: 'x', project_id: 'proj_1' })?.projectId === 'proj_1' && requirementFromHub({ id: 'r', name: 'x', project_id: null })?.projectId === null && requirementFromHub({ id: 'r', name: 'x' })?.projectId === undefined);
}

function card(id: string, name: string, column: Requirement['column'] = 'pool'): Requirement {
  return { id, name, priority: 'normal', assignee: '', due: '', column, createdAt: '2026-09-28T00:00:00.000Z' };
}
const cfg = { serverUrl: 'http://hub.local', token: 't', username: 'u', networkId: 'net', profileId: 'p' };

{
  const store = [card('a', '甲', 'doing'), card('b', '乙')];
  const posted: string[] = [];
  const result = await migrateLocalRequirements(cfg, () => store.slice(), (items) => { store.length = 0; store.push(...items); }, async (_c, input) => {
    posted.push(`${input.clientId}:${input.column}`);
    return card('hub_' + input.clientId, input.name, input.column || 'pool');
  });
  ck('Hub 已有卡片也迁本机剩下的', result.migrated === 2 && store.length === 0, posted.join(','));
  ck('迁过去时带着原来的列和本机 id', posted.join(',') === 'a:doing,b:pool');
}

{
  const store = [card('a', '甲'), card('b', '乙'), card('c', '丙')];
  let calls = 0;
  let threw = false;
  try {
    await migrateLocalRequirements(cfg, () => store.slice(), (items) => { store.length = 0; store.push(...items); }, async (_c, input) => {
      calls += 1;
      if (input.clientId === 'b') throw new RequirementsHubError('HTTP 500', 500);
      return card('hub_' + input.clientId, input.name);
    });
  } catch { threw = true; }
  ck('中途失败只留下没迁成的', threw && calls === 2 && store.map(s => s.id).join(',') === 'b,c');
  const posted: string[] = [];
  await migrateLocalRequirements(cfg, () => store.slice(), (items) => { store.length = 0; store.push(...items); }, async (_c, input) => {
    posted.push(input.clientId || '');
    return card('hub_' + input.clientId, input.name);
  });
  ck('重试把剩下的迁完', posted.join(',') === 'b,c' && store.length === 0);
}

ck('负责节点从列表里点，同名只留一个', filterAssigneeChoices([' node-b ', 'node-a', 'node-b', ''], 'node').join(',') === 'node-a,node-b');
ck('搜索对不上就没有', filterAssigneeChoices(['node-a'], 'zzz').length === 0);
const board = norm('./RequirementBoard.tsx');
const dialog = norm('./TaskCreateDialog.tsx');


ck('不再有「存在 Hub 上」这行开发说明', !board.includes('存在 Hub 上，手机和电脑是同一份。'));
ck('不再说不进 Hub', !board.includes('不进 Hub'));
ck('读写走 Hub 接口', board.includes('migrateLocalRequirements(') && board.includes('createRequirementOnHub(') && board.includes('moveRequirementOnHub(') && board.includes('updateRequirementOnHub('));
ck('不再只在 Hub 为空时才迁', !board.includes('list.length === 0'));
ck('新建负责人复用稳定身份选择器', dialog.includes('<RequirementPeoplePicker') && dialog.includes('选择负责人(人类或 Agent),可空') && !board.includes('fetchHubNodes(') && !dialog.includes('fetchHubNodes('));
const picker = norm('./RequirementPeoplePicker.tsx');
ck('负责人列表用本人头像，不再用空心圆', picker.includes('<AliasAvatar alias={person.name || person.id} size={36} />') && !picker.includes('○'));
ck('没选中时勾不占读屏', picker.includes('accessible={false}') && picker.includes('styles.checkOff'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
