import type { HubNode, Session } from './api';

export interface NodeInfoFact {
  label: string;
  value?: string | null;
}

/** Build the safe, read-only node facts shown from a chat header.
 * Deliberately allowlists public fields: tokens, config contents and arbitrary
 * session keys can never become rows by accident. */
export function nodeInfoFacts(session: Session, node: HubNode | null, serverUrl: string): NodeInfoFact[] {
  return [
    { label: '节点名称', value: node?.node_name ?? session.alias },
    { label: '节点 ID', value: node?.node_id ?? session.node_id },
    { label: '服务器', value: node?.server ?? session.server ?? serverUrl },
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
