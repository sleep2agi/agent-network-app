// ck-style：节点来源浮层（新建会话 / 接入 / fork）的纯逻辑。
// 只测判断：过滤、分组计数、当前项、禁用原因、提交体逐字字段。JSX 不在这里测。
import { strict as assert } from 'node:assert';
import {
  buildPaletteSubmission,
  childNameIssue,
  currentSourceKey,
  directoryRows,
  filterSourceGroups,
  forkRows,
  groupSourceRows,
  paletteModeLabel,
  sourcePaletteView,
  sourceRowDisabledReason,
  stepActiveKey,
  suggestChildName,
  targetOfRow,
  type ForkCandidate,
  type PaletteDirectorySnapshot,
  type SourceGate,
} from './node-source-palette';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };

const SCOPED = 'srcdir_00000000-0000-0000-0000-000000000003';
const future = Date.now() + 600_000;

const gate = (over: Partial<SourceGate> = {}): SourceGate => ({
  networkId: 'net-sweep',
  sourceNodeId: 'n_a',
  selectionScope: SCOPED,
  snapshotId: 'snap_1',
  selectionExpiresAt: future,
  hasProjectCreateCapability: true,
  ...over,
});

const snapshot: PaletteDirectorySnapshot = {
  snapshotId: 'snap_1',
  selectionExpiresAt: future,
  projects: [
    { projectId: 'oprj_1', title: 'Alpha' },
    { projectId: 'oprj_2', title: 'Beta' },
  ],
  sessions: [
    { sessionId: 'oses_1', projectId: 'oprj_1', title: 'Alpha-已有-a', activity: 'unknown' },
    { sessionId: 'oses_2', projectId: 'oprj_1', title: 'Alpha-已有-b', activity: 'running' },
    { sessionId: 'oses_3', projectId: 'oprj_2', title: 'Beta-已有', activity: 'unknown' },
  ],
};

const candidates: ForkCandidate[] = [
  { sessionId: 'ses_A', nodeId: 'n_a', label: '示例-A', path: '/work/demo-a' },
  { sessionId: 'ses_B', nodeId: 'n_b', label: '示例-B', path: '/work/demo-a' },
  { sessionId: 'ses_C', nodeId: 'n_c', label: '示例-C', path: '/work/demo-c' },
];

// ── 1) 目录行：项目一行 + 每个 oses_ 会话一行，拿到真实禁用原因 ─────────────
const dirRows = directoryRows(snapshot, gate());
ck('directory rows = 2 projects + 3 sessions', dirRows.length === 5);
ck('project rows carry oprj_ and projectId', dirRows.filter(r => r.kind === 'project').every(r => r.id.startsWith('oprj_') && r.projectId === r.id));
ck('session rows stay opaque oses_ and keep their project', dirRows.filter(r => r.kind === 'session').every(r => r.id.startsWith('oses_')) && dirRows.find(r => r.id === 'oses_2')!.projectId === 'oprj_1');
ck('running activity is labelled as a sample + binding unknown', dirRows.find(r => r.id === 'oses_2')!.detail!.includes('running（采样）') && dirRows.find(r => r.id === 'oses_2')!.detail!.includes('binding unknown'));
ck('unknown activity never claims the session is idle', !dirRows.some(r => /空闲|idle/i.test(r.detail ?? '')));
ck('all project/attach rows selectable with a valid scope', dirRows.every(r => r.disabledReason === null));

// ── 2) fork 行：ses_ 可 fork，oses_ 永远不行 ──────────────────────────────
const fRows = forkRows(candidates, gate());
const otherSource = buildPaletteSubmission({ row: fRows[1], networkId: 'net-sweep', sourceNodeId: 'n_a', selectionScope: SCOPED, snapshotId: 'snap_1', childName: 'child', intentId: 'intent_source' });
ck('fork of another listed session uses its real source node, not the open detail node', otherSource.ok && otherSource.body.source_node_id === 'n_b');
ck('fork rows keep the native ses_ id', fRows.map(r => r.id).join(',') === 'ses_A,ses_B,ses_C');
ck('fork rows keys are fork:<ses_>', fRows.every(r => r.key === `fork:${r.id}`));
const osesAsFork = forkRows([{ sessionId: 'oses_1', nodeId: 'n_a', label: 'x' }], gate());
ck('oses_ as a fork source is disabled with the contract reason', osesAsFork[0].disabledReason !== null && osesAsFork[0].disabledReason!.includes('oses_'));
ck('fork without a known source node is disabled', forkRows(candidates, gate({ sourceNodeId: null }))[0].disabledReason !== null);
ck('fork without a network is disabled', forkRows(candidates, gate({ networkId: null }))[0].disabledReason!.includes('network_id'));

