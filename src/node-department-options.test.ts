// #4863 追加断言（通信欧 11-15 定稿）：
//   1) 选项层用**逐部门**事实：Hub 明说不能管的部门要 disabled + 原因；数据缺失 ⇒ 可选；「未归属」永不禁用；
//   2) 「移出部门」必须发 department_id: null（**不能省略字段** —— 省略在有些接口里等于「不改」，
//      会把「移出」变成无声失败）；
//   3) 403 的 Hub 原文要能传出来（不许吞成「失败」）。

import { readFileSync } from 'node:fs';
import { departmentOptions, departmentOptionTestId, DEPARTMENT_READONLY_REASON_KEY } from './node-department-edit';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const dept = (id: string, name: string, parent_id: string | null = null, viewer_can?: { manage?: boolean; create_child?: boolean }) =>
  ({ id, name, parent_id, ...(viewer_can ? { viewer_can } : {}) }) as any;

// 1) 逐部门判据
{
  const org = {
    departments: [
      dept('a', '天马'),
      dept('b', '研发', 'a', { manage: false, create_child: false }),
      dept('c', '市场', 'a', { manage: true, create_child: false }),
    ],
    members: [],
  } as any;
  const opts = departmentOptions(org, false);
  const byId = Object.fromEntries(opts.map(o => [String(o.id), o]));
  ck('「未归属」永不禁用', byId['null']?.disabled !== true);
  ck('Hub 明说 manage:false ⇒ 该部门禁用', byId['b']?.disabled === true);
  ck('禁用项带原因（复用 saveForbidden）', byId['b']?.disabledReason === DEPARTMENT_READONLY_REASON_KEY);
  ck('manage:true ⇒ 可选', byId['c']?.disabled !== true);
  ck('数据缺失（无 viewer_can）⇒ 可选，不猜权限', byId['a']?.disabled !== true);

  // 数据缺失一律可选（不猜权限）；显式 false 时管理员也不绕过（聚合判据只负责开门）
  const missing = departmentOptions({ departments: [dept('x', 'x')], members: [] } as any);
  ck('无 viewer_can ⇒ 可选（不猜权限）', missing.find(o => o.id === 'x')?.disabled !== true);
  const explicitNo = departmentOptions({ departments: [dept('z', 'z', null, { manage: false })], members: [] } as any);
  ck('显式 manage:false ⇒ 即使管理员也灰掉（不绕过部门拒绝）', explicitNo.find(o => o.id === 'z')?.disabled === true);
}

// 2) 移出部门必须显式发 null（读源码钉住，避免有人改成「省略字段」）
{
  const api = readFileSync(new URL('./agent-org-api.ts', import.meta.url), 'utf8');
  ck('moveAgentDepartment 的 body 显式包含 department_id（可为 null）',
    /body:\s*JSON\.stringify\(\{\s*department_id:\s*departmentId\s*\}\)/.test(api));
  ck('函数签名允许 null（移出部门）', /departmentId:\s*string\s*\|\s*null/.test(api));
  ck('403 时带出 Hub 原文 detail', /reason:\s*'forbidden'/.test(api) && /detail/.test(api));
}

// 3) 选择器把 disabled 传下去（源码级：StructureSelector 支持 disabled 且不隐藏）
{
  const org = readFileSync(new URL('./AgentOrgScreen.tsx', import.meta.url), 'utf8');
  ck('StructureSelector 选项类型含 disabled', /disabled\?:\s*boolean/.test(org));
  ck('渲染时 disabled 项不触发 onPick', /if\s*\(!item\.disabled\)\s*p\.onPick\(item\.id\)/.test(org));
  ck('disabled 项仍然渲染（不隐藏）', /SettingsChoiceRow[\s\S]{0,220}disabled=\{item\.disabled\}/.test(org));
}

{
  const picker = readFileSync(new URL('./NodeDepartmentPicker.tsx', import.meta.url), 'utf8');
  ck('选择器把 disabled 和翻译后的原因传给 StructureSelector(灰掉真的生效)', /disabled: o\.disabled/.test(picker) && /disabledReason: o\.disabledReason \? t\(o\.disabledReason\)/.test(picker));
  ck('部门选项不再拿内部 id 当副标题', departmentOptions({ departments: [{ id: 'dept_x', name: 'A', parent_id: null } as any] })[1].subtitle === undefined);
}

console.log(`${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
