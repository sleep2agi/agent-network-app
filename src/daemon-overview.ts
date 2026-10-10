// Daemon 设置 → 全览。探测一台 host_supervisor 的运行环境：资源、系统、工具链、每个 Agent runtime。
//
// 一台主机只有一台 Daemon。资源就是这台主机的遥测，不按「同一台机器上的多台 Daemon」拆开，
// 也不做选择、列表或切换。同名 Daemon 对不上时只说明读不到，不提供挑选流程。
//
// 真实数据只来自已经存在的接口：
//   GET /api/status 全量投影的 host 遥测（host-levels.ts，与服务器页同一套水位）
//   GET /api/host-supervisors 的 runtime_readiness / runtimes_supported / host_telemetry / 创建能力
//   桌面端本机 scanLocalDaemon（只在用户点「探测」且这台就是本机 daemon 时写入工具链）
// 没有这些上报时，整页用一份演示探测，并标「演示数据 · 后端开发中」。
// 缺 CLI / 未登录才给出安装或修复命令；没上报 ≠ 没安装。
// 纯逻辑，不 import react-native。

import type { HostSupervisorDaemon, Session } from './api';
import { describeDaemonCapability } from './daemon-capability';
import { cpuMeter, fmtGb, heartbeatMs, hostLevels, sizeMeter, telemetryOf, type HostTelemetry, type LevelTone } from './host-levels';
import { daemonChecklist, installBlocker, type LocalDaemonScan } from './local-daemon';
import { hasReadiness, readinessFor, type ReadinessState, type RuntimeReadinessEntry } from './runtime-readiness';

export const ANET_INSTALL_DOCS = 'https://www.anet.sh/en/guide/install';
export const ANET_RUNTIME_DOCS = 'https://www.anet.sh/en/guide/runtimes';

export type ResourceKey = 'cpu' | 'ram' | 'disk' | 'network';
export type ToolKey = 'node' | 'npm' | 'anet' | 'agentNode';
export type OverviewOrigin = 'reported' | 'demo' | 'unreported';
export type GapPrimary = 'install-local' | 'copy-install' | 'copy-fix' | 'docs';
export type ListingKind = 'loading' | 'listed' | 'missing' | 'ambiguous' | 'unsupported' | 'error';

export interface ResourceCard {
  key: ResourceKey;
  source: OverviewOrigin;
  /** null = 没有使用率（地址、只报了总量、或未上报）。 */
  pct: number | null;
  tone: LevelTone;
  /** 大字：百分比，或「—」。网络卡用 address，不用这个当主数字。 */
  value: string;
  stale: boolean;
  load: string | null;
  cores: number | null;
  usedGb: string | null;
  totalGb: string | null;
  address: string | null;
}

export interface OsFact {
  key: 'hostname' | 'address' | 'user' | 'os';
  source: OverviewOrigin;
  value: string | null;
}

export interface ToolRow {
  key: ToolKey;
  labelKey: string;
  source: 'local-scan' | 'session' | 'demo' | 'unreported';
  state: 'ok' | 'missing' | 'bad' | 'unreported';
  version: string | null;
  path: string | null;
}

export interface RuntimeRow {
  id: string;
  labelKey: string;
  source: 'readiness' | 'declared' | 'catalog' | 'demo';
  installed: 'yes' | 'no' | 'unknown';
  version: string | null;
  state: ReadinessState | 'unreported';
  /** Hub / daemon 原文。没有就不编。 */
  reason: string | null;
  noteKey: string | null;
}

export interface OverviewGap {
  id: string;
  labelKey: string;
  stateKey: string;
  reason: string | null;
  noteKey: string | null;
  primary: GapPrimary;
  command: string | null;
  docsUrl: string;
}

export interface DaemonOverview {
  pending: boolean;
  demo: boolean;
  notListed: boolean;
  ambiguous: boolean;
  hubUnsupported: boolean;
  scanMismatch: boolean;
  resources: ResourceCard[];
  os: OsFact[];
  tools: ToolRow[];
  runtimes: RuntimeRow[];
  gaps: OverviewGap[];
  /** 本机扫描对上了这台 daemon，且有缺的工具、安装器没有拦。 */
  localInstall: boolean;
  /** installBlocker 的原文；有则不能点安装。 */
  installBlocked: string | null;
  capability: 'ready' | 'blocked' | 'unknown' | 'absent';
  readinessReported: boolean;
}

