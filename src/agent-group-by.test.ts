import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { Session } from './api';
import { buildAgentDirectory, type DirectoryNode } from './agent-directory';
import type { AgentOrgData } from './agent-org-model';
import { buildSections, countShown } from './agents-list';
import { departmentIndex, GROUP_BY_OPTIONS, groupMapOf, hostGroup, parseGroupBy, registrationIndex, runtimeGroup, statusGroup } from './agent-group-by';
import { pinyinMatch } from './lib/pinyin';

let passed = 0;
const check = (name: string, run: () => void) => { run(); passed++; console.log(`PASS: ${name}`); };
const s = (alias: string, network_id: string | null, node_id?: string | null, status = 'idle'): Session =>
  ({ alias, network_id, node_id, status });
const n = (alias: string, network_id: string | null, node_id: string | null): DirectoryNode =>
  ({ alias, network_id, node_id: node_id as string });
const directory = (nodes: DirectoryNode[], sessions: Session[]) => {
  const snap = <T>(rows: T[]) => ({ scopeKey: 'test', result: 'ok' as const, complete: true, rows });
  return { ...buildAgentDirectory({ scopeKey: 'test', nodes: snap(nodes), sessions: snap(sessions) }), loaded: true, stale: false };
};
const dept = (id: string, name: string) => ({ id, name, parent_id: null, leader_user_id: null, sort: 0, member_count: 0 });
const org: AgentOrgData = {
  directory: true, departmentsApi: true, agentDepartmentSupported: true,
  departments: [dept('work', 'TMWork'), dept('infra', 'TM基建')],
  owners: [{ userId: 'owner', username: 'alice', displayName: '', departmentId: 'infra', agents: [
    { nodeId: 'n1', alias: '通信甲', departmentId: 'work' },
    { nodeId: 'n2', alias: '通信乙', departmentId: null },
    { nodeId: 'n3', alias: '通信丙' },
  ] }],
  unowned: [{ nodeId: 'n4', alias: '通信丁', departmentId: 'infra' }],
};

check('four grouping options, invalid preference defaults to department', () => {
  assert.deepEqual(GROUP_BY_OPTIONS, ['dept', 'runtime', 'host', 'status']);
  assert.equal(parseGroupBy(null), 'dept');
  assert.equal(parseGroupBy('not-a-group'), 'dept');
  for (const by of GROUP_BY_OPTIONS) assert.equal(parseGroupBy(by), by);
});
check('runtime, host and status use reported fields and explicit unknowns', () => {
  assert.equal(runtimeGroup({ ...s('a', 'N'), runtime: 'agent-node:opencode', agent: 'codex' }), 'OpenCode');
  assert.equal(runtimeGroup({ ...s('a', 'N'), agent: 'agent-node:codex' }), 'Codex');
  assert.equal(runtimeGroup(s('a', 'N')), '未上报');
  assert.equal(runtimeGroup({ ...s('a', 'N'), runtime: 'other' }), 'other');
  assert.equal(hostGroup({ ...s('a', 'N'), server: 'dev', hostname: 'host' }), 'dev');
  assert.equal(hostGroup({ ...s('a', 'N'), hostname: 'host' }), 'host');
  assert.equal(hostGroup(s('a', 'N')), '未知主机');
  assert.equal(statusGroup(s('a', 'N', 'n', 'working')), '运行中');
  assert.equal(statusGroup(s('a', 'N', 'n', 'running')), '运行中');
  assert.equal(statusGroup(s('a', 'N', 'n', 'offline')), '离线');
  assert.equal(statusGroup(s('a', 'N', 'n', '')), '未知');
});

const full = [s('通信甲', 'N', 'n1'), s('通信乙', 'N', 'n2'), s('通信丙', 'N', 'n3'),
  s('通信丁', 'N', 'n4'), s('通信戊', 'N', 'missing')];
const nodes = full.slice(0, 4).map(r => n(r.alias, r.network_id!, r.node_id!));
// Real list rows come from the light projection, which typically omits node_id.
const light = full.map(r => s(r.alias, r.network_id));
const registrations = registrationIndex(directory(nodes, full));
const departments = departmentIndex('N', org);
const labels = groupMapOf(light, 'dept', registrations, departments);

