/** Additive response contract introduced by agent-network Hub draft PR #1209. */
export interface ActualRecipient {
  alias: string;
  toNodeId: string;
  networkId: string;
}

export interface SendConfirmation {
  actualRecipient: ActualRecipient | null;
  queued: boolean;
}

const safeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, 160) : null;
};

/**
 * Only copies the three public identity fields from an untrusted Hub response.
 * In particular, rendering the raw response could expose bearer/debug fields.
 */
export const sendConfirmationFromResponse = (value: unknown): SendConfirmation => {
  const response = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const raw = response.actual_to && typeof response.actual_to === 'object'
    ? response.actual_to as Record<string, unknown>
    : null;
  const alias = safeText(raw?.alias);
  const toNodeId = safeText(raw?.to_node_id);
  const networkId = safeText(raw?.network_id);
  return {
    actualRecipient: alias && toNodeId && networkId ? { alias, toNodeId, networkId } : null,
    queued: response.queued === true || response.session_status === 'offline',
  };
};

