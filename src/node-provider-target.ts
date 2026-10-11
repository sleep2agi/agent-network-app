import type { HubNode } from './api';
/** An actual Hub binding, never a guess based on hostname or node-id prefix. */
export function nodeProviderDaemon(node: HubNode): string | null {
  if (node.lifecycle_daemon_node_id) return node.lifecycle_daemon_node_id;
  if (node.adoption?.status === 'active') return node.adoption.daemon_node_id;
  return null;
}
export function daemonProviderNodeRuntime(runtime: string | null | undefined) {
  return runtime === 'codex-app-server' || runtime === 'codex-tui';
}
