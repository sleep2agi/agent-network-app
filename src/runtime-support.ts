// Runtime 支持 — 每个 runtime 对 ANet 功能的支持表。
//
// 功能格对齐公开支持矩阵 https://www.anet.sh/guide/support-matrix
// （✅ 已验证 / ❌ 已验证不可用 / ❓ 未验证 / — 不适用）。
// 矩阵没单列的产品功能（Hub 对话、令牌、Skills、Steer、长时间任务）
// 保持「未验证」或只在客户端已经写死的窄路径上标支持，不把未验证画成支持。
//
// 本机探测另算：host_supervisor 的 runtime_readiness / can_create_nodes / adopt_capable。
// 缺席 ≠ 不可用（与 daemon-capability.ts、runtime-readiness.ts 同一族）。
// 功能表本身没有实时接口，调用方显示「演示数据 · 后端开发中」。

import { describeDaemonCapability, type DaemonCapabilityKind } from './daemon-capability';
import { hasReadiness, readinessFor, UNCHECKED_LABEL, type ReadinessInput, type RuntimeReadinessMap } from './runtime-readiness';

export const SUPPORT_MATRIX_PATH = '/guide/support-matrix';

export const RUNTIME_SUPPORT_ORDER = [
  'claude-agent-sdk',
  'codex-sdk',
  'grok-build-acp',
  'claude-code-cli',
  'codex-app-server',
  'grok-build-cli',
  'opencode-cli',
] as const;

export type RuntimeSupportId = (typeof RUNTIME_SUPPORT_ORDER)[number];

export const ANET_FEATURE_ORDER = [
  'hub_chat',
  'tui_copresence',
  'daemon_lifecycle',
  'adopt',
  'provider_config',
  'skills',
  'tokens',
  'steer',
  'long_task',
] as const;

export type AnetFeatureId = (typeof ANET_FEATURE_ORDER)[number];

export type SupportLevel = 'supported' | 'partial' | 'unsupported' | 'unverified' | 'na';

export type RuntimeMaturity = 'stable' | 'preview' | 'experimental';

export interface FeatureCell {
  feature: AnetFeatureId;
  level: SupportLevel;
  noteKey: string;
}

export interface RuntimeSupportEntry {
  id: string;
  known: boolean;
  labelKey: string | null;
  maturity: RuntimeMaturity | null;
  overall: SupportLevel;
  features: FeatureCell[];
  hostBadge: HostBadge;
}

export type HostBadge = 'ready' | 'blocked' | 'unknown' | 'undeclared' | null;

export interface RuntimeHostInput extends ReadinessInput {
  daemon_node_id?: string;
  alias?: string;
  runtimes_supported?: string[];
  runtime_readiness?: RuntimeReadinessMap | null;
  can_create_nodes?: boolean;
  create_nodes_blocked_reason?: string;
  create_capability_observed_ms_ago?: number;
  last_seen_at?: string | null;
  adopt_capable?: boolean;
}

export type RuntimeHostContext =
  | { kind: 'pending' }
  | { kind: 'unsupported' }
  | { kind: 'missing' }
  | { kind: 'unlisted' }
  | { kind: 'several' }
  | { kind: 'error' }
  | { kind: 'daemon'; daemon: RuntimeHostInput };

export type HostProbe =
  | { status: 'pending' | 'missing' | 'unlisted' | 'several' | 'error' }
  | { status: 'unsupported' }
  | {
    status: 'daemon';
    badge: HostBadge;
    readinessNote: string | null;
    version: string | null;
    createKind: DaemonCapabilityKind;
    createReasonCode: string | null;
    adoptCapable: boolean | null;
    upgrade: 'npm' | null;
  };

/** 功能表没有 Hub/daemon 的实时字段，固定走演示壳。 */
export function featureMatrixSource(): 'demo' {
  return 'demo';
}

const LABEL_KEY: Record<RuntimeSupportId, string> = {
  'claude-agent-sdk': 'runtimeSupport.runtime.claudeAgentSdk',
  'claude-code-cli': 'runtimeSupport.runtime.claudeCodeCli',
  'codex-sdk': 'runtimeSupport.runtime.codexSdk',
  'codex-app-server': 'runtimeSupport.runtime.codexAppServer',
  'grok-build-acp': 'runtimeSupport.runtime.grokAcp',
  'grok-build-cli': 'runtimeSupport.runtime.grokCli',
  'opencode-cli': 'runtimeSupport.runtime.opencodeCli',
};

const MATURITY: Record<RuntimeSupportId, RuntimeMaturity> = {
  'claude-agent-sdk': 'stable',
  'claude-code-cli': 'stable',
  'codex-sdk': 'stable',
  'codex-app-server': 'preview',
  'grok-build-acp': 'stable',
  'grok-build-cli': 'experimental',
  'opencode-cli': 'preview',
};

