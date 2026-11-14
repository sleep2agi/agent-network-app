// 部门树右键菜单(管理员 2026-11-14):菜单项按 Hub viewer_can 走,旧 Hub 退回 owner/admin;删除前本地数挡路项。
import { blockersFromDetail, canEditAnyDepartment, DEPT_MENU_LABEL_KEY, deleteBlockers, deptMenuActions, isDeleteBlocked } from './agent-org-dept-menu';
import { agentOrgTranslations } from './i18n-agent-org';
import type { Department } from './org-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const dept = (id: string, extra: Partial<Department> = {}): Department => ({ id, name: id, parent_id: null, leader_user_id: null, sort: 0, member_count: 0, ...extra });

ck('admin on old Hub (no viewer_can): full menu + root', eq(deptMenuActions(dept('a'), true), ['createChild', 'rename', 'reparent', 'delete', 'createRoot']));
ck('plain member on old Hub: nothing', eq(deptMenuActions(dept('a'), false), []));
ck('blank area: admin gets only createRoot', eq(deptMenuActions(null, true), ['createRoot']));
ck('blank area: member gets nothing', eq(deptMenuActions(null, false), []));
ck('leader of a parent (manage + create_child): edit items, no root', eq(deptMenuActions(dept('a', { viewer_can: { manage: true, create_child: true } }), false), ['createChild', 'rename', 'reparent', 'delete']));
ck('leader on own top dept (create_child only): only createChild', eq(deptMenuActions(dept('a', { viewer_can: { manage: false, create_child: true } }), false), ['createChild']));
ck('Hub says no: admin flag does not override explicit false', eq(deptMenuActions(dept('a', { viewer_can: { manage: false, create_child: false } }), true), ['createRoot']));
ck('no department API (directory-only tree): nothing', eq(deptMenuActions(dept('a'), true, false), []) && eq(deptMenuActions(null, true, false), []));

ck('canEditAny: admin', canEditAnyDepartment([], true));
ck('canEditAny: leader via viewer_can', canEditAnyDepartment([dept('a'), dept('b', { viewer_can: { create_child: true } })], false));
ck('canEditAny: plain member', !canEditAnyDepartment([dept('a', { viewer_can: { manage: false, create_child: false } })], false));
ck('canEditAny: no tree API', !canEditAnyDepartment([], true, false));

const all = [dept('a', { member_count: 2 }), dept('b', { parent_id: 'a' }), dept('c', { parent_id: 'a' }), dept('d')];
ck('blockers count direct children, members, agents', eq(deleteBlockers(all[0], all, 3), { children: 2, members: 2, agents: 3 }));
ck('empty leaf is not blocked', !isDeleteBlocked(deleteBlockers(all[3], all, 0)));
ck('agents alone block (Hub #1894 counts nodes too)', isDeleteBlocked(deleteBlockers(all[3], all, 1)));
ck('Hub 409 detail parsed, junk ignored', eq(blockersFromDetail({ children: 1, members: 'x', agents: 4 }), { children: 1, members: 0, agents: 4 }) && eq(blockersFromDetail(undefined), { children: 0, members: 0, agents: 0 }));

const keys = agentOrgTranslations as Record<string, readonly [string, string]>;
ck('every menu label has zh + en', Object.values(DEPT_MENU_LABEL_KEY).every(k => !!keys[k]?.[0] && !!keys[k]?.[1]));
ck('menu labels are short enough for the 6-char menu width', Object.values(DEPT_MENU_LABEL_KEY).every(k => [...keys[k][0]].length <= 6));
ck('placeholders use single braces', ['agentOrg.deleted', 'agentOrg.deleteConfirm', 'agentOrg.deleteBlocked', 'agentOrg.menu.label'].every(k => keys[k][0].includes('{name}') && !keys[k][0].includes('{{')));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
