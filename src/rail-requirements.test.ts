import assert from 'node:assert/strict';
import { requirementsForAgent } from './rail-requirements';

const base = { due: '', assignee: '', priority: 'P2', column: 'pool' } as const;
const rows: any[] = [
  { ...base, id: '1', name: 'agent owner by node id', column: 'doing', agentOwner: { kind: 'node', id: 'n_a' } },
  { ...base, id: '2', name: 'participant by alias', participants: [{ kind: 'node', id: 'A' }] },
  { ...base, id: '3', name: 'old hub assignee', assignee: 'A', column: 'done' },
  { ...base, id: '4', name: 'someone else', agentOwner: { kind: 'node', id: 'n_b' } },
  { ...base, id: '5', name: 'archived', agentOwner: { kind: 'node', id: 'n_a' }, archived: true },
  { ...base, id: '6', name: 'abandoned', agentOwner: { kind: 'node', id: 'n_a' }, column: 'abandoned' },
];
const r = requirementsForAgent(rows, { alias: 'A', nodeId: 'n_a' });
assert.deepEqual(r.doing.map(x => x.id), ['1']);
assert.deepEqual(r.pool.map(x => x.id), ['2']);
assert.deepEqual(r.done.map(x => x.id), ['3']);
// 没有 node_id 时只按 alias
assert.deepEqual(requirementsForAgent(rows, { alias: 'A', nodeId: null }).doing.map(x => x.id), []);
console.log('rail-requirements: ok');
