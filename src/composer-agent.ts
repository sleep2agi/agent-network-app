import type { NodeConfigRead } from './api';

/** Canonical IDs stay unchanged, first occurrence/native order wins. */
export function composerAgents(config: Pick<NodeConfigRead, 'opencode_agent_config_capable' | 'agents'> | null | undefined): string[] {
  if (config?.opencode_agent_config_capable !== true || !Array.isArray(config.agents)) return [];
  return [...new Set(config.agents.filter(id => typeof id === 'string' && id.trim().length > 0))];
}

export function confirmComposerAgentSwitch({ after, updateId, requested }: {
  after: NodeConfigRead | null; updateId: string | undefined; requested: string;
}): { confirmed: boolean; reason: string } {
  if (!updateId || after?.last_update?.update_id !== updateId) return { confirmed: false, reason: 'agent_ack_missing' };
  if (after.last_update.status !== 'applied') return { confirmed: false, reason: after.last_update.error || after.last_update.status || 'agent_ack_missing' };
  if (after.agent !== requested) return { confirmed: false, reason: 'agent_readback_mismatch' };
  return { confirmed: true, reason: '' };
}