type CellDraft = { level: SupportLevel; noteKey: string };

const HUB_CHAT: CellDraft = { level: 'unverified', noteKey: 'runtimeSupport.note.hubChat' };
const TOKENS: CellDraft = { level: 'unverified', noteKey: 'runtimeSupport.note.tokens' };
const SKILLS: CellDraft = { level: 'unverified', noteKey: 'runtimeSupport.note.skills' };
const LONG_TASK: CellDraft = { level: 'unverified', noteKey: 'runtimeSupport.note.longTask' };
const ADOPT: CellDraft = { level: 'unverified', noteKey: 'runtimeSupport.note.adopt' };
const TUI_NA: CellDraft = { level: 'na', noteKey: 'runtimeSupport.note.tui.na' };
const TUI_OK: CellDraft = { level: 'supported', noteKey: 'runtimeSupport.note.tui.supported' };
const DAEMON_OK: CellDraft = { level: 'supported', noteKey: 'runtimeSupport.note.daemon.supported' };
const DAEMON_UNSURE: CellDraft = { level: 'unverified', noteKey: 'runtimeSupport.note.daemon.unverified' };
const PROVIDER_NA: CellDraft = { level: 'na', noteKey: 'runtimeSupport.note.provider.na' };
const PROVIDER_CODEX: CellDraft = { level: 'partial', noteKey: 'runtimeSupport.note.provider.codex' };
const STEER_NA: CellDraft = { level: 'na', noteKey: 'runtimeSupport.note.steer.na' };
const STEER_CODEX: CellDraft = { level: 'supported', noteKey: 'runtimeSupport.note.steer.codex' };

const CATALOG: Record<RuntimeSupportId, Record<AnetFeatureId, CellDraft>> = {
  'claude-agent-sdk': row({ tui_copresence: TUI_NA, daemon_lifecycle: DAEMON_OK, provider_config: PROVIDER_NA, steer: STEER_NA }),
  'claude-code-cli': row({
    tui_copresence: { level: 'na', noteKey: 'runtimeSupport.note.tui.naClaude' },
    daemon_lifecycle: DAEMON_UNSURE,
    provider_config: PROVIDER_NA,
    steer: STEER_NA,
  }),
  'codex-sdk': row({ tui_copresence: TUI_NA, daemon_lifecycle: DAEMON_OK, provider_config: PROVIDER_CODEX, steer: STEER_NA }),
  'codex-app-server': row({
    tui_copresence: TUI_OK,
    daemon_lifecycle: DAEMON_UNSURE,
    adopt: { level: 'partial', noteKey: 'runtimeSupport.note.adopt.codex' },
    provider_config: PROVIDER_CODEX,
    steer: STEER_CODEX,
  }),
  'grok-build-acp': row({ tui_copresence: TUI_NA, daemon_lifecycle: DAEMON_OK, provider_config: PROVIDER_NA, steer: STEER_NA }),
  'grok-build-cli': row({
    tui_copresence: { level: 'partial', noteKey: 'runtimeSupport.note.tui.grok' },
    daemon_lifecycle: DAEMON_UNSURE,
    provider_config: PROVIDER_NA,
    skills: { level: 'unsupported', noteKey: 'runtimeSupport.note.skills.grok' },
    steer: STEER_NA,
    long_task: { level: 'partial', noteKey: 'runtimeSupport.note.longTask.grok' },
  }),
  'opencode-cli': row({
    tui_copresence: TUI_OK,
    daemon_lifecycle: DAEMON_UNSURE,
    provider_config: { level: 'partial', noteKey: 'runtimeSupport.note.provider.opencode' },
    steer: STEER_NA,
    long_task: { level: 'unsupported', noteKey: 'runtimeSupport.note.longTask.opencode' },
  }),
};

function row(overrides: Partial<Record<AnetFeatureId, CellDraft>>): Record<AnetFeatureId, CellDraft> {
  return {
    hub_chat: HUB_CHAT,
    tui_copresence: TUI_NA,
    daemon_lifecycle: DAEMON_UNSURE,
    adopt: ADOPT,
    provider_config: PROVIDER_NA,
    skills: SKILLS,
    tokens: TOKENS,
    steer: STEER_NA,
    long_task: LONG_TASK,
    ...overrides,
  };
}

function isKnownRuntime(id: string): id is RuntimeSupportId {
  return (RUNTIME_SUPPORT_ORDER as readonly string[]).includes(id);
}

export function rollupSupport(levels: readonly SupportLevel[]): SupportLevel {
  const applicable = levels.filter(level => level !== 'na');
  if (applicable.length === 0) return 'na';
  if (applicable.every(level => level === 'supported')) return 'supported';
  if (applicable.every(level => level === 'unsupported')) return 'unsupported';
  if (applicable.every(level => level === 'unverified')) return 'unverified';
  return 'partial';
}