export interface DaemonOverviewInput {
  nowMs: number;
  hostsLoaded: boolean;
  sessions: readonly Session[] | null;
  alias: string;
  nodeId?: string | null;
  nodeHostname?: string | null;
  supervisor: HostSupervisorDaemon | null;
  listing: ListingKind;
  daemonVersion: string | null;
  localScan: LocalDaemonScan | null;
  /** 用户这次点了探测并且跑了本机扫描（无论是否对上这台 daemon）。 */
  scanned: boolean;
}

interface RuntimeGuide {
  labelKey: string;
  install: string | null;
  login: string | null;
  docsUrl: string;
}

export const RUNTIME_GUIDE: Record<string, RuntimeGuide> = {
  'claude-agent-sdk': { labelKey: 'daemon.overview.runtime.claude-agent-sdk', install: 'npm install -g @sleep2agi/agent-node', login: null, docsUrl: ANET_RUNTIME_DOCS },
  'claude-code-cli': { labelKey: 'daemon.overview.runtime.claude-code-cli', install: 'npm install -g @anthropic-ai/claude-code', login: 'claude auth login', docsUrl: ANET_RUNTIME_DOCS },
  'codex-sdk': { labelKey: 'daemon.overview.runtime.codex-sdk', install: 'npm install -g @openai/codex', login: 'codex login', docsUrl: ANET_RUNTIME_DOCS },
  'codex-app-server': { labelKey: 'daemon.overview.runtime.codex-app-server', install: 'npm install -g @openai/codex', login: 'codex login', docsUrl: ANET_RUNTIME_DOCS },
  'grok-build-acp': { labelKey: 'daemon.overview.runtime.grok-build-acp', install: null, login: 'grok login', docsUrl: ANET_RUNTIME_DOCS },
  'grok-build-cli': { labelKey: 'daemon.overview.runtime.grok-build-cli', install: null, login: 'grok login', docsUrl: ANET_RUNTIME_DOCS },
  'opencode-cli': { labelKey: 'daemon.overview.runtime.opencode-cli', install: 'npm install -g opencode-ai', login: 'anet opencode auth-login', docsUrl: ANET_RUNTIME_DOCS },
};

const RUNTIME_ORDER = Object.keys(RUNTIME_GUIDE);

const TOOL_LABEL: Record<ToolKey, string> = {
  node: 'daemon.overview.tool.node',
  npm: 'daemon.overview.tool.npm',
  anet: 'daemon.overview.tool.anet',
  agentNode: 'daemon.overview.tool.agentNode',
};

const TOOL_INSTALL: Record<ToolKey, string | null> = {
  node: null,
  npm: null,
  anet: 'npm install -g @sleep2agi/agent-network',
  agentNode: 'npm install -g @sleep2agi/agent-node',
};

const STATE_KEY: Record<RuntimeRow['state'], string> = {
  ready: 'daemon.overview.state.ready',
  missing_cli: 'daemon.overview.state.missing_cli',
  not_logged_in: 'daemon.overview.state.not_logged_in',
  no_network: 'daemon.overview.state.no_network',
  unknown: 'daemon.overview.state.unknown',
  unreported: 'daemon.overview.state.unreported',
};

const EMPTY: DaemonOverview = {
  pending: true,
  demo: false,
  notListed: false,
  ambiguous: false,
  hubUnsupported: false,
  scanMismatch: false,
  resources: [],
  os: [],
  tools: [],
  runtimes: [],
  gaps: [],
  localInstall: false,
  installBlocked: null,
  capability: 'absent',
  readinessReported: false,
};

export function daemonHostname(input: Pick<DaemonOverviewInput, 'supervisor' | 'nodeHostname' | 'sessions' | 'alias'>): string | null {
  const fromSupervisor = input.supervisor?.hostname?.trim();
  if (fromSupervisor) return fromSupervisor;
  const fromNode = input.nodeHostname?.trim();
  if (fromNode) return fromNode;
  const session = input.sessions?.find(row => row.alias === input.alias);
  const fromSession = session?.hostname?.trim();
  return fromSession || null;
}

