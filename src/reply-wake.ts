// Reply push for the open conversation: re-read the chat the moment the hub says an agent
// replied, instead of waiting for the next 5 s poll (0–5 s, ~2.5 s on average, before the reply
// even starts to download).
//
// Source: the hub's network observer stream `/events/network/:id` (#461), which already emits
// `{ type: 'new_reply', task_id, message_id, from, to, status }` for every send_reply — ids and
// routing only, no reply text. So no hub change: the event only says "re-read now"; the content
// still comes from the same /api/tasks read the poll uses. Restricted members get only events
// where they are one end (hub-side filter), which is exactly the replies to them.
//
// The 5 s poll stays as it is: the stream is a wake-up, not the source of truth. A hub without
// the stream, a dropped connection or a missed event just means the poll picks it up as before.
//
// One stream per hub/network, shared by every subscriber (switching conversations does not
// reconnect); closed when the last subscriber leaves.

import type { HubConfig } from './api';
import type { LogEvent } from './logs-buffer';
import { openNetworkEventStream } from './logs-sse';

export type HubTrafficEvent = { type?: unknown; from?: unknown; to?: unknown; task_id?: unknown };

/** Does this observer event mean the conversation with `alias` has something new to read?
 *  A reply from that agent, or a reply to one of the tasks this conversation shows (covers a
 *  reply sent under another session name, e.g. a renamed or chained replier). */
export function replyWakesConversation(event: HubTrafficEvent, alias: string, isShownTask?: (taskId: string) => boolean): boolean {
  if (event.type !== 'new_reply') return false;
  if (typeof event.from === 'string' && event.from === alias) return true;
  return typeof event.task_id === 'string' && !!event.task_id && !!isShownTask?.(event.task_id);
}

type Listener = (event: LogEvent) => void;
type Opener = typeof openNetworkEventStream;

const streams = new Map<string, { listeners: Set<Listener>; close: () => void }>();

const streamKey = (cfg: HubConfig, netId: string) => `${cfg.serverUrl}\u0000${cfg.token}\u0000${netId}`;

/** Subscribe to the network's traffic events. No network id → no stream (returns a no-op). */
export function subscribeHubTraffic(cfg: HubConfig, listener: Listener, open: Opener = openNetworkEventStream): () => void {
  const netId = cfg.networkId?.trim();
  if (!netId) return () => {};
  const key = streamKey(cfg, netId);
  let entry = streams.get(key);
  if (!entry) {
    const listeners = new Set<Listener>();
    const close = open(cfg, netId, {
      onEvent: (event) => { for (const l of [...listeners]) { try { l(event); } catch { /* one bad listener never stops the others */ } } },
      onState: () => {},
    });
    entry = { listeners, close };
    streams.set(key, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && streams.get(key) === current) {
      streams.delete(key);
      current.close();
    }
  };
}

/** Test-only: how many shared streams are open. */
export const __openStreamCount = () => streams.size;

/**
 * Call `wake` when `alias` replies. Bursts (several replies / chained replies in one moment)
 * collapse into one read after `coalesceMs`.
 */
export function onConversationReply(
  cfg: HubConfig,
  alias: string,
  wake: () => void,
  opts: { coalesceMs?: number; open?: Opener; isShownTask?: (taskId: string) => boolean } = {},
): () => void {
  const coalesceMs = opts.coalesceMs ?? 50;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = subscribeHubTraffic(cfg, (event) => {
    if (!replyWakesConversation(event as HubTrafficEvent, alias, opts.isShownTask) || timer) return;
    timer = setTimeout(() => { timer = null; wake(); }, coalesceMs);
  }, opts.open);
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}
