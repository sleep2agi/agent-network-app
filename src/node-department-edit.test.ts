// #4863 —— 「所属部门」这一行的纯模型：显示值 / 选项 / 权限 / 失败文案。
// 这份测试钉四件事（都是 admin 那天找不到入口的分支）：
//   1) 未归属**也必须有一行**（显示「未归属」而不是省略）；
//   2) 选项里恒有「未归属」且在第一位，部门按路径排序；
//   3) 无部门表 = 改不了，且选项不为空（点了不能没反应）；
//   4) 失败原因映射到组织架构页已有的 i18n key（不另造一句）。

import { readFileSync } from 'node:fs';
import {
  DEPARTMENT_READONLY_REASON_KEY,
  UNASSIGNED_LABEL,
  canEditDepartments,
  departmentDisplayLabel,
  departmentOptionTestId,
  departmentOptions,
  moveFailureKey,
} from './node-department-edit';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const dept = (id: string, name: string, parent_id: string | null = null, viewer_can?: { manage?: boolean; create_child?: boolean }) =>
  ({ id, name, parent_id, ...(viewer_can ? { viewer_can } : {}) }) as any;

const org = {
  departments: [
    dept('a', '天马'),
    dept('b', '研发', 'a'),
    dept('c', '客户端', 'b'),
    dept('d', '市场', 'a'),
  ],
  members: [],
} as any;

// 1) 未归属也有一行
ck('未归属显示「未归属」', departmentDisplayLabel(org, null) === UNASSIGNED_LABEL);
ck('未归属（undefined）也显示「未归属」', departmentDisplayLabel(org, undefined) === UNASSIGNED_LABEL);
ck('未知部门 id 不崩，退回「未归属」', departmentDisplayLabel(org, 'zzz') === UNASSIGNED_LABEL);
ck('没有部门表也显示「未归属」', departmentDisplayLabel(null, 'c') === UNASSIGNED_LABEL);
ck('已归属显示完整路径', departmentDisplayLabel(org, 'c') === '天马 / 研发 / 客户端');
ck('根部门只显示自己', departmentDisplayLabel(org, 'a') === '天马');

// 2) 选项
{
  const opts = departmentOptions(org);
  ck('第一项是「未归属」且 id=null', opts[0].id === null && opts[0].label === UNASSIGNED_LABEL);
  ck('选项数 = 部门数 + 1', opts.length === 5);
  ck('部门按路径出现（天马 → 市场/研发 的字典序）', opts.slice(1).map(o => o.label).join('|') === ['天马', '天马 / 市场', '天马 / 研发', '天马 / 研发 / 客户端'].join('|'));
  ck('每个选项都有稳定 testID', opts.every(o => o.testID === departmentOptionTestId(o.id)));
  ck('未归属选项 testID 固定', departmentOptionTestId(null) === 'node-department-option-unassigned');
}

// 3) 权限与空表
ck('管理员可改', canEditDepartments(org, true) === true);
ck('普通成员不可改', canEditDepartments(org, false) === false);
ck('部门负责人（viewer_can.manage）可改', canEditDepartments({ departments: [dept('x', 'x', null, { manage: true })], members: [] } as any, false) === true);
// 注意：`canEditAnyDepartment` 是**聚合**判据（admin 优先），与 per-department 的 `deptMenuActions`
//（`viewer_can.manage ?? canManageStructure`，Hub 明说 false 时不覆盖）语义不同。
// 这里沿用聚合判据，因为「能不能进选择器」是入口问题，最终写操作仍会被 Hub 403 挡住并给原因。
ck('admin 仍可改（聚合判据：admin 优先）', canEditDepartments({ departments: [dept('x', 'x', null, { manage: false, create_child: false })], members: [] } as any, true) === true);
{
  const empty = departmentOptions(null);
  ck('无部门表时选项仍有「未归属」（点了不能没反应）', empty.length === 1 && empty[0].id === null);
  ck('无部门表时不可改', canEditDepartments(null, true) === false);
}

// 4) 失败文案复用既有 key
ck('forbidden → saveForbidden', moveFailureKey('forbidden') === 'agentOrg.saveForbidden');
ck('node → saveNoNode', moveFailureKey('node') === 'agentOrg.saveNoNode');
ck('department → saveNoDepartment', moveFailureKey('department') === 'agentOrg.saveNoDepartment');
ck('unsupported → saveUnsupported', moveFailureKey('unsupported') === 'agentOrg.saveUnsupported');
ck('error → saveFailed', moveFailureKey('error') === 'agentOrg.saveFailed');
ck('只读原因就是 saveForbidden', DEPARTMENT_READONLY_REASON_KEY === 'agentOrg.saveForbidden');

// 5) 这些 i18n key 必须真的存在（否则运行时显示 key 原文）
const i18n = readFileSync(new URL('./i18n-agent-org.ts', import.meta.url), 'utf8');
for (const k of ['agentOrg.saveForbidden', 'agentOrg.saveNoNode', 'agentOrg.saveNoDepartment', 'agentOrg.saveUnsupported', 'agentOrg.saveFailed']) {
  ck(`i18n 有 ${k}`, i18n.includes(`'${k}'`));
}

console.log(`${p}/${t} checks passed`);
