// #3665 —— 管理员范围 UI 的接线（MemberEditor 里只在 role=admin 时出现；手机/宽屏都挂）。
//   run: bun src/member-scope-wiring.test.ts
import { readFileSync } from 'node:fs';
let passed = 0, total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };
const editor = readFileSync(new URL('./MemberEditor.tsx', import.meta.url), 'utf8');
const scope = readFileSync(new URL('./MemberAdminScope.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const grant = readFileSync(new URL('./member-department-grant.ts', import.meta.url), 'utf8');

ck('宽屏与手机两处都挂了范围卡', (editor.match(/<MemberAdminScope /g) ?? []).length === 2);
ck('只在 admin 角色出现（owner 不出现）', (editor.match(/ed\.role === 'admin'/g) ?? []).length === 2);
ck('GET/PUT 路径就是 /api/users/:id/grants', api.includes('/api/users/${encodeURIComponent(userId)}/grants'));
ck('PUT 是整份 grants', api.includes('body: JSON.stringify({ grants:'));
ck('保存前做同口径校验', scope.includes('validateDepartmentScope'));
ck('合并只替换 manage_nodes', scope.includes('mergeUserGrants(grants'));
ck('候选按负责范围过滤', scope.includes('filterGrantableDepartments'));
ck('permission_denied 有人话', grant.includes('没有权限授这个部门'));
ck('写清「无部门节点只有全网管理员能看到」', scope.includes('不属于任何部门的节点只有全网管理员能看到'));
ck('admin 不再显示那句「不用单独授权」的旧提示', editor.includes("if (role === 'admin') return null;"));
ck('错误码映射：invalid_scope / 部门不存在 / 无权限 都有中文话术', (() => {
  return grant.includes("case 'invalid_scope'") && grant.includes("case 'department_not_found'") && grant.includes("case 'permission_denied'") && grant.includes("case 'scope_id_required'");
})());
ck('卡片读写两侧都走 grantErrorText（不再散落三元）', (() => {
  return (scope.match(/grantErrorText\(/g) || []).length >= 2 && !scope.includes("read.error === 'unsupported'");
})());
console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