// ── 3) 快照门：旧快照 / 缺 selection_scope 都要真实原因 ────────────────────
const noScope = directoryRows(snapshot, gate({ selectionScope: null }));
ck('missing selection_scope disables new session with a real reason', noScope.every(r => r.disabledReason !== null) && noScope[0].disabledReason!.includes('selection_scope'));
const oldSnap = directoryRows(snapshot, gate({ selectionExpiresAt: null }));
ck('snapshot without selection_expires_at cannot authorize a new session', oldSnap.every(r => r.disabledReason!.includes('selection_expires_at')));
const expired = directoryRows(snapshot, gate({ selectionExpiresAt: Date.now() - 1000 }));
ck('expired selection says to refresh, no auto replay', expired.every(r => r.disabledReason!.includes('过期')));

// ── 4) 分组与计数：按项目分组，count = 组内会话数 ─────────────────────────
const view = sourcePaletteView({
  forkRows: fRows,
  directoryRows: dirRows,
  snapshot,
  selectedKey: 'fork:ses_A',
});
ck('view is ready with both sections', view.status === 'ready' && view.groups.some(g => g.section === 'fork') && view.groups.some(g => g.section === 'directory'));
const forkGroups = view.groups.filter(g => g.section === 'fork');
ck('fork groups group by project path', forkGroups.length === 2 && forkGroups.find(g => g.path === '/work/demo-a')!.count === 2);
const alpha = view.groups.find(g => g.section === 'directory' && g.title === 'Alpha')!;
ck('directory group counts the sessions under the project (not the project row)', alpha.count === 2 && alpha.rows.length === 3);
const beta = view.groups.find(g => g.section === 'directory' && g.title === 'Beta')!;
ck('a project with one session counts 1', beta.count === 1);
ck('current group is lifted to the top of its section', view.groups[0].key === 'fork:/work/demo-a');
ck('exactly one current row is true', view.groups.flatMap(g => g.rows).filter(r => r.key === view.currentKey).length === 1 && view.currentKey === 'fork:ses_A');

// ── 5) 过滤：项目名 / 会话名 / 路径，大小写不敏感 ─────────────────────────
const byProject = filterSourceGroups(groupSourceRows([...fRows, ...dirRows], snapshot, 'fork:ses_A'), 'aLPha');
ck('search by project name (case-insensitive) keeps that project group', byProject.every(g => g.section === 'fork' || g.title === 'Alpha') && byProject.find(g => g.title === 'Alpha')!.rows.length === 3);
const bySession = filterSourceGroups(groupSourceRows([...fRows, ...dirRows], snapshot, null), '示例-b');
ck('search by session label keeps only that row', bySession.flatMap(g => g.rows).map(r => r.id).join(',') === 'ses_B');
const byPath = filterSourceGroups(groupSourceRows([...fRows, ...dirRows], snapshot, null), '/work/demo-c');
ck('search by path hits the fork group', byPath.flatMap(g => g.rows).map(r => r.id).join(',') === 'ses_C');
ck('search by opaque directory id works too', filterSourceGroups(groupSourceRows(dirRows, snapshot, null), 'oses_3').flatMap(g => g.rows).map(r => r.id).join(',') === 'oses_3');
const noMatch = sourcePaletteView({ forkRows: fRows, directoryRows: dirRows, snapshot, query: 'zzz', selectedKey: 'fork:ses_A' });
ck('no match is an empty result, not an error, and keeps catalogTotal', noMatch.status === 'ready' && noMatch.total === 0 && noMatch.catalogTotal === 8 && noMatch.errorText === null);

// ── 6) 当前项只在列表里才算 ───────────────────────────────────────────────
ck('current key only when it is in the list', currentSourceKey('fork:ses_A', fRows) === 'fork:ses_A' && currentSourceKey('fork:nope', fRows) === null);
ck('current key is null for an empty selection (no guessing)', currentSourceKey(null, fRows) === null && currentSourceKey('', fRows) === null);
const filteredAway = sourcePaletteView({ forkRows: fRows, directoryRows: dirRows, snapshot, query: 'beta', selectedKey: 'fork:ses_A' });
ck('a filtered-out selection shows no checkmark in the list', filteredAway.groups.flatMap(g => g.rows).every(r => r.key !== 'fork:ses_A') && filteredAway.currentKey === 'fork:ses_A');

// ── 7) 空态 vs 真实错误态 ────────────────────────────────────────────────
const bothFailed = sourcePaletteView({ forkRows: [], directoryRows: [], forkError: 'HTTP 503', directoryError: 'source_directory_unavailable' });
ck('both sources failing is an error state with the real texts', bothFailed.status === 'error' && bothFailed.errorText!.includes('HTTP 503') && bothFailed.errorText!.includes('source_directory_unavailable'));
const forkFailedOnly = sourcePaletteView({ forkRows: [], directoryRows: dirRows, snapshot, forkError: 'HTTP 503' });
ck('one source failing stays ready and keeps that real error', forkFailedOnly.status === 'ready' && forkFailedOnly.forkError === 'HTTP 503' && forkFailedOnly.directoryError === null);
const emptyScope = sourcePaletteView({ forkRows: [], directoryRows: [], forkError: null, directoryError: null });
ck('an empty authorized scope is ready+empty, never a fake list', emptyScope.status === 'ready' && emptyScope.total === 0 && emptyScope.catalogTotal === 0);
const loading = sourcePaletteView({ forkRows: [], directoryRows: [], forkLoading: true, directoryLoading: true });
ck('loading is its own state', loading.status === 'loading');

