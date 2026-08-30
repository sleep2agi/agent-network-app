/** Consume Hub `type=desktop_message` SSE payloads for a logged-in user.
 *
 *  Hub `send_desktop_message` (commhub-server preview.36+) pushes:
 *    data: {"type":"desktop_message","message_id","kind","from","title","message","severity","created_at",
 *           "network_id","user_id","scope":"user"}
 *  onto GET /events/users/me (utok_, keyed by authenticated user_id).
 *
 *  This module is the *only* place that decides "present to the user".
 *  Removing `isDesktopMessageType` (the consume gate) must turn the
 *  corresponding tests red — that is the two-way witness for #160.
 *
 *  Fail toward unknown / not-presented, never toward "already seen":
 *  we do not ack, we do not count unread, we do not treat connected
 *  frames or other types as a delivered desktop message.
 */

export type DesktopMessageSeverity = 'info' | 'success' | 'warning' | 'error';

export type DesktopMessageNotice = {
  messageId: string;
  title: string | null;
  message: string;
  severity: DesktopMessageSeverity;
  from: string | null;
  kind: string;
  createdAt: string | null;
};

export type ConsumeContext = {
  networkId?: string;
  userId?: string;
};

export type ConsumeResult =
  | { status: 'present'; notice: DesktopMessageNotice }
  | { status: 'ignore' }
  | { status: 'unknown' };

const SEVERITIES = new Set<DesktopMessageSeverity>(['info', 'success', 'warning', 'error']);

/** The consume gate. Deleting / forcing this false is the two-way mutation. */
export function isDesktopMessageType(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'desktop_message';
}

const stripControls = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, '');

const redactSecrets = (value: string): string =>
  value.replace(/\b(?:atok|utok|ntok)_[A-Za-z0-9._-]+\b/gi, '[redacted]');

const displayText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = redactSecrets(stripControls(value)).trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
};

export function consumeDesktopMessageEvent(raw: unknown, ctx: ConsumeContext = {}): ConsumeResult {
  if (raw == null || typeof raw !== 'object') return { status: 'unknown' };
  const event = raw as Record<string, unknown>;

  // 🔴 consume gate — two-way witness target
  if (!isDesktopMessageType(event)) {
    return typeof event.type === 'string' ? { status: 'ignore' } : { status: 'unknown' };
  }

  if (typeof event.scope === 'string' && event.scope !== 'user') {
    return { status: 'unknown' };
  }
  if (typeof event.network_id === 'string' && ctx.networkId && event.network_id !== ctx.networkId) {
    return { status: 'unknown' };
  }
  if (typeof event.user_id === 'string' && ctx.userId && event.user_id !== ctx.userId) {
    return { status: 'unknown' };
  }

  const messageId = displayText(event.message_id, 200);
  const message = displayText(event.message, 10000);
  if (!messageId || !message) return { status: 'unknown' };

  const severity: DesktopMessageSeverity =
    typeof event.severity === 'string' && SEVERITIES.has(event.severity as DesktopMessageSeverity)
      ? (event.severity as DesktopMessageSeverity)
      : 'info';

  return {
    status: 'present',
    notice: {
      messageId,
      title: displayText(event.title, 200),
      message,
      severity,
      from: displayText(event.from, 200),
      kind: displayText(event.kind, 80) ?? 'agent_message',
      createdAt: typeof event.created_at === 'string' ? event.created_at : null,
    },
  };
}

/** Split SSE buffer into complete `data:` JSON payloads. Keepalives (`:`) discarded. */
export function takeSseJsonPayloads(buffer: string): { payloads: unknown[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const payloads: unknown[] = [];
  for (const frame of parts) {
    const dataLines: string[] = [];
    for (const line of frame.replace(/\r\n/g, '\n').split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s/, ''));
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    try {
      payloads.push(JSON.parse(payload));
    } catch {
      payloads.push({ type: 'unknown', _raw: payload });
    }
  }
  return { payloads, rest };
}
