// 新建节点「所属部门」:选项按权限给;只有一个就预选;兼多个部门不预选(admin 2026-11-14)。
import { readFileSync } from 'node:fs';
import { defaultDepartment, departmentChoices, departmentLabel, deptScopeFor, type DeptScope } from './create-node-department';
import type { OrgData } from './org-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const dept = (id: string, parent: string | null, leader: string | null = null, sort = 0) => ({ id, name: id.toUpperCase(), parent_id: parent, leader_user_id: leader, sort, member_count: 0 });
const org: OrgData = {
  departments: [dept('infra', null, 'lead2', 1), dept('infra-ops', 'infra', null, 1), dept('anet', null, 'lead2', 2), dept('web', null, 'lead1', 3)],
  members: [{ user_id: 'm1', department_id: 'web' }, { user_id: 'lead1', department_id: 'web' }, { user_id: 'lead2', department_id: 'infra' }, { user_id: 'adm', department_id: null }],
};
const ids = (cs: { id: string }[]) => cs.map(c => c.id).join(',');
const scope = (s: Partial<DeptScope>): DeptScope => ({ all: false, managed: [], own: null, led: [], ...s });

ck('管理员:全部部门,按树顺序(子部门跟在父部门后)', ids(departmentChoices(org, scope({ all: true }))) === 'infra,infra-ops,anet,web');
ck('普通成员:只有自己所在的部门', ids(departmentChoices(org, scope({ own: 'web' }))) === 'web');
ck('负责人:自己负责的(含下级)+ 自己所在的', ids(departmentChoices(org, scope({ managed: ['infra', 'infra-ops', 'anet'], own: 'infra', led: ['infra', 'anet'] }))) === 'infra,infra-ops,anet');
ck('没有组织架构(旧 Hub)→ 没有选项', departmentChoices(null, scope({ all: true })).length === 0);

ck('🔴 只有一个可选 → 直接预选', defaultDepartment(departmentChoices(org, scope({ own: 'web' })), { own: 'web', led: [] }) === 'web');
ck('🔴 兼两个部门负责人 → 不预选(让人挑,不放错)', defaultDepartment(departmentChoices(org, scope({ managed: ['infra', 'infra-ops', 'anet'], own: 'infra', led: ['infra', 'anet'] })), { own: 'infra', led: ['infra', 'anet'] }) === null);
ck('管理员只在一个部门、不当负责人 → 预选那个部门', defaultDepartment(departmentChoices(org, scope({ all: true })), { own: 'web', led: [] }) === 'web');
ck('管理员没有部门也不当负责人 → 不预选', defaultDepartment(departmentChoices(org, scope({ all: true })), { own: null, led: [] }) === null);
ck('自己所在 = 自己负责的同一个 → 算一个,预选', defaultDepartment(departmentChoices(org, scope({ all: true })), { own: 'web', led: ['web'] }) === 'web');
ck('没有可选 → null', defaultDepartment([], { own: 'web', led: [] }) === null);

const me = { user: { user_id: 'lead2', role: 'user' }, networks: [{ network_id: 'n1', member_role: 'member', managed_department_ids: ['infra', 'infra-ops', 'anet'] }] };
const s = deptScopeFor(me, 'n1', org);
ck('deptScopeFor:负责人读出 managed / own / led', !s.all && s.own === 'infra' && s.led.join() === 'infra,anet' && s.managed.length === 3);
ck('deptScopeFor:owner / admin / Hub 管理员都算 all', deptScopeFor({ user: { user_id: 'x' }, networks: [{ network_id: 'n1', member_role: 'owner' }] }, 'n1', org).all && deptScopeFor({ user: { user_id: 'x', role: 'admin' }, networks: [] }, 'n1', org).all);
ck('deptScopeFor:别的网络的身份不算', !deptScopeFor({ user: { user_id: 'x' }, networks: [{ network_id: 'n2', member_role: 'owner' }] }, 'n1', org).all);
ck('label:选了显示部门名,没选显示「暂不分配」', departmentLabel(departmentChoices(org, scope({ all: true })), 'anet') === 'ANET' && departmentLabel([], null) === '暂不分配');

const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
ck('向导:Hub 报 create_node_department 才显示这一行', wiz.includes('caps.includes(CREATE_NODE_DEPARTMENT_CAPABILITY)') && wiz.includes('testID="create-department-row"'));
ck('向导:选了才把 department_id 发给 Hub', wiz.includes('...(deptSupported && deptValue ? { department_id: deptValue } : {})'));
ck('向导:有「暂不分配」选项', wiz.includes("'create-department-none'") && wiz.includes("name: '暂不分配'"));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