/** 两边都有 node id 时只认 id。没有 id 才退回别名，避免同名远程机被当成本机。 */
export function localScanMatches(scan: LocalDaemonScan | null, target: { nodeId?: string | null; alias: string }): boolean {
  if (!scan) return false;
  if (target.nodeId && scan.nodeId) return scan.nodeId === target.nodeId;
  if (target.nodeId && !scan.nodeId) return false;
  return !!scan.daemonName && scan.daemonName === target.alias;
}

export function parseDaemonOverviewFixture(search: string): { theme: 'dark' | 'light'; mode: 'demo' | 'reported' } | null {
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  if (q.get('fixture') !== 'daemon-overview') return null;
  return { theme: q.get('theme') === 'light' ? 'light' : 'dark', mode: q.get('mode') === 'reported' ? 'reported' : 'demo' };
}

function blankResource(key: ResourceKey, source: OverviewOrigin = 'unreported'): ResourceCard {
  return { key, source, pct: null, tone: 'none', value: '—', stale: false, load: null, cores: null, usedGb: null, totalGb: null, address: null };
}

function meterResource(key: ResourceKey, meter: { pct: number | null; tone: LevelTone; value: string }, stale: boolean, extra: Partial<ResourceCard>, source: OverviewOrigin): ResourceCard {
  return { ...blankResource(key, source), pct: meter.pct, tone: stale ? 'none' : meter.tone, value: meter.value, stale, ...extra, source };
}

function resourcesFromTelemetry(t: HostTelemetry, stale: boolean, address: string | null): ResourceCard[] {
  const cpu = cpuMeter(t);
  const ram = sizeMeter(t.mem_used_gb, t.mem_total_gb);
  const disk = sizeMeter(t.disk_used_gb, t.disk_total_gb);
  const load = t.cpu_load_1min == null ? null : String(Math.round(t.cpu_load_1min * 100) / 100);
  return [
    meterResource('cpu', cpu, stale, { load, cores: t.cpu_cores }, 'reported'),
    meterResource('ram', ram, stale, { usedGb: t.mem_used_gb == null ? null : fmtGb(t.mem_used_gb), totalGb: t.mem_total_gb == null ? null : fmtGb(t.mem_total_gb) }, 'reported'),
    meterResource('disk', disk, stale, { usedGb: t.disk_used_gb == null ? null : fmtGb(t.disk_used_gb), totalGb: t.disk_total_gb == null ? null : fmtGb(t.disk_total_gb) }, 'reported'),
    { ...blankResource('network', address ? 'reported' : 'unreported'), address, value: address ?? '—' },
  ];
}

function newestTelemetry(sessions: readonly Session[], hostname: string): HostTelemetry | null {
  const key = hostname.trim().toLowerCase();
  let best: HostTelemetry | null = null;
  let bestMs = -1;
  for (const row of sessions) {
    const telemetry = telemetryOf(row);
    if (!telemetry || telemetry.hostname.toLowerCase() !== key) continue;
    const stamp = heartbeatMs(row.updated_at);
    if (stamp >= bestMs) { best = telemetry; bestMs = stamp; }
  }
  return best;
}

function partialResources(supervisor: HostSupervisorDaemon | null): ResourceCard[] {
  const tel = supervisor?.host_telemetry;
  const cores = typeof tel?.cpu_cores === 'number' ? tel.cpu_cores : null;
  const mem = typeof tel?.mem_gb === 'number' ? tel.mem_gb : null;
  const address = tel?.ip_internal?.trim() || null;
  const cpu = blankResource('cpu', cores != null ? 'reported' : 'unreported');
  if (cores != null) cpu.cores = cores;
  const ram = blankResource('ram', mem != null ? 'reported' : 'unreported');
  if (mem != null) ram.totalGb = fmtGb(mem);
  const disk = blankResource('disk');
  const network = { ...blankResource('network', address ? 'reported' : 'unreported'), address, value: address ?? '—' };
  return [cpu, ram, disk, network];
}

function osFacts(hostname: string | null, address: string | null, user: string | null, source: OverviewOrigin): OsFact[] {
  const fact = (key: OsFact['key'], value: string | null): OsFact => ({ key, source: value ? source : 'unreported', value });
  return [fact('hostname', hostname), fact('address', address), fact('user', user), fact('os', null)];
}

