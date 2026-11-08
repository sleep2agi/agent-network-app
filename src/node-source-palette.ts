// 节点来源浮层（新建节点 / 接入已有会话 / fork 节点）的纯逻辑。
//
// 设计语言与 #4130 的模型命令面板一致（ComposerModelPalette）：搜索 → 分组（带计数）→
// 当前项 ✓ → 空态与真实错误态分离。这个文件只做判断，JSX 只负责画：
//   · 行从哪来：受管 source 会话（ses_，来自 full /api/status）+ 只读目录（oprj_ / oses_）；
//   · 过滤：项目名 / 会话名 / 路径，大小写不敏感；
//   · 分组与计数：按项目分组，count = 组内**会话**行数（项目行不是会话）；
//   · 当前项：只有 key 逐字命中才算 current（✓ 唯一）；
//   · 禁用：拿不到 selection_scope / 快照没有 selection_expires_at / oses_ 当 fork 源……
//     都要给出真实原因，不是灰掉不说话；
//   · 提交体：**逐字**复用既有合同构造器（session-source-fork / session-project-create），
//     不复写字段名、不改互斥规则、不凭空补字段。
//
// 纯逻辑，不 import react-native；ck 测试直接 import。

import {
  buildProjectCreateBody,
  canUseSnapshotForNewSession,
  validateProjectCreateSelection,
  type ProjectCreateSelection,
} from './session-project-create';
import {
  buildSourceForkBody,
  validateSelection,
  type SourceForkSelection,
} from './session-source-fork';
import { canUseAsForkSession } from './session-source-directory';
import { checkNodeName } from './node-name';

export type SourceRowKind = 'fork' | 'project' | 'session';
export type SourceSection = 'fork' | 'directory';

/** 目录快照里本模块真正读的字段（严格白名单在 session-source-directory.ts 里已经做过一次）。 */
export interface PaletteDirectorySnapshot {
  snapshotId: string;
  selectionExpiresAt: number | null;
  projects: ReadonlyArray<{ projectId: string; title: string }>;
  sessions: ReadonlyArray<{
    sessionId: string;
    projectId: string;
    title: string;
    activity?: 'running' | 'unknown';
    binding?: 'unknown';
  }>;
}

/** 受管 source 会话（ses_）。label 是别名 / 标题，path 是节点项目目录（真实上报才填）。 */
export interface ForkCandidate {
  sessionId: string;
  nodeId: string;
  label: string;
  path?: string | null;
}

/** 可提交性的全部外部前提；缺一项就给出真实原因，不放行。 */
export interface SourceGate {
  networkId: string | null;
  sourceNodeId: string | null;
  /** 「选过 Server 并返回 projects」的那次目录请求 id（srcdir_…）。null = 还没有。 */
  selectionScope: string | null;
  snapshotId: string | null;
  selectionExpiresAt: number | null;
  hasProjectCreateCapability: boolean;
  now?: number;
}

export interface SourceRow {
  /** `${kind}:${id}`，也是当前项判定与键盘导航的唯一键。 */
  key: string;
  kind: SourceRowKind;
  id: string;
  title: string;
  path: string | null;
  /** 目录行所属项目（oprj_）；fork 行 = null（用 path 分组）。只用于分组，不进请求体。 */
  projectId: string | null;
  /** 行右侧的解释（binding unknown / candidate 这类真实口径）。 */
  detail: string | null;
  /** null = 可提交；否则是不能提交的真实原因。 */
  disabledReason: string | null;
  sourceNodeId?: string;
}

export interface SourceGroup {
  key: string;
  section: SourceSection;
  title: string;
  path: string | null;
  /** 组内**会话**行数（过滤后）。 */
  count: number;
  rows: SourceRow[];
  /** 当前项在这组里（用于置顶）。 */
  current: boolean;
}

export type PaletteStatus = 'loading' | 'error' | 'ready';

