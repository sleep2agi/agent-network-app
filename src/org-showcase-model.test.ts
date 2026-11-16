import { DEPT_HUES, deptTrail, isRunning, pickAvatars, scopedPlaced, showcaseColumns, showcaseStats } from './org-showcase-model';
import type { AgentOrgData, PlacedAgent } from './agent-org-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const dept = (id: string, name: string, parent_id: string | null = null, sort = 0) => ({ id, name, parent_id, leader_user_id: null, sort });
const data = { departments: [dept('a', 'A'), dept('a1', 'A1', 'a'), dept('a11', 'A11', 'a1'), dept('b', 'B', null, 1)], owners: [], unowned: [], directory: true, departmentsApi: true, agentDepartmentSupported: true } as unknown as AgentOrgData;
const agent = (nodeId: string, alias: string, departmentId: string | null, owner: string | null, live: boolean): PlacedAgent =>
  ({ nodeId, alias, departmentId, ownerUserId: owner, ownerName: owner, sourceDepartmentId: departmentId, demo: false, lifecycleState: live ? 'active' : 'stopped' } as PlacedAgent);
const placed = [
  agent('1', '甲', 'a', 'u1', true), agent('2', '乙', 'a1', 'u1', false), agent('3', '丙', 'a11', 'u2', true),
  agent('4', '丁', 'b', null, false), agent('5', '戊', null, 'u3', true),
];

const s = showcaseStats(data, placed);
ck('stats: agents / departments / running / owners / unassigned', s.agents === 5 && s.departments === 4 && s.running === 3 && s.owners === 3 && s.unassigned === 1);

const cols = showcaseColumns(data, placed);
ck('one column per root department, in sort order', cols.map(c => c.dept.id).join() === 'a,b');
ck('root totals include every sub-level', cols[0].total === 3 && cols[0].running === 2 && cols[1].total === 1);
ck('children flatten in tree order with depth', cols[0].children.map(c => `${c.dept.id}:${c.depth}`).join() === 'a1:1,a11:2');
ck('child totals include their own sub-levels', cols[0].children[0].total === 2 && cols[0].children[1].total === 1);
ck('hues rotate by column', cols[0].hue === DEPT_HUES[0] && cols[1].hue === DEPT_HUES[1]);
ck('unassigned agents are not in any column', !cols.some(c => c.avatars.includes('戊')));

const many = Array.from({ length: 9 }, (_, i) => agent(`m${i}`, `m${i}`, 'a', null, i % 2 === 0));
const pick = pickAvatars(many, 4);
ck('avatars: running first, then +N for the rest', pick.aliases.length === 4 && pick.aliases.every(a => Number(a.slice(1)) % 2 === 0) && pick.more === 5);
ck('avatars: fewer than n → no +N', pickAvatars(many.slice(0, 2), 4).more === 0);

// 下钻
const sub = showcaseColumns(data, placed, { rootId: 'a' });
ck('drill: columns are the children of the drilled department', sub.map(c => c.dept.id).join() === 'a1' && sub[0].children.map(c => c.dept.id).join() === 'a11');
ck('drill: leaf department has no columns', showcaseColumns(data, placed, { rootId: 'a11' }).length === 0);
const ss = showcaseStats(data, placed, 'a');
ck('drill: stats scoped to the subtree (no unassigned)', ss.agents === 3 && ss.departments === 2 && ss.running === 2 && ss.owners === 2 && ss.unassigned === 0);
ck('drill: scopedPlaced = agents in the subtree', scopedPlaced(data, placed, 'a1').map(a => a.alias).sort().join() === ['乙', '丙'].sort().join() && scopedPlaced(data, placed, null).length === 5);
ck('drill: trail root → department', deptTrail(data, 'a11').map(d => d.id).join() === 'a,a1,a11' && deptTrail(data, null).length === 0);

// admin 2026-11-16：久未上线的也显示在图上，但不能算「运行中」
{
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const fresh = new Date(Date.now() - 60_000).toISOString();
  ck('🔴 active 但 30 天没动 → 不算运行中', !isRunning({ lifecycleState: 'active', updatedAt: old }));
  ck('active 且刚动过 → 运行中', isRunning({ lifecycleState: 'active', updatedAt: fresh }));
  ck('active、不知道多久 → 仍算运行中（向后兼容）', isRunning({ lifecycleState: 'active' }));
}
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
