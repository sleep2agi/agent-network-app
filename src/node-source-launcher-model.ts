// 新建节点 → 「OpenCode V2 · 已有项目 / 已有会话 / 新会话」的来源节点挑选（纯逻辑，NodeSourceLauncher 只负责画）。
//
// admin 2026-11-12 截图：daemon-vdev 上明明有十几个 OpenCode V2 节点，面板却说「此服务器没有可用于目录读取的
// OpenCode V2 来源节点」。原因：这里写死了 runtime === 'opencode-cli'，而 Hub /api/nodes 报的是 'opencode-sdk'
// （agent-node 的 runtime 名），一个都匹配不上。改用 isOpenCodeV2Node（三个名字都认、v1 排除）。
//
// 归属仍只认 Hub 的真实绑定（nodeProviderDaemon），不按 hostname 猜；但同一台机器上没被这个 daemon
// 接管的 V2 节点会单独数出来，空态里说清楚「有 N 个，但没被接管」，而不是笼统一句「没有」。
import type { HubNode } from './api';
import { isOpenCodeV2Node } from './opencode-v2-model-list';
import { nodeProviderDaemon } from './node-provider-target';

export type SourceCandidate = {
  node: HubNode;
  /** 节点工作目录（config_path 里 `/.anet/` 之前的部分）；拿不到就是 null，不编。 */
  workdir: string | null;
  active: boolean;
};

export type SourcePick = {
  sources: SourceCandidate[];
  /** 同一台机器（hostname 与 daemon 一致）上的 OpenCode V2 节点，但没绑到这个 daemon。只用于空态说明。 */
  unboundOnHost: number;
};

export function nodeWorkdir(configPath: string | null | undefined): string | null {
  if (!configPath) return null;
  const i = configPath.replace(/\\/g, '/').indexOf('/.anet/');
  return i > 0 ? configPath.slice(0, i) : null;
}

const isActive = (n: HubNode) => (n.lifecycle_state ?? 'active') === 'active';

export function pickSourceNodes(nodes: readonly HubNode[], daemonNodeId: string): SourcePick {
  const daemon = nodes.find(n => n.node_id === daemonNodeId);
  const host = daemon?.hostname || null;
  const v2 = nodes.filter(n => n.node_id !== daemonNodeId && isOpenCodeV2Node(n)
    && n.runtime !== 'tmwork-opencode-plugin');
  const sources = v2
    .filter(n => nodeProviderDaemon(n) === daemonNodeId)
    .map(node => ({ node, workdir: nodeWorkdir(node.config_path), active: isActive(node) }))
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.node.alias || '').localeCompare(b.node.alias || '', 'zh'));
  const unboundOnHost = host ? v2.filter(n => nodeProviderDaemon(n) !== daemonNodeId && n.hostname === host).length : 0;
  return { sources, unboundOnHost };
}

export function sourceMatches(c: SourceCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${c.node.alias} ${c.node.node_id} ${c.workdir ?? ''} ${c.node.model ?? ''}`.toLowerCase().includes(q);
}

/** 行的第二行：工作目录最后一段 · 模型；没有就省略那一段。 */
export function sourceDetail(c: SourceCandidate): string {
  const dir = c.workdir ? c.workdir.split('/').filter(Boolean).pop() ?? c.workdir : null;
  return [dir, c.node.model, c.active ? null : '已停止'].filter(Boolean).join(' · ');
}