export interface SourcePaletteView {
  status: PaletteStatus;
  /** 只有 status=error 时非空：所有来源都读失败时的真实原因。 */
  errorText: string | null;
  /** fork 名单读取失败的真实原因（Hub/daemon 原文）。 */
  forkError: string | null;
  /** 目录读取失败 / gate 未开放的真实原因。 */
  directoryError: string | null;
  groups: SourceGroup[];
  /** 过滤后可见行数（= 各组 rows 之和）。 */
  total: number;
  /** 过滤前的行数：区分「本来就没有」和「搜索没命中」。 */
  catalogTotal: number;
  /** 键盘导航用的扁平行序（只含可见行）。 */
  order: string[];
  /** 当前项 key；不在这份名单里 = null（不猜）。 */
  currentKey: string | null;
}

export const PROJECT_ROW_PREFIX = 'project:';
export const SESSION_ROW_PREFIX = 'session:';
export const FORK_ROW_PREFIX = 'fork:';

const projectKey = (id: string) => `${PROJECT_ROW_PREFIX}${id}`;
const sessionKey = (id: string) => `${SESSION_ROW_PREFIX}${id}`;
const forkKey = (id: string) => `${FORK_ROW_PREFIX}${id}`;

/** 目录 → 行：每个项目一行（新会话），每个 oses_ 会话一行（接入）。 */
export function directoryRows(
  snapshot: PaletteDirectorySnapshot | null | undefined,
  gate: SourceGate,
): SourceRow[] {
  if (!snapshot) return [];
  const rows: SourceRow[] = [];
  for (const project of snapshot.projects ?? []) {
    const id = (project.projectId ?? '').trim();
    if (!id) continue;
    const row: SourceRow = {
      key: projectKey(id),
      kind: 'project',
      id,
      title: (project.title ?? '').trim() || id,
      path: null,
      projectId: id,
      detail: `project_new_session · ${id}`,
      disabledReason: null,
    };
    rows.push({ ...row, disabledReason: sourceRowDisabledReason(row, gate) });
  }
  for (const session of snapshot.sessions ?? []) {
    const id = (session.sessionId ?? '').trim();
    if (!id) continue;
    const row: SourceRow = {
      key: sessionKey(id),
      kind: 'session',
      id,
      title: (session.title ?? '').trim() || id,
      path: null,
      projectId: (session.projectId ?? '').trim() || null,
      detail: session.activity === 'running'
        ? '活动：running（采样） · binding unknown · candidate'
        : '活动：unknown · binding unknown · candidate',
      disabledReason: null,
    };
    rows.push({ ...row, disabledReason: sourceRowDisabledReason(row, gate) });
  }
  return rows;
}

