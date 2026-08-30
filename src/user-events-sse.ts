// XHR SSE consumer for GET /events/users/me?network_id=...
// Same transport rationale as logs-sse.ts (RN / Tauri WKWebView have no
// reliable fetch ReadableStream; EventSource is missing on RN).

import type { HubConfig } from './api';
import { RECONNECT_MIN_MS, nextBackoffMs, type ConnState } from './logs-buffer';
import { takeSseJsonPayloads } from './desktop-message-consume';

export function userEventStreamUrl(serverUrl: string, networkId: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/events/users/me?network_id=${encodeURIComponent(networkId)}`;
}

export function canOpenUserEventStream(cfg: Pick<HubConfig, 'token' | 'networkId'>): boolean {
  return !!cfg.networkId && typeof cfg.token === 'string' && cfg.token.startsWith('utok_');
}

interface OpenUserEventStreamHandlers {
  onEvent: (ev: unknown) => void;
  onState?: (s: ConnState, error?: string) => void;
}

/** Open the user-keyed Hub SSE stream. Returns a cleanup function. */
export function openUserEventStream(
  cfg: HubConfig,
  handlers: OpenUserEventStreamHandlers,
): () => void {
  if (!canOpenUserEventStream(cfg) || !cfg.networkId) {
    handlers.onState?.('disconnected', 'user_token_or_network_required');
    return () => {};
  }
  if ((globalThis as any).__TAURI_INTERNALS__) {
    return openTauriUserEventStream(cfg, cfg.networkId, handlers);
  }
  return openXhrUserEventStream(cfg, cfg.networkId, handlers);
}

type NativePayload =
  | { kind: 'state'; stream_id: string; state: ConnState; error?: string | null }
  | { kind: 'event'; stream_id: string; event: unknown };

function openTauriUserEventStream(
  cfg: HubConfig,
  netId: string,
  handlers: OpenUserEventStreamHandlers,
): () => void {
  const streamId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let stopped = false;
  let unlisten: (() => void) | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = RECONNECT_MIN_MS;
  let invokeStart: (() => Promise<void>) | undefined;

  handlers.onState?.('connecting');
  void Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
    .then(async ([core, events]) => {
      if (stopped) return;
      unlisten = await events.listen<NativePayload>('user-event-stream', ({ payload }) => {
        if (stopped || payload.stream_id !== streamId) return;
        if (payload.kind === 'event') {
          handlers.onEvent(payload.event);
          return;
        }
        handlers.onState?.(payload.state, payload.error ?? undefined);
        if (payload.state === 'connected') backoffMs = RECONNECT_MIN_MS;
        if (payload.state === 'disconnected' && !reconnectTimer) {
          const delay = backoffMs;
          backoffMs = nextBackoffMs(backoffMs);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            if (!stopped) void invokeStart?.().catch((error) => {
              handlers.onState?.('disconnected', String(error));
            });
          }, delay);
        }
      });
      if (stopped) { unlisten(); unlisten = undefined; return; }
      invokeStart = async () => {
        await core.invoke('start_user_event_stream', {
          streamId,
          serverUrl: cfg.serverUrl,
          token: cfg.token,
          networkId: netId,
        });
      };
      await invokeStart();
    })
    .catch((error) => {
      if (!stopped) handlers.onState?.('disconnected', String(error));
    });

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    unlisten?.();
    unlisten = undefined;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('stop_user_event_stream', { streamId }))
      .catch(() => undefined);
  };
}

function openXhrUserEventStream(
  cfg: HubConfig,
  netId: string,
  handlers: OpenUserEventStreamHandlers,
): () => void {
  let xhr: XMLHttpRequest | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = RECONNECT_MIN_MS;

  const connect = () => {
    if (stopped) return;
    handlers.onState?.('connecting');
    let readCursor = 0;
    let carry = '';

    xhr = new XMLHttpRequest();
    xhr.open('GET', userEventStreamUrl(cfg.serverUrl, netId), true);
    xhr.setRequestHeader('Authorization', `Bearer ${cfg.token}`);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');

    xhr.onreadystatechange = () => {
      if (!xhr) return;
      if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
        if (xhr.status === 200) {
          handlers.onState?.('connected');
          backoffMs = RECONNECT_MIN_MS;
        }
      }
    };

    xhr.onprogress = () => {
      if (!xhr || xhr.status !== 200) return;
      const full = xhr.responseText;
      const chunk = carry + full.slice(readCursor);
      readCursor = full.length;
      const taken = takeSseJsonPayloads(chunk);
      carry = taken.rest;
      for (const payload of taken.payloads) handlers.onEvent(payload);
    };

    const scheduleReconnect = (why: string) => {
      if (stopped) return;
      handlers.onState?.('disconnected', why);
      const delay = backoffMs;
      backoffMs = nextBackoffMs(backoffMs);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    xhr.onerror = () => scheduleReconnect('network error');
    xhr.onabort = () => { /* explicit close(); no reconnect */ };
    xhr.onload = () => {
      if (xhr && xhr.status !== 200) {
        scheduleReconnect(`HTTP ${xhr.status}`);
      } else {
        scheduleReconnect('server closed stream');
      }
    };

    xhr.send();
  };

  connect();

  return function close() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (xhr) { try { xhr.abort(); } catch { /* ignore */ } xhr = null; }
  };
}