// ── 8) 提交体：字段名与互斥规则逐字沿用合同构造器 ────────────────────────
const projectRow = dirRows.find(r => r.kind === 'project')!;
const sessionRow = dirRows.find(r => r.id === 'oses_2')!;
const forkRow = fRows[0];
const base = { networkId: 'net-sweep', sourceNodeId: 'n_a', selectionScope: SCOPED, snapshotId: 'snap_1', childName: 'child-1', intentId: 'intent_1' };

const projectSub = buildPaletteSubmission({ ...base, row: projectRow });
ck('new session body is exactly 5 fields with project_id', projectSub.ok && JSON.stringify(Object.keys(projectSub.body)) === JSON.stringify(['selection_scope', 'snapshot_id', 'child_name', 'intent_id', 'project_id']));
ck('new session body never carries session_id', projectSub.ok && !('session_id' in projectSub.body) && projectSub.target === 'new_session');

const attachSub = buildPaletteSubmission({ ...base, row: sessionRow });
ck('attach body is exactly 5 fields with the opaque session_id', attachSub.ok && JSON.stringify(Object.keys(attachSub.body)) === JSON.stringify(['selection_scope', 'snapshot_id', 'child_name', 'intent_id', 'session_id']));
ck('attach keeps oses_ and never invents project_id', attachSub.ok && attachSub.body.session_id === 'oses_2' && !('project_id' in attachSub.body));
ck('attach does not carry fork mode/network/source fields', attachSub.ok && !('mode' in attachSub.body) && !('network_id' in attachSub.body) && !('source_node_id' in attachSub.body));

const forkSub = buildPaletteSubmission({ ...base, row: forkRow });
ck('fork body is exactly the 6 contract fields', forkSub.ok && JSON.stringify(Object.keys(forkSub.body)) === JSON.stringify(['network_id', 'source_node_id', 'session_id', 'mode', 'child_name', 'intent_id']));
ck('fork keeps the native ses_ and mode=fork_independent', forkSub.ok && forkSub.body.session_id === 'ses_A' && forkSub.body.mode === 'fork_independent' && forkSub.body.network_id === 'net-sweep' && forkSub.body.source_node_id === 'n_a');
ck('fork body never carries project/directory fields', forkSub.ok && !('project_id' in forkSub.body) && !('selection_scope' in forkSub.body) && !('snapshot_id' in forkSub.body));

const osesForkSub = buildPaletteSubmission({ ...base, row: osesAsFork[0] });
ck('a disabled row never produces a body', osesForkSub.ok === false && osesForkSub.error.includes('oses_'));
const noName = buildPaletteSubmission({ ...base, row: forkRow, childName: '  ' });
ck('an empty child name is refused before any request', noName.ok === false && noName.error.includes('名称'));
ck('child name rule: whitespace/control rejected, CJK accepted', childNameIssue('a b') !== null && childNameIssue('测试-1') === null && childNameIssue('') !== null && childNameIssue('x'.repeat(65)) !== null);
const badIntent = buildPaletteSubmission({ ...base, row: forkRow, intentId: 'not valid' });
ck('an illegal intent is refused instead of posted', badIntent.ok === false);

// ── 9) 目标行语义与键盘 ──────────────────────────────────────────────────
ck('row target mapping', targetOfRow(projectRow) === 'new_session' && targetOfRow(sessionRow) === 'attach' && targetOfRow(forkRow) === 'fork');
ck('mode label never claims fork for new/attach', paletteModeLabel('fork').includes('fork_independent') && !paletteModeLabel('new_session').includes('fork') && !paletteModeLabel('attach').includes('session_id'));
const order = view.order;
ck('keyboard down walks the visible order and stops at the end', stepActiveKey(order, null, 1) === order[0] && stepActiveKey(order, order[order.length - 1], 1) === order[order.length - 1]);
ck('keyboard up walks back and stops at the start', stepActiveKey(order, order[0], -1) === order[0] && stepActiveKey(order, order[1], -1) === order[0]);
ck('keyboard on an empty list does nothing', stepActiveKey([], 'x', 1) === null);

// ── 10) 初始名必须是合法节点名 ───────────────────────────────────────────
const suggested = [suggestChildName('fork', '示例-A', 'ses_A'), suggestChildName('project', 'Alpha', 'oprj_1'), suggestChildName('session', 'Beta-已有', 'oses_3')];
ck('suggested names are non-empty ASCII node names', suggested.every(name => /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(name)));
ck('suggested names differ by target', new Set(suggested).size === 3);

console.log(`\n${n}/${n} passed`);