/** 受管 source 会话 → fork 行。oses_ 永远不能当 fork 源（合同红线）。 */
export function forkRows(candidates: readonly ForkCandidate[], gate: SourceGate): SourceRow[] {
  const seen = new Set<string>();
  const rows: SourceRow[] = [];
  for (const candidate of candidates) {
    const id = (candidate.sessionId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const row: SourceRow = {
      key: forkKey(id),
      kind: 'fork',
      id,
      title: (candidate.label ?? '').trim() || id,
      path: (candidate.path ?? '').trim() || null,
      projectId: null,
      detail: '受管 source 会话（ses_）',
      sourceNodeId: candidate.nodeId,
      disabledReason: null,
    };
    rows.push({ ...row, disabledReason: sourceRowDisabledReason(row, gate) });
  }
  return rows;
}

/** 行能不能提交；不能时给真实原因（与合同校验器同一口径，不另发明规则）。 */
export function sourceRowDisabledReason(row: SourceRow, gate: SourceGate): string | null {
  if (row.kind === 'fork') {
    if (!canUseAsForkSession(row.id)) return '目录 ID（oses_）不是受管 source session，不能 fork';
    const verdict = validateSelection({
      networkId: gate.networkId ?? '',
      sourceNodeId: gate.sourceNodeId ?? '',
      sessionId: row.id,
      childName: 'x',
      intentId: 'x',
    });
    return verdict.ok ? null : verdict.error;
  }
  const usable = canUseSnapshotForNewSession({
    snapshot: { expiresAt: null, selectionExpiresAt: gate.selectionExpiresAt },
    hasProjectCreateCapability: gate.hasProjectCreateCapability,
    now: gate.now,
  });
  if (!usable.ok) return usable.reason;
  if (!gate.selectionScope) {
    return '还没有「选过 Server 并返回 projects」的目录请求（selection_scope），不能提交新会话';
  }
  const verdict = validateProjectCreateSelection({
    selectionScope: gate.selectionScope,
    snapshotId: gate.snapshotId ?? '',
    ...(row.kind === 'project' ? { projectId: row.id } : { sessionId: row.id }),
    childName: 'x',
    intentId: 'x',
  });
  return verdict.ok ? null : verdict.error;
}

const sectionOf = (row: SourceRow): SourceSection => (row.kind === 'fork' ? 'fork' : 'directory');

const groupKeyOf = (row: SourceRow): string => {
  if (row.kind === 'fork') return `fork:${row.path ?? '∅'}`;
  const projectId = row.projectId ?? (row.kind === 'project' ? row.id : '');
  return `dir:${projectId || '∅'}`;
};

function groupTitleOf(row: SourceRow, snapshot: PaletteDirectorySnapshot | null): string {
  if (row.kind === 'fork') {
    const path = row.path ?? '';
    return path.split('/').filter(Boolean).pop() || '未上报项目目录';
  }
  const projectId = row.projectId ?? (row.kind === 'project' ? row.id : '');
  const project = (snapshot?.projects ?? []).find(p => p.projectId === projectId);
  return (project?.title ?? '').trim() || projectId || '未归属项目';
}

/** 按项目分组：fork 组在前、目录组在后；组序 = 首次出现顺序，当前项所在组置顶。 */
export function groupSourceRows(
  rows: readonly SourceRow[],
  snapshot: PaletteDirectorySnapshot | null,
  currentKey: string | null,
): SourceGroup[] {
  const buckets = new Map<string, { section: SourceSection; title: string; path: string | null; rows: SourceRow[] }>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const bucket = buckets.get(key);
    const title = groupTitleOf(row, snapshot);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { section: sectionOf(row), title, path: row.kind === 'fork' ? row.path : null, rows: [row] });
  }
  const all = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    section: bucket.section,
    title: bucket.title,
    path: bucket.path,
    count: bucket.rows.filter(r => r.kind !== 'project').length,
    rows: bucket.rows,
    current: currentKey !== null && bucket.rows.some(r => r.key === currentKey),
  }));
  const ordered = [...all.filter(g => g.section === 'fork'), ...all.filter(g => g.section === 'directory')];
  if (!currentKey) return ordered;
  const idx = ordered.findIndex(g => g.current);
  if (idx <= 0) return ordered;
  return [ordered[idx], ...ordered.slice(0, idx), ...ordered.slice(idx + 1)];
}

/** 搜索：项目名 / 会话名 / 路径 / id 都能命中，大小写不敏感；空查询返回全部（保序）。 */
export function rowMatchesQuery(row: SourceRow, query: string): boolean {
  if (!query) return true;
  return [row.title, row.path, row.id].some(value => (value ?? '').toLowerCase().includes(query));
}

export function groupMatchesQuery(group: SourceGroup, query: string): boolean {
  if (!query) return true;
  return [group.title, group.path].some(value => (value ?? '').toLowerCase().includes(query));
}

/** 过滤：组头命中 ⇒ 组内全部保留（按项目找会话）；否则只留命中的行。空组不画。 */
export function filterSourceGroups(groups: readonly SourceGroup[], query: string | null | undefined): SourceGroup[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return groups.map(group => ({ ...group }));
  const out: SourceGroup[] = [];
  for (const group of groups) {
    const keepAll = groupMatchesQuery(group, q);
    const rows = keepAll ? group.rows : group.rows.filter(row => rowMatchesQuery(row, q));
    if (!rows.length) continue;
    out.push({ ...group, rows, count: rows.filter(r => r.kind !== 'project').length });
  }
  return out;
}