export function featureCells(runtimeId: string): FeatureCell[] {
  const table = isKnownRuntime(runtimeId) ? CATALOG[runtimeId] : null;
  return ANET_FEATURE_ORDER.map(feature => {
    const cell = table?.[feature] ?? { level: 'unverified' as const, noteKey: 'runtimeSupport.note.unknownFeature' };
    return { feature, level: cell.level, noteKey: cell.noteKey };
  });
}

export function featureCell(runtimeId: string, feature: AnetFeatureId): FeatureCell {
  return featureCells(runtimeId).find(cell => cell.feature === feature) ?? {
    feature,
    level: 'unverified',
    noteKey: 'runtimeSupport.note.unknownFeature',
  };
}

const ID_TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function hostOf(ctx: RuntimeHostContext): RuntimeHostInput | null {
  return ctx.kind === 'daemon' ? ctx.daemon : null;
}

/** 本机胶囊。没上报 readiness、也没声明清单时返回 null，不把旧 daemon 画成不可用。 */
export function hostBadge(host: RuntimeHostInput | null, runtimeId: string): HostBadge {
  if (!host) return null;
  const declaredList = Array.isArray(host.runtimes_supported);
  const declared = declaredList && host.runtimes_supported!.includes(runtimeId);
  if (hasReadiness(host)) {
    const view = readinessFor(host, runtimeId);
    if (view.chip === 'blocked') return 'blocked';
    if (view.chip === 'ready') return 'ready';
    if (declaredList && !declared) return 'undeclared';
    return 'unknown';
  }
  if (declaredList && !declared) return 'undeclared';
  return null;
}

function needsNpmUpgrade(host: RuntimeHostInput): boolean {
  return !hasReadiness(host) || typeof host.can_create_nodes !== 'boolean';
}

/** One host is one daemon. Zero and many are states, not a picker. */
export function hostContextFromSupervisorList(result: {
  ok: boolean;
  unconfirmed?: boolean;
  daemons?: readonly RuntimeHostInput[];
} | null): RuntimeHostContext {
  if (!result) return { kind: 'pending' };
  if (!result.ok) return result.unconfirmed ? { kind: 'unsupported' } : { kind: 'error' };
  const daemons = Array.isArray(result.daemons) ? result.daemons : [];
  if (daemons.length === 1) return { kind: 'daemon', daemon: daemons[0] };
  if (daemons.length === 0) return { kind: 'missing' };
  return { kind: 'several' };
}

export function hostProbe(ctx: RuntimeHostContext, runtimeId: string, nowMs: number): HostProbe {
  if (ctx.kind === 'unsupported') return { status: 'unsupported' };
  if (ctx.kind !== 'daemon') return { status: ctx.kind };
  const host = ctx.daemon;
  const readiness = hasReadiness(host) ? readinessFor(host, runtimeId) : null;
  const capability = describeDaemonCapability(host, nowMs);
  const reason = host.create_nodes_blocked_reason?.trim() || null;
  const readinessNote = readiness?.note && readiness.note !== UNCHECKED_LABEL ? readiness.note : null;
  return {
    status: 'daemon',
    badge: hostBadge(host, runtimeId),
    readinessNote,
    version: readiness?.version ?? null,
    createKind: capability.kind,
    createReasonCode: capability.kind === 'blocked' ? (reason || 'anet_bin_unknown') : null,
    adoptCapable: typeof host.adopt_capable === 'boolean' ? host.adopt_capable : null,
    upgrade: needsNpmUpgrade(host) ? 'npm' : null,
  };
}

function extraRuntimeIds(host: RuntimeHostInput | null): string[] {
  if (!host) return [];
  const ids: string[] = [];
  const push = (id: unknown) => {
    if (typeof id !== 'string' || !ID_TOKEN.test(id) || isKnownRuntime(id) || ids.includes(id)) return;
    if (ids.length < 8) ids.push(id);
  };
  if (Array.isArray(host.runtimes_supported)) for (const id of host.runtimes_supported) push(id);
  if (hasReadiness(host)) for (const id of Object.keys(host.runtime_readiness as RuntimeReadinessMap)) push(id);
  return ids;
}

export function runtimeSupportEntries(ctx: RuntimeHostContext): RuntimeSupportEntry[] {
  const host = hostOf(ctx);
  const ids = [...RUNTIME_SUPPORT_ORDER, ...extraRuntimeIds(host)];
  return ids.map(id => {
    const known = isKnownRuntime(id);
    const features = featureCells(id);
    return {
      id,
      known,
      labelKey: known ? LABEL_KEY[id] : null,
      maturity: known ? MATURITY[id] : null,
      overall: rollupSupport(features.map(cell => cell.level)),
      features,
      hostBadge: hostBadge(host, id),
    };
  });
}
