// #3665 —— 管理员「范围」纯逻辑（等通信欧的 grants 接口，先把不该变的语义钉住）。
//   run: bun src/member-department-grant.test.ts
import { departmentGrantPayload, departmentOptions, departmentScopeErrorText, filterGrantableDepartments, mergeUserGrants, scopeFromGrants, validateDepartmentScope } from './member-department-grant';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };

ck('「全部」不发 scope 授权', departmentGrantPayload({ mode: 'all' }) === null);
ck('「仅某部门」发 manage_nodes/department/edit',
  JSON.stringify(departmentGrantPayload({ mode: 'department', departmentId: ' dep_1 ' })) === JSON.stringify({ capability: 'manage_nodes', scope_kind: 'department', scope_id: 'dep_1', level: 'edit' }));
ck('选了部门模式但空 id → 不发（交给校验拦）', departmentGrantPayload({ mode: 'department', departmentId: '  ' }) === null);

ck('全部模式校验通过', validateDepartmentScope({ mode: 'all' }).ok === true);
ck('部门模式缺部门被拦', !validateDepartmentScope({ mode: 'department', departmentId: '' }).ok);
ck('错误码有人话', /部门/.test(departmentScopeErrorText('department_required')));

ck('grants 里没有 department scope → 全部', scopeFromGrants([]).mode === 'all');
ck('有 department scope → 回显那个部门',
  JSON.stringify(scopeFromGrants([{ capability: 'manage_nodes', scope_kind: 'department', scope_id: 'dep_2', level: 'edit' }])) === JSON.stringify({ mode: 'department', departmentId: 'dep_2' }));
ck('别的 capability 不误判', scopeFromGrants([{ capability: 'view_nodes', scope_kind: 'department', scope_id: 'dep_2' }]).mode === 'all');
ck('level=readonly 不算「仅某部门」的管理授权', scopeFromGrants([{ capability: 'manage_nodes', scope_kind: 'department', scope_id: 'dep_2', level: 'readonly' }]).mode === 'all');

ck('部门选项去空、去重、保序',
  JSON.stringify(departmentOptions([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'a', name: 'A2' }, { id: '', name: 'X' }])) === JSON.stringify([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));

ck('整份替换：全部 → 去掉 manage_nodes，其它 capability 保留',
  JSON.stringify(mergeUserGrants([{ capability: 'manage_nodes', scope_kind: 'department', scope_id: 'dep_1', level: 'edit' }, { capability: 'other', scope_kind: 'network', scope_id: '', level: 'read' }], { mode: 'all' }))
  === JSON.stringify([{ capability: 'other', scope_kind: 'network', scope_id: '', level: 'read' }]));
ck('整份替换：仅某部门 → 替换成一条 department/edit',
  JSON.stringify(mergeUserGrants([{ capability: 'manage_nodes', scope_kind: 'network', scope_id: '', level: 'edit' }], { mode: 'department', departmentId: 'dep_9' }))
  === JSON.stringify([{ capability: 'manage_nodes', scope_kind: 'department', scope_id: 'dep_9', level: 'edit' }]));
ck('部门负责人：候选只给自己子树内的部门',
  JSON.stringify(filterGrantableDepartments([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], ['b']).map(n => n.id)) === JSON.stringify(['b']));
ck('不是负责人（allowed 空）→ 不过滤',
  filterGrantableDepartments([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], []).length === 2);
console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