export interface SourcePaletteInput {
  forkRows: readonly SourceRow[];
  directoryRows: readonly SourceRow[];
  snapshot?: PaletteDirectorySnapshot | null;
  query?: string | null;
  selectedKey?: string | null;
  forkLoading?: boolean;
  directoryLoading?: boolean;
  /** fork 名单读取失败的真实原因（Hub 原文）。 */
  forkError?: string | null;
  /** 目录读取失败 / gate 未开放的真实原因。 */
  directoryError?: string | null;
}

/** 面板的完整视图模型：loading / 真实错误 / 分组结果，三态互斥。 */
export function sourcePaletteView(input: SourcePaletteInput): SourcePaletteView {
  const forkError = input.forkError ?? null;
  const directoryError = input.directoryError ?? null;
  const forkLoading = !!input.forkLoading;
  const directoryLoading = !!input.directoryLoading;
  const forkFailed = !!forkError && !forkLoading;
  const directoryFailed = !!directoryError && !directoryLoading;
  const everySourceFailed = forkFailed && directoryFailed;
  const everySourceLoading = forkLoading && directoryLoading;
  if (everySourceFailed) {
    return {
      status: 'error',
      errorText: [forkError, directoryError].filter(Boolean).join(' · '),
      forkError,
      directoryError,
      groups: [],
      total: 0,
      catalogTotal: 0,
      order: [],
      currentKey: null,
    };
  }
  if (everySourceLoading) {
    return { status: 'loading', errorText: null, forkError, directoryError, groups: [], total: 0, catalogTotal: 0, order: [], currentKey: null };
  }
  const all = [...input.forkRows, ...input.directoryRows];
  const currentKey = (input.selectedKey ?? '').trim() && all.some(row => row.key === input.selectedKey)
    ? (input.selectedKey as string)
    : null;
  const groups = groupSourceRows(all, input.snapshot ?? null, currentKey).map(group => ({
    ...group,
    rows: group.rows.map(row => ({ ...row })),
  }));
  const filtered = filterSourceGroups(groups, input.query);
  const order = filtered.flatMap(group => group.rows.map(row => row.key));
  return {
    status: 'ready',
    errorText: null,
    forkError,
    directoryError,
    groups: filtered,
    total: order.length,
    catalogTotal: all.length,
    order,
    currentKey,
  };
}

/** 当前项：只有 key 逐字命中列表里的某一行才算（不在名单里 = null，不猜）。 */
export function currentSourceKey(selectedKey: string | null | undefined, rows: readonly SourceRow[]): string | null {
  const key = (selectedKey ?? '').trim();
  if (!key) return null;
  return rows.find(row => row.key === key)?.key ?? null;
}

/** 键盘：上/下移动 active；到边界不循环（和系统列表一致）。 */
export function stepActiveKey(order: readonly string[], activeKey: string | null, delta: 1 | -1): string | null {
  if (!order.length) return null;
  const idx = activeKey ? order.indexOf(activeKey) : -1;
  if (idx < 0) return delta > 0 ? order[0] : order[order.length - 1];
  const next = Math.max(0, Math.min(order.length - 1, idx + delta));
  return order[next];
}

export type PaletteTarget = 'new_session' | 'attach' | 'fork';

export function targetOfRow(row: SourceRow): PaletteTarget {
  return row.kind === 'fork' ? 'fork' : row.kind === 'project' ? 'new_session' : 'attach';
}

export type PaletteSubmission =
  | { ok: true; target: 'new_session' | 'attach'; selection: ProjectCreateSelection; body: Record<string, string> }
  | { ok: true; target: 'fork'; selection: SourceForkSelection; body: Record<string, string> }
  | { ok: false; error: string };

