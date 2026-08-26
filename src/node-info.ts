import type { HubNode, Session } from './api';

export interface NodeInfoFact {
  label: string;
  value?: string | null;
}

const TOKEN_SHAPE = /^(?:[aun]tok(?:[_\-.\s]|[A-Za-z0-9]{8})|bearer(?:\s|[_\-.])|sk[-_])\S*/i;
const SAFE_HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;
const SAFE_IP_LITERAL = /^\[[0-9A-Fa-f:]+\]$/;

export function safeServerLabel(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  if (!trimmed.includes('://')) {
    // Plain labels are deliberately ASCII-only. Unicode hostnames must arrive
    // as a parsed URL (URL normalizes them to punycode); never accept free-form
    // strings containing credentials, paths, query text, fragments or spaces.
    if (TOKEN_SHAPE.test(trimmed)) return undefined;
    const match = trimmed.match(/^(\[[0-9A-Fa-f:]+\]|[^:]+)(?::([0-9]{1,5}))?$/);
    if (!match || (!SAFE_HOSTNAME.test(match[1]) && !SAFE_IP_LITERAL.test(match[1]))) return undefined;
    const port = match[2];
    if (port && Number(port) > 65535) return undefined;
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    // origin intentionally strips userinfo, path, query, and fragment.
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function safeServerUrl(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.includes('://')) return undefined;
  return safeServerLabel(trimmed);
}

/** Build the safe, read-only node facts shown from a chat header.
 * Deliberately allowlists public fields: tokens, config contents and arbitrary
 * session keys can never become rows by accident. */
export function nodeInfoFacts(session: Session, node: HubNode | null, serverUrl: string): NodeInfoFact[] {
  return [
    { label: '节点名称', value: node?.node_name ?? session.alias },
    { label: '节点 ID', value: node?.node_id ?? session.node_id },
    { label: '服务器', value: safeServerLabel(node?.server ?? session.server) ?? safeServerUrl(serverUrl) },
    { label: 'Hostname', value: node?.hostname ?? session.hostname },
    { label: 'IP', value: session.ip },
    // Only explicit runtime-reported identities are accepted. In particular,
    // never parse `/home/alice/...` or `C:\\Users\\alice` from project_dir.
    { label: '系统用户', value: session.os_user ?? session.system_user ?? '未上报' },
    { label: '工作路径', value: session.project_dir },
    { label: '节点类型', value: node?.role ?? node?.config_snapshot?.role },
    { label: 'Runtime', value: session.runtime ?? node?.runtime ?? session.agent },
    { label: 'Agent', value: session.agent },
    { label: '模型', value: session.model ?? node?.model ?? node?.config_snapshot?.model },
    { label: '版本', value: session.version },
    { label: '状态', value: session.status },
  ];
}