function userOnHost(sessions: readonly Session[] | null, hostname: string | null): string | null {
  if (!sessions || !hostname) return null;
  const key = hostname.trim().toLowerCase();
  let newest: Session | null = null;
  let bestMs = -1;
  for (const row of sessions) {
    if ((row.hostname ?? '').trim().toLowerCase() !== key) continue;
    const stamp = heartbeatMs(row.updated_at);
    if (stamp >= bestMs) { newest = row; bestMs = stamp; }
  }
  if (!newest) return null;
  const name = newest.os_user?.trim() || newest.system_user?.trim() || '';
  return name || null;
}

function tool(key: ToolKey, state: ToolRow['state'], source: ToolRow['source'], version: string | null, path: string | null): ToolRow {
  return { key, labelKey: TOOL_LABEL[key], source, state, version, path };
}

function toolsFromScan(scan: LocalDaemonScan): ToolRow[] {
  const by = Object.fromEntries(daemonChecklist(scan).map(row => [row.key, row]));
  const version = (info: { version?: string | null; path: string } | null | undefined) => info?.version?.replace(/^v/, '') ?? null;
  const path = (info: { path: string } | null | undefined) => info?.path ?? null;
  return [
    tool('node', by.node?.state ?? 'unreported', 'local-scan', version(scan.node ?? scan.privateNode), path(scan.node ?? scan.privateNode)),
    tool('npm', by.npm?.state ?? 'unreported', 'local-scan', version(scan.npm), path(scan.npm)),
    tool('anet', by.anet?.state ?? 'unreported', 'local-scan', version(scan.anet), path(scan.anet)),
    tool('agentNode', by.agentNode?.state ?? 'unreported', 'local-scan', version(scan.agentNode), path(scan.agentNode)),
  ];
}

function toolsReported(daemonVersion: string | null): ToolRow[] {
  return [
    tool('node', 'unreported', 'unreported', null, null),
    tool('npm', 'unreported', 'unreported', null, null),
    tool('anet', 'unreported', 'unreported', null, null),
    daemonVersion
      ? tool('agentNode', 'ok', 'session', daemonVersion, null)
      : tool('agentNode', 'unreported', 'unreported', null, null),
  ];
}

function hubReason(entry: RuntimeReadinessEntry | undefined): string | null {
  return typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : null;
}

function installedOf(entry: RuntimeReadinessEntry | undefined, state: ReadinessState): RuntimeRow['installed'] {
  if (!entry) return 'unknown';
  if (entry.cli === 'missing' || state === 'missing_cli') return 'no';
  if (entry.cli === 'found' || entry.cli === 'bundled') return 'yes';
  if (state === 'ready' || state === 'not_logged_in' || state === 'no_network') return 'yes';
  return 'unknown';
}