export interface PaletteSubmissionInput {
  row: SourceRow;
  networkId: string | null;
  sourceNodeId: string | null;
  selectionScope: string;
  snapshotId: string;
  childName: string;
  intentId: string;
}

/**
 * 提交体构造：字段名与互斥规则直接复用合同构造器。
 * project/attach：**恰好** selection_scope / snapshot_id / child_name / intent_id + (project_id | session_id)；
 * fork：**恰好** network_id / source_node_id / session_id / mode / child_name / intent_id，且不改写 native ses_。
 */
export function buildPaletteSubmission(input: PaletteSubmissionInput): PaletteSubmission {
  const childName = input.childName ?? '';
  if (input.row.disabledReason) return { ok: false, error: input.row.disabledReason };
  const nameIssue = childNameIssue(childName);
  if (nameIssue) return { ok: false, error: nameIssue };
  if (!input.intentId) return { ok: false, error: '缺少 intent_id：不会提交一个无法收敛的意图' };

  if (input.row.kind === 'fork') {
    const selection: SourceForkSelection = {
      networkId: input.networkId ?? '',
      sourceNodeId: input.row.sourceNodeId ?? input.sourceNodeId ?? '',
      sessionId: input.row.id,
      childName,
      intentId: input.intentId,
    };
    const verdict = validateSelection(selection);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    return { ok: true, target: 'fork', selection, body: buildSourceForkBody(selection) };
  }

  const selection: ProjectCreateSelection = {
    selectionScope: input.selectionScope,
    snapshotId: input.snapshotId,
    ...(input.row.kind === 'project' ? { projectId: input.row.id } : { sessionId: input.row.id }),
    childName,
    intentId: input.intentId,
  };
  const verdict = validateProjectCreateSelection(selection);
  if (!verdict.ok) return { ok: false, error: verdict.error };
  return {
    ok: true,
    target: input.row.kind === 'project' ? 'new_session' : 'attach',
    selection,
    body: buildProjectCreateBody(selection),
  };
}

/** 名称规则（合同：child_name 沿用节点名校验；这里先用合同校验器的宽松口径挡住空/空白）。 */
export function childNameIssue(childName: string | null | undefined): string | null {
  const raw = childName ?? '';
  if (!raw.trim()) return '请先填写新名称';
  if (!/^[^\s\x00-\x1f\x7f]{1,64}$/.test(raw)) return '名称不能含空白或控制字符，最多 64 个字符';
  return null;
}

/** 打开浮层时给一个合法的初始名（用户可改），不提交、不占位成已创建。 */
export function suggestChildName(kind: SourceRowKind, label: string, id: string): string {
  const tail = (id.replace(/^(ses|oses|oprj)_/i, '') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  // 标签就是 id 时别把 ses_ 当名字的一部分（列表还没读到时 label 会等于 id）。
  const looksLikeId = (label ?? '').trim() === id.trim() || /^(ses|oses|oprj)_/i.test((label ?? '').trim());
  const stem = looksLikeId
    ? ''
    : (label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const suffix = kind === 'fork' ? 'fork' : kind === 'project' ? 'new' : 'attach';
  const candidates = [
    `${stem || tail || 'child'}-${suffix}`,
    `${suffix}-${tail || 'child'}`,
  ];
  for (const candidate of candidates) {
    const checked = checkNodeName(candidate);
    if (checked.ok) return checked.name;
  }
  return '';
}

/** 确认区顶部的模式说明：fork 只这一种模式；新会话/接入不带 mode 字段。 */
export function paletteModeLabel(target: PaletteTarget): string {
  if (target === 'fork') return '独立 fork · mode=fork_independent';
  if (target === 'new_session') return '新会话 · 不带 mode / 不带 session_id';
  return '接入已有会话 · 不带 mode / 不带 project_id';
}

/** 行的一行摘要（确认区用）：标题 + 真实 id，不加解释性结论。 */
export function paletteRowSummary(row: SourceRow): string {
  return `${row.title} · ${row.id}`;
}
