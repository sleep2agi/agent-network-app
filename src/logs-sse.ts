// XHR-based SSE consumer for /events/network/{netId}.
//
// Why XHR and not fetch+ReadableStream:
//   RN and the Tauri WKWebView shim don't reliably expose the fetch
//   Response body as a ReadableStream — some versions return `null`
//   and the whole payload arrives at once, defeating streaming. XHR
//   `onprogress` is old but rock-solid on both, and doesn't need a
//   new dependency (通信龙 07-31: 别在仓库根之外裸跑 npm install).
//
// Why not EventSource:
//   RN has no built-in EventSource; the polyfill packages add churn +
//   are yet-another-dep. This module is ~100 LoC and covers the exact
//   subset we need.
//
// Frame parsing:
//   Server emits `data: <json>\n\n`. Multi-line frames (rare here) are
//   parsed as one concatenated data payload per RFC. The `\n\n`
//   separator can split across two progress events — we buffer the
//   tail across chunks. Keepalive comments (lines starting with `:`)
//   are silently discarded, which is what the SSE spec asks for.
//
// Reconnect:
//   Exponential backoff via nextBackoffMs() from logs-buffer, so the
//   test file over there pins the schedule. Reconnect fires whenever
//   the XHR errors OR completes without an explicit close() call from
//   the caller.

import type { HubConfig } from './api';
import { RECONNECT_MIN_MS, nextBackoffMs, type ConnState, type LogEvent } from './logs-buffer';

interface OpenEventStreamHandlers {
  onEvent: (ev: LogEvent) => void;
  onState: (s: ConnState, error?: string) => void;
}

/** Open an SSE connection to /events/network/{netId}. Returns a
 *  cleanup function; call it to stop listening + prevent reconnect.
 *
 *  🔴 Path is `/events/network/<id>`, NOT `/api/events/...`. Hub root
 *  doesn't prefix the SSE routes with `/api` (see agent-network
 *  server/src/server.ts around L702-712). Typo → 404 → cascades into
 *  the "hub 未暴露" banner. Same underscore-vs-hyphen family as
 *  `/api/task_events`. */
export function openNetworkEventStream(
  cfg: HubConfig,
  netId: string,
  handlers: OpenEventStreamHandlers,
): () => void {
  let xhr: XMLHttpRequest | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = RECONNECT_MIN_MS;

  const connect = () => {
    if (stopped) return;
    handlers.onState('connecting');
    let readCursor = 0;
    let carry = '';

    xhr = new XMLHttpRequest();
    xhr.open('GET', `${cfg.serverUrl}/events/network/${encodeURIComponent(netId)}`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${cfg.token}`);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    // A stray `Content-Type: text/plain` on the request has bitten
    // similar setups — don't send one; GET has no body.

    xhr.onreadystatechange = () => {
      if (!xhr) return;
      // HEADERS_RECEIVED → 2 marks the connection succeeded (regardless
      // of HTTP status). Filter to 200 explicitly; 401/403 go through
      // onerror path via readyState=4.
      if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
        if (xhr.status === 200) {
          handlers.onState('connected');
          backoffMs = RECONNECT_MIN_MS;   // reset backoff on success
        }
      }
    };

    xhr.onprogress = () => {
      if (!xhr || xhr.status !== 200) return;
      const full = xhr.responseText;
      // responseText grows monotonically. Slice only the new suffix.
      const chunk = carry + full.slice(readCursor);
      readCursor = full.length;
      // Split into complete SSE frames. Anything after the last "\n\n"
      // is a partial frame — carry it forward.
      const parts = chunk.split('\n\n');
      carry = parts.pop() ?? '';   // trailing partial frame or ''
      for (const frame of parts) {
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;   // SSE comment / keepalive
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s/, ''));
          // Ignore `event:` / `id:` for this v1 — payload lives in data.
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        try {
          const parsed = JSON.parse(payload) as LogEvent;
          parsed._at = Date.now();
          handlers.onEvent(parsed);
        } catch {
          // Malformed frame — pass it through as a raw string so a hub
          // bug is visible, not silently swallowed. Same principle as
          // typeBucket surfacing unknown types instead of dropping.
          handlers.onEvent({ _at: Date.now(), _raw: payload, type: 'unknown' });
        }
      }
    };

    // Both onerror and onload lead to reconnect (unless caller stopped).
    // onload fires when the connection closes cleanly from the server
    // side — for a long-lived SSE that means "server dropped us".
    const scheduleReconnect = (why: string) => {
      if (stopped) return;
      handlers.onState('disconnected', why);
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
      // 401/403 landed here as final readyState=4; surface the status.
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