check('actual node department beats its owner department', () => {
  assert.equal(labels.get(light[0]), 'TMWork');
  assert.equal(labels.get(light[3]), 'TM基建'); // unowned nodes still have explicit departments
});
check('explicit null differs from missing field and unmatched node', () => {
  assert.equal(labels.get(light[1]), '未归属');
  assert.equal(labels.get(light[2]), '归属待确认');
  assert.equal(labels.get(light[4]), '未匹配节点');
});
check('buildSections consumes every calculated department label, not alias prefixes', () => {
  const sections = buildSections(light, '', { teamOf: (_alias, session) => labels.get(session) });
  assert.equal(countShown(sections), light.length);
  assert.deepEqual(new Set(sections.map(section => section.title)),
    new Set(['TMWork', '未归属', '归属待确认', 'TM基建', '未匹配节点']));
  assert.equal(sections.some(section => section.title === '通信'), false);
  assert.equal(countShown(buildSections(light, '乙', { teamOf: (_a, row) => labels.get(row) })), 1);
});
check('pins and unread move rows instead of duplicating them when changing grouping', () => {
  for (const by of GROUP_BY_OPTIONS) {
    const groups = groupMapOf(light, by, registrations, departments);
    const sections = buildSections(light, '', { teamOf: (_a, row) => groups.get(row),
      sort: { pinned: alias => alias === '通信甲' }, unread: { count: alias => alias === '通信乙' ? 1 : 0 } });
    assert.equal(countShown(sections), light.length);
    assert.equal(sections.flatMap(section => section.data).filter(row => row.alias === '通信甲').length, 1);
    assert.equal(sections.flatMap(section => section.data).filter(row => row.alias === '通信乙').length, 1);
  }
});
check('department search survives switching views and does not match other rows', () => {
  for (const by of GROUP_BY_OPTIONS) {
    const groups = groupMapOf(light, by, registrations, departments);
    const sections = buildSections(light, 'TMWork', {
      match: pinyinMatch,
      matchSession: (row, query) => pinyinMatch(labels.get(row) ?? '', query),
      teamOf: (_alias, row) => groups.get(row),
    });
    assert.deepEqual(sections.flatMap(section => section.data.map(row => row.alias)), ['通信甲']);
  }
});
check('loading, stale and failed directory never claim unregistered', () => {
  for (const patch of [{ loaded: false }, { stale: true }, { nodesRead: 'unavailable' }, { sessionsRead: 'incomplete' }]) {
    const index = registrationIndex({ ...directory(nodes, full), ...patch });
    assert.equal(groupMapOf(light, 'dept', index, departments).get(light[4]), '关联待确认');
  }
});
check('missing session identity, missing node identity and mismatched light identity are unknown', () => {
  const unknownSession = s('甲', 'N', null);
  const missingNode = directory([n('无身份', 'N', null)], [s('乙', 'N', 'not-seen')]);
  const lightUnknown = s('甲', 'N');
  assert.equal(groupMapOf([lightUnknown], 'dept', registrationIndex(directory([], [unknownSession]))).get(lightUnknown), '关联待确认');
  const other = s('乙', 'N');
  assert.equal(groupMapOf([other], 'dept', registrationIndex(missingNode)).get(other), '关联待确认');
  const changed = s('通信甲', 'N', 'changed');
  assert.equal(groupMapOf([changed], 'dept', registrations, departments).get(changed), '关联待确认');
});
check('same alias in different networks stays separate; same network duplicates are unknown', () => {
  const fs = [s('same', 'N', 'n1'), s('same', 'other', 'n1')];
  const dir = registrationIndex(directory([n('same', 'N', 'n1'), n('same', 'other', 'n1')], fs));
  const [a, b] = [s('same', 'N'), s('same', 'other')];
  const grouped = groupMapOf([a, b], 'dept', dir, departments);
  assert.equal(grouped.get(a), 'TMWork');
  assert.equal(grouped.get(b), '归属待确认');
  const search = buildSections([a, b], 'TMWork', {
    matchSession: (row, query) => pinyinMatch(grouped.get(row) ?? '', query),
    teamOf: (_alias, row) => grouped.get(row),
  });
  assert.deepEqual(search.flatMap(section => section.data), [a]);
  const dup = s('same', 'N');
  assert.equal(groupMapOf([a, dup], 'dept', dir, departments).get(a), '关联待确认');
  const duplicateFull = registrationIndex(directory([n('same', 'N', 'n1')], [fs[0], fs[0]]));
  assert.equal(groupMapOf([a], 'dept', duplicateFull, departments).get(a), '关联待确认');
});
check('unsupported or unavailable department data never produces a guessed department', () => {
  for (const data of [null, { ...org, agentDepartmentSupported: false }, { ...org, departmentsApi: false }, { ...org, directory: false }]) {
    assert.equal(groupMapOf(light, 'dept', registrations, departmentIndex('N', data)).get(light[0]), '归属待确认');
  }
});
check('conflicting or incomplete duplicate directory rows remain uncertain', () => {
  const conflict: AgentOrgData = { ...org, unowned: [{ nodeId: 'n1', alias: '通信甲', departmentId: null }] };
  const incomplete: AgentOrgData = { ...org, unowned: [{ nodeId: 'n1', alias: '通信甲' }] };
  for (const data of [conflict, incomplete]) {
    assert.equal(groupMapOf(light, 'dept', registrations, departmentIndex('N', data)).get(light[0]), '归属待确认');
  }
});
check('screen wires every grouping mode to session-keyed labels', () => {
  const screen = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
  assert.ok(screen.includes('teamOf: (_alias, session) => groupLabels.get(session)'));
  assert.ok(!screen.includes("groupBy === 'dept' ? deptByAlias"));
  assert.ok(screen.includes('loadAgentOrg(cfg, cfg.networkId)'));
  assert.ok(!screen.includes('fetchDepartmentNodes('));
  assert.ok(screen.includes("groupMapOf(visibleSessions, 'dept', registrations"));
  assert.ok(screen.includes('matchSession: (session, q) => pinyinMatch(departmentLabels.get(session)'));
});

console.log(`${passed}/${passed} passed`);
