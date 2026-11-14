// 侧栏部门分组按组织树排 + 子部门缩进(管理员 2026-11-14)。
import { deptHeaderLayout, deptTreeRank, UNASSIGNED_DEPT } from './agent-list-dept-tree';
import type { OrgData } from './org-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const d = (id: string, name: string, parent_id: string | null, sort = 0) => ({ id, name, parent_id, leader_user_id: null, sort, member_count: 0 });
const org = { departments: [d('tm', 'TMAI', null, 0), d('w', 'TMWork', 'tm', 0), d('k', 'TM知识库', 'tm', 1), d('anet', 'ANet', null, 1), d('b', 'B 站', null, 2)], members: [] } as unknown as OrgData;

const rank = deptTreeRank(org);
const titles = ['B 站', UNASSIGNED_DEPT, 'TMAI / TM知识库', 'ANet', 'TMAI', 'TMAI / TMWork', '外部'];
ck('depth-first order: parent before its children, 未归属 last, unknown before it',
  eq([...titles].sort((a, b) => rank(a) - rank(b)), ['TMAI', 'TMAI / TMWork', 'TMAI / TM知识库', 'ANet', 'B 站', '外部', UNASSIGNED_DEPT]));
ck('no org: every rank finite (no NaN in sort)', [deptTreeRank(null)('x'), deptTreeRank(null)(UNASSIGNED_DEPT)].every(Number.isFinite));

const shown = new Set(['TMAI', 'TMAI / TMWork', 'ANet']);
ck('child under a shown parent: indented, leaf only', eq(deptHeaderLayout('TMAI / TMWork', shown), { depth: 1, prefix: null, leaf: 'TMWork' }));
ck('parent not in list: keep muted prefix, no indent', eq(deptHeaderLayout('B 站 / 运营', shown), { depth: 0, prefix: 'B 站 / ', leaf: '运营' }));
ck('grandchild: two levels when both ancestors shown', eq(deptHeaderLayout('TMAI / TMWork / 云', shown), { depth: 2, prefix: null, leaf: '云' }));
ck('grandchild, middle missing: one level + middle as prefix', eq(deptHeaderLayout('TMAI / 门户 / 前端', shown), { depth: 1, prefix: '门户 / ', leaf: '前端' }));
ck('top-level and 未归属 untouched', eq(deptHeaderLayout('ANet', shown), { depth: 0, prefix: null, leaf: 'ANet' }) && eq(deptHeaderLayout(UNASSIGNED_DEPT, shown).leaf, UNASSIGNED_DEPT));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
