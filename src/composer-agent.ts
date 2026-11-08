import type { NodeConfigRead } from './api';

/** Canonical IDs stay unchanged, first occurrence/native order wins.
 *
 *  Deliberately NOT gated on `opencode_agent_config_capable`: the capability
 *  only says whether this node can *switch*, while the list itself is still
 *  real information the user should see. Gating the list on the capability made
 *  the whole section disappear on every node (no node advertised it yet), i.e.
 *  the feature shipped invisible. */
export function composerAgents(config: Pick<NodeConfigRead, 'agents'> | null | undefined): string[] {
  if (!Array.isArray(config?.agents)) return [];
  return [...new Set(config.agents.filter(id => typeof id === 'string' && id.trim().length > 0))];
}

/** True only when the node explicitly advertises the hot agent switch. Old nodes
 *  omit the field; treating "absent" as "yes" would offer a control that the hub
 *  then refuses with `agent_unsupported`. */
export function composerAgentSwitchable(
  config: Pick<NodeConfigRead, 'opencode_agent_config_capable' | 'agents'> | null | undefined,
): boolean {
  return config?.opencode_agent_config_capable === true && composerAgents(config).length > 0;
}

/** The current agent, only when the node actually reported one. Never falls back
 *  to `build`, to the first list entry, or to a guess. */
export function composerAgentCurrent(
  config: Pick<NodeConfigRead, 'agent'> | null | undefined,
): string | undefined {
  return typeof config?.agent === 'string' && config.agent.trim().length > 0 ? config.agent : undefined;
}

/** Render the section when there is something true to say: a switchable list, or
 *  a reported current value (read-only). Both absent ⇒ nothing to show. */
export function composerAgentSectionVisible(config: NodeConfigRead | null | undefined): boolean {
  return composerAgentSwitchable(config) || composerAgentCurrent(config) !== undefined;
}

export function confirmComposerAgentSwitch({ after, updateId, requested }: {
  after: NodeConfigRead | null; updateId: string | undefined; requested: string;
}): { confirmed: boolean; reason: string } {
  if (!updateId || after?.last_update?.update_id !== updateId) return { confirmed: false, reason: 'agent_ack_missing' };
  if (after.last_update.status !== 'applied') return { confirmed: false, reason: after.last_update.error || after.last_update.status || 'agent_ack_missing' };
  if (after.agent !== requested) return { confirmed: false, reason: 'agent_readback_mismatch' };
  return { confirmed: true, reason: '' };
}
