// Pure evaluation of whether a node supports Hub external-storage direct file transfer (AWS S3 / Aliyun OSS).
//
// Resolution order:
//   1. Authoritative capability flag (`session.direct_storage_capable === true`) when advertised by Hub/node.
//   2. Honest semver version threshold per runtime family (works immediately on Hub 0.9.0-preview.311+):
//        - agent-node (2.5.x+): >= 2.5.0-preview.238 full (3-tier fallback + caller-aware AWS/accelerate route);
//          2.5.0-preview.236..237 basic direct storage; < 2.5.0-preview.236 unsupported.
//        - claude-code / @sleep2agi/agent-network (2.3.x): >= 2.3.0-preview.274 full; < .274 unsupported.
//        - Missing version on agent-node / claude-code: 'unknown' (never guess).
//   3. Cross-references the active Hub storage state so the user sees both node capability and live target.
//
// Pure module — zero react-native imports; zero install commands (daemon-overview guard).

import type { HubNode, Session } from './api';
import type { HubStorageConfigState, HubStorageProvider } from './hub-storage';

export type NodeDirectStorageKind = 'supported' | 'supported_basic' | 'unsupported' | 'unknown';
export type NodeDirectStorageTone = 'ok' | 'warn' | 'muted';

export interface NodeDirectStorageStatus {
  kind: NodeDirectStorageKind;
  label: string;
  tone: NodeDirectStorageTone;
}

export interface NodeDirectStorageInput {
  session: Pick<Session, 'agent' | 'version' | 'runtime' | 'direct_storage_capable'>;
  node?: Pick<HubNode, 'runtime'> | null;
  hubStorage?: Pick<HubStorageConfigState, 'supported' | 'configured' | 'enabled' | 'provider'> | null;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  preview: number | null; // null = stable release (ranks >= any preview of same major.minor.patch)
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseNodeVersion(raw?: string | null): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = SEMVER_RE.exec(trimmed);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const pre = m[4];
  if (!pre) return { major, minor, patch, preview: null };
  const pm = /^preview\.(\d+)$/i.exec(pre);
  if (pm) return { major, minor, patch, preview: Number(pm[1]) };
  // Other prereleases (alpha/beta/rc): treat preview as -1 so they never accidentally satisfy a preview threshold.
  return { major, minor, patch, preview: -1 };
}

function compareVersion(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.preview === b.preview) return 0;
  if (a.preview === null) return 1; // stable > prerelease
  if (b.preview === null) return -1;
  return a.preview - b.preview;
}

const AGENT_NODE_BASIC_MIN: ParsedVersion = { major: 2, minor: 5, patch: 0, preview: 236 };
const AGENT_NODE_FULL_MIN: ParsedVersion = { major: 2, minor: 5, patch: 0, preview: 238 };
const CLAUDE_CHANNEL_FULL_MIN: ParsedVersion = { major: 2, minor: 3, patch: 0, preview: 274 };

function storageProviderShortName(provider?: HubStorageProvider): string {
  if (provider === 's3') return 'AWS S3';
  if (provider === 'oss') return '阿里云 OSS';
  return '外部存储';
}

function isAgentNodeFamily(agent: string, runtime: string, v: ParsedVersion | null): boolean {
  if (agent.startsWith('agent-node')) return true;
  if (v && (v.major > 2 || (v.major === 2 && v.minor >= 5))) return true;
  if (runtime && !agent.includes('claude-code') && !agent.includes('tmwork') && v && v.major === 2 && v.minor >= 5) return true;
  return false;
}

function isClaudeChannelFamily(agent: string, v: ParsedVersion | null): boolean {
  if (agent === 'claude-code') return true;
  if (v && v.major === 2 && v.minor === 3) return true;
  return false;
}

/**
 * Evaluate whether a node supports Hub external-storage direct file transfer.
 * Shown in NodeDetailScreen overview so admins can verify pilot upgrades at a glance.
 */
export function nodeDirectStorageStatus(input: NodeDirectStorageInput): NodeDirectStorageStatus {
  const { session, node, hubStorage } = input;
  const hubEnabled = !!(hubStorage?.supported && hubStorage.configured && hubStorage.enabled && hubStorage.provider !== 'modelscope');
  const providerName = storageProviderShortName(hubStorage?.provider);

  let kind: NodeDirectStorageKind = 'unknown';

  if (session.direct_storage_capable === true) {
    kind = 'supported';
  } else {
    const agent = (session.agent ?? '').trim().toLowerCase();
    const runtime = (session.runtime ?? node?.runtime ?? '').trim().toLowerCase();
    const parsed = parseNodeVersion(session.version);

    if (isAgentNodeFamily(agent, runtime, parsed)) {
      if (!parsed) {
        kind = 'unknown';
      } else if (compareVersion(parsed, AGENT_NODE_FULL_MIN) >= 0) {
        kind = 'supported';
      } else if (compareVersion(parsed, AGENT_NODE_BASIC_MIN) >= 0) {
        kind = 'supported_basic';
      } else {
        kind = 'unsupported';
      }
    } else if (isClaudeChannelFamily(agent, parsed)) {
      if (!parsed) {
        kind = 'unknown';
      } else if (compareVersion(parsed, CLAUDE_CHANNEL_FULL_MIN) >= 0) {
        kind = 'supported';
      } else {
        kind = 'unsupported';
      }
    } else if (parsed) {
      kind = 'unsupported';
    } else {
      kind = 'unknown';
    }
  }

  if (kind === 'supported') {
    return {
      kind,
      label: hubEnabled ? `已支持 · 直传 ${providerName}` : '节点已支持（网络未开启外部存储）',
      tone: hubEnabled ? 'ok' : 'muted',
    };
  }
  if (kind === 'supported_basic') {
    return {
      kind,
      label: hubEnabled ? `已支持 · 直传 ${providerName}（基础版）` : '节点已支持（基础版，网络未开启外部存储）',
      tone: hubEnabled ? 'ok' : 'muted',
    };
  }
  if (kind === 'unsupported') {
    return {
      kind,
      label: '未支持（旧版本，走 Hub 12 MB）',
      tone: 'warn',
    };
  }
  return {
    kind: 'unknown',
    label: '未确认（版本未上报）',
    tone: 'muted',
  };
}
