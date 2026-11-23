import assert from 'node:assert/strict';
import { agentCount, orgTree, placeAgents, showUnassigned, type AgentOrgData } from './agent-org-model';
import { flattenTree } from './org-model';
import { phoneLevel } from './org-phone-list';

const depts = [['parent', null], ['a', 'parent'], ['b', 'parent'], ['c', 'parent'], ['outside', 'missing']] as const;
const data: AgentOrgData = {
  departments: depts.map(([id, parent_id], sort) => ({ id, name: id, parent_id, sort, leader_user_id: null, member_count: 0 })),
  directory: true, departmentsApi: true, agentDepartmentSupported: true, owners: [],
  unowned: [6, 14, 16].flatMap((n, i) => Array.from({ length: n }, (_, j) => ({ nodeId: `${i}-${j}`, alias: `${i}-${j}`, departmentId: ['a','b','c'][i] }))),
};
const placed = placeAgents(data, []);
function phoneRows(parent: string | null, depth = 0): Array<[string, number]> {
  return phoneLevel(data, parent).flatMap(({ dept }) => [[dept.id, depth] as [string, number], ...phoneRows(dept.id, depth + 1)]);
}
assert.deepEqual(phoneRows(null), flattenTree(orgTree(data)).map(r => [r.dept.id, r.depth]));
assert.deepEqual(phoneLevel(data, null).map(r => r.dept.id), ['parent', 'outside']);
assert.deepEqual(['parent','a','b','c'].map(id => agentCount(placed, data, id)), [36,6,14,16]);
assert.equal(showUnassigned(agentCount(placed, data, null)), false);
assert.equal(showUnassigned(agentCount(placeAgents({ ...data, unowned: [...data.unowned, { alias: 'free', nodeId: 'free' }] }, []), data, null)), true);
console.log('5/5 department parity assertions passed');