function runtimeIds(supervisor: HostSupervisorDaemon): string[] {
  const ids: string[] = [];
  const supported = Array.isArray(supervisor.runtimes_supported) ? supervisor.runtimes_supported : [];
  for (const id of [...RUNTIME_ORDER, ...supported]) if (typeof id === 'string' && supported.includes(id) && !ids.includes(id)) ids.push(id);
  if (hasReadiness(supervisor)) {
    for (const id of Object.keys(supervisor.runtime_readiness ?? {})) if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 && hasReadiness(supervisor)) {
    for (const id of RUNTIME_ORDER) ids.push(id);
    for (const id of Object.keys(supervisor.runtime_readiness ?? {})) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function runtimeRow(id: string, source: RuntimeRow['source'], state: RuntimeRow['state'], installed: RuntimeRow['installed'], version: string | null, reason: string | null, noteKey: string | null): RuntimeRow {
  return { id, labelKey: RUNTIME_GUIDE[id]?.labelKey ?? '', source, installed, version, state, reason, noteKey };
}

function rowsFromSupervisor(supervisor: HostSupervisorDaemon): RuntimeRow[] {
  if (hasReadiness(supervisor)) {
    return runtimeIds(supervisor).map(id => {
      const view = readinessFor(supervisor, id);
      const raw = supervisor.runtime_readiness?.[id];
      const state = view.state ?? 'unknown';
      const reason = hubReason(raw);
      return runtimeRow(id, 'readiness', state, installedOf(raw, state), view.version, reason, reason ? null : state === 'unknown' ? 'daemon.overview.catalogUnchecked' : null);
    });
  }
  const supported = Array.isArray(supervisor.runtimes_supported) ? supervisor.runtimes_supported.filter(id => typeof id === 'string') : [];
  if (supported.length) {
    return supported.map(id => runtimeRow(id, 'declared', 'unknown', 'unknown', null, null, 'daemon.overview.declared'));
  }
  return RUNTIME_ORDER.map(id => runtimeRow(id, 'catalog', 'unreported', 'unknown', null, null, 'daemon.overview.catalogUnchecked'));
}

const STATE_RANK: Record<RuntimeRow['state'], number> = { missing_cli: 0, not_logged_in: 1, no_network: 2, unknown: 3, unreported: 4, ready: 5 };

function sortRuntimes(rows: RuntimeRow[]): RuntimeRow[] {
  return [...rows].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || RUNTIME_ORDER.indexOf(a.id) - RUNTIME_ORDER.indexOf(b.id));
}

function gapForRuntime(row: RuntimeRow): OverviewGap | null {
  if (row.state !== 'missing_cli' && row.state !== 'not_logged_in' && row.state !== 'no_network') return null;
  const guide = RUNTIME_GUIDE[row.id];
  const docsUrl = guide?.docsUrl ?? ANET_RUNTIME_DOCS;
  if (row.state === 'missing_cli') {
    return { id: row.id, labelKey: row.labelKey || row.id, stateKey: STATE_KEY[row.state], reason: row.reason, noteKey: guide?.install ? row.noteKey : 'daemon.overview.seeDocs', primary: guide?.install ? 'copy-install' : 'docs', command: guide?.install ?? null, docsUrl };
  }
  if (row.state === 'not_logged_in') {
    return { id: row.id, labelKey: row.labelKey || row.id, stateKey: STATE_KEY[row.state], reason: row.reason, noteKey: guide?.login ? null : 'daemon.overview.seeDocs', primary: guide?.login ? 'copy-fix' : 'docs', command: guide?.login ?? null, docsUrl };
  }
  return { id: row.id, labelKey: row.labelKey || row.id, stateKey: STATE_KEY[row.state], reason: row.reason, noteKey: 'daemon.overview.seeDocs', primary: 'docs', command: null, docsUrl };
}

function gapForTool(row: ToolRow): OverviewGap | null {
  if (row.state !== 'missing' && row.state !== 'bad') return null;
  const command = TOOL_INSTALL[row.key];
  return {
    id: `tool:${row.key}`,
    labelKey: row.labelKey,
    stateKey: row.state === 'bad' ? 'daemon.overview.state.bad' : 'daemon.overview.state.missing_cli',
    reason: null,
    noteKey: command ? null : 'daemon.overview.seeDocs',
    primary: command ? 'copy-install' : 'docs',
    command,
    docsUrl: ANET_INSTALL_DOCS,
  };
}

function demoRuntimes(): RuntimeRow[] {
  return sortRuntimes([
    runtimeRow('claude-agent-sdk', 'demo', 'ready', 'yes', '2.5.0', null, null),
    runtimeRow('claude-code-cli', 'demo', 'ready', 'yes', '1.0.90', null, null),
    runtimeRow('codex-sdk', 'demo', 'not_logged_in', 'yes', '0.98.0', null, null),
    runtimeRow('codex-app-server', 'demo', 'ready', 'yes', '0.98.0', null, null),
    runtimeRow('grok-build-acp', 'demo', 'missing_cli', 'no', null, null, 'daemon.overview.seeDocs'),
    runtimeRow('grok-build-cli', 'demo', 'unknown', 'unknown', null, null, 'daemon.overview.catalogUnchecked'),
    runtimeRow('opencode-cli', 'demo', 'missing_cli', 'no', null, null, null),
  ]);
}

function demoBundle(): Pick<DaemonOverview, 'resources' | 'os' | 'tools' | 'runtimes'> {
  const cpu = cpuMeter({ cpu_load_1min: 1.6, cpu_cores: 8 });
  const ram = sizeMeter(6.4, 16);
  const disk = sizeMeter(48, 200);
  const address = '192.0.2.24';
  return {
    resources: [
      meterResource('cpu', cpu, false, { load: '1.6', cores: 8 }, 'demo'),
      meterResource('ram', ram, false, { usedGb: '6.4', totalGb: '16' }, 'demo'),
      meterResource('disk', disk, false, { usedGb: '48', totalGb: '200' }, 'demo'),
      { ...blankResource('network', 'demo'), address, value: address },
    ],
    os: [
      { key: 'hostname', source: 'demo', value: 'vm-demo' },
      { key: 'address', source: 'demo', value: address },
      { key: 'user', source: 'demo', value: 'anet' },
      { key: 'os', source: 'demo', value: 'Linux' },
    ],
    tools: [
      tool('node', 'ok', 'demo', '22.14.0', null),
      tool('npm', 'ok', 'demo', '10.9.2', null),
      tool('anet', 'missing', 'demo', null, null),
      tool('agentNode', 'ok', 'demo', '2.5.0', null),
    ],
    runtimes: demoRuntimes(),
  };
}

function hasPartialTelemetry(supervisor: HostSupervisorDaemon | null): boolean {
  const tel = supervisor?.host_telemetry;
  return tel?.cpu_cores != null || tel?.mem_gb != null || !!tel?.ip_internal?.trim();
}

export function buildDaemonOverview(input: DaemonOverviewInput): DaemonOverview {
  const notListed = input.listing === 'missing';
  const ambiguous = input.listing === 'ambiguous';
  const hubUnsupported = input.listing === 'unsupported';
  if (!input.hostsLoaded || input.listing === 'loading') {
    return { ...EMPTY, pending: true, notListed, ambiguous, hubUnsupported };
  }

  const hostname = daemonHostname(input);
  const localMatch = localScanMatches(input.localScan, { nodeId: input.nodeId ?? input.supervisor?.daemon_node_id, alias: input.alias });
  const scanMismatch = input.scanned && !!input.localScan && !localMatch;
  const levels = input.sessions ? hostLevels(input.sessions, input.nowMs) : null;
  const level = hostname && levels ? levels.hosts.find(row => row.hostname.toLowerCase() === hostname.toLowerCase()) ?? null : null;
  const telemetry = hostname && input.sessions ? newestTelemetry(input.sessions, hostname) : null;
  const address = level?.ip || telemetry?.ip || input.supervisor?.host_telemetry?.ip_internal?.trim() || null;
  const resourceReported = !!level || hasPartialTelemetry(input.supervisor);
  const readinessReported = !!input.supervisor && hasReadiness(input.supervisor);
  const supportedReported = (input.supervisor?.runtimes_supported?.length ?? 0) > 0;
  const versionReported = !!input.daemonVersion;
  const capabilityKnown = typeof input.supervisor?.can_create_nodes === 'boolean';
  const reported = resourceReported || readinessReported || supportedReported || versionReported || localMatch || capabilityKnown;

  const capability = !input.supervisor ? 'absent' : describeDaemonCapability(input.supervisor, input.nowMs).kind;

  let resources: ResourceCard[];
  let os: OsFact[];
  let tools: ToolRow[];
  let runtimes: RuntimeRow[];
  if (!reported) {
    const demo = demoBundle();
    resources = demo.resources;
    os = demo.os;
    tools = demo.tools;
    runtimes = demo.runtimes;
  } else {
    resources = telemetry && level ? resourcesFromTelemetry(telemetry, level.stale, address) : partialResources(input.supervisor);
    if (!level && address) {
      resources = resources.map(card => card.key === 'network' ? { ...card, source: 'reported', address, value: address } : card);
    }
    os = osFacts(hostname, address, userOnHost(input.sessions, hostname), 'reported');
    tools = localMatch && input.localScan ? toolsFromScan(input.localScan) : toolsReported(input.daemonVersion);
    runtimes = input.supervisor ? sortRuntimes(rowsFromSupervisor(input.supervisor)) : sortRuntimes(RUNTIME_ORDER.map(id => runtimeRow(id, 'catalog', 'unreported', 'unknown', null, null, 'daemon.overview.catalogUnchecked')));
  }

  const blocked = localMatch && input.localScan ? installBlocker(input.localScan) : null;
  const toolGaps = tools.some(row => row.state === 'missing' || row.state === 'bad');
  const localInstall = !!(localMatch && toolGaps && !blocked && reported);
  const gaps: OverviewGap[] = [];
  if (localInstall) {
    gaps.push({ id: 'toolchain', labelKey: 'daemon.overview.toolchain', stateKey: 'daemon.overview.state.missing_cli', reason: null, noteKey: null, primary: 'install-local', command: null, docsUrl: ANET_INSTALL_DOCS });
  } else if (reported) {
    for (const row of tools) {
      const gap = gapForTool(row);
      if (gap) gaps.push(gap);
    }
  } else {
    for (const row of tools) {
      const gap = gapForTool(row);
      if (gap) gaps.push(gap);
    }
  }
  for (const row of runtimes) {
    const gap = gapForRuntime(row);
    if (gap) gaps.push(gap);
  }
  if (reported && capability === 'blocked') {
    gaps.push({
      id: 'capability',
      labelKey: 'daemon.overview.gap.capability',
      stateKey: 'daemon.overview.state.blocked',
      reason: input.supervisor?.create_nodes_blocked_reason ?? null,
      noteKey: null,
      primary: 'copy-fix',
      command: 'anet doctor',
      docsUrl: ANET_INSTALL_DOCS,
    });
  }

  return {
    pending: false,
    demo: !reported,
    notListed,
    ambiguous,
    hubUnsupported,
    scanMismatch,
    resources,
    os,
    tools,
    runtimes,
    gaps,
    localInstall,
    installBlocked: blocked,
    capability,
    readinessReported: reported && readinessReported,
  };
}

const FIXTURE_NOW = Date.parse('2026-10-10T15:00:30Z');

/** 验收夹具用的两份探测结果。reported 走真实组装，不另写一套展示数据。 */
export function fixtureOverview(mode: 'demo' | 'reported'): DaemonOverview {
  if (mode === 'demo') {
    return buildDaemonOverview({
      nowMs: FIXTURE_NOW,
      hostsLoaded: true,
      sessions: [],
      alias: 'daemon-a',
      nodeId: 'node_d1',
      supervisor: { daemon_node_id: 'node_d1', alias: 'daemon-a', hostname: 'vm-demo', online: true },
      listing: 'listed',
      daemonVersion: null,
      localScan: null,
      scanned: false,
    });
  }
  const updated_at = '2026-10-10 15:00:00';
  return buildDaemonOverview({
    nowMs: FIXTURE_NOW,
    hostsLoaded: true,
    sessions: [{
      alias: 'daemon-a',
      status: 'idle',
      hostname: 'box-a',
      updated_at,
      ip: '192.0.2.10',
      os_user: 'anet',
      version: '2.5.0',
      cpu_load_1min: 3.2,
      cpu_cores: 8,
      mem_total_gb: 16,
      mem_used_gb: 9,
      disk_total_gb: 200,
      disk_used_gb: 40,
    } as Session],
    alias: 'daemon-a',
    nodeId: 'node_d1',
    supervisor: {
      daemon_node_id: 'node_d1',
      alias: 'daemon-a',
      hostname: 'box-a',
      online: true,
      can_create_nodes: true,
      runtimes_supported: RUNTIME_ORDER,
      runtime_readiness: {
        'claude-agent-sdk': { ok: true, state: 'ready', version: '2.5.0', cli: 'bundled' },
        'claude-code-cli': { ok: true, state: 'ready', version: '1.0.90', cli: 'found' },
        'codex-sdk': { ok: false, state: 'not_logged_in', version: '0.98.0', cli: 'found', reason: 'codex login has not been completed on this machine' },
        'codex-app-server': { ok: true, state: 'ready', version: '0.98.0', cli: 'found' },
        'grok-build-acp': { ok: true, state: 'ready', version: '0.1.0', cli: 'found' },
        'grok-build-cli': { ok: false, state: 'unknown' },
        'opencode-cli': { ok: false, state: 'missing_cli', cli: 'missing', reason: 'opencode was not found on PATH' },
      },
    },
    listing: 'listed',
    daemonVersion: '2.5.0',
    localScan: null,
    scanned: false,
  });
}
