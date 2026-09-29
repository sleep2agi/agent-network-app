/**
 * App-owned HTTP transport.
 *
 * Tauri's HTTP plugin bypasses WKWebView CORS, but it must never replace the
 * global fetch. Tauri's own macOS IPC sends `invoke` commands with
 * `fetch(ipc://...)`; replacing that function with the plugin creates a loop:
 * plugin fetch -> invoke -> IPC fetch -> plugin fetch.
 *
 * Importing the plugin here also makes initialization part of the request
 * promise. Import or permission failures therefore reach the caller's normal
 * error UI instead of becoming an unhandled fire-and-forget rejection.
 *
 * Desktop requests go through the app's own `pooled_fetch` command
 * (src-tauri/src/hub_http.rs) first: the plugin builds a new HTTP client per
 * request, so every request paid a fresh TCP + TLS handshake (~0.5 s China →
 * US, on top of a 0.22 s round trip). The command keeps one client and its
 * connections. The plugin stays as the fallback for a shell that does not
 * answer the command (test stubs; it is compiled into the same binary as this
 * bundle, so a real shell always has it).
 */
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    const pooled = await pooledFetch(input, init);
    if (pooled) return pooled;
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

/** Same message the plugin rejects with, so callers see one abort shape on either path. */
const ERROR_REQUEST_CANCELLED = 'Request cancelled';
const NULL_BODY_STATUS = [101, 103, 204, 205, 304];

type PooledMeta = { status: number; statusText: string; url: string; headers: [string, string][] };

/** Wire format of `pooled_fetch`: [u32 BE meta length][meta JSON][body]. */
export function decodePooledResponse(raw: ArrayBuffer | Uint8Array): Response {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = view.getUint32(0, false);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen))) as PooledMeta;
  const body = NULL_BODY_STATUS.includes(meta.status) ? null : bytes.slice(4 + metaLen);
  const res = new Response(body, { status: meta.status, statusText: meta.statusText, headers: meta.headers });
  Object.defineProperty(res, 'url', { value: meta.url, writable: false });
  return res;
}

/** null ⇒ this shell has no `pooled_fetch` (answered with a non-binary value); use the plugin. */
async function pooledFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const signal = init?.signal;
  if (signal?.aborted) throw new Error(ERROR_REQUEST_CANCELLED);
  // Normalise exactly like the plugin: Request fills in method, URL and the body's content type
  // (FormData boundary, text/plain, …); the caller's own headers win.
  const headers = new Headers(init?.headers);
  const req = new Request(input, init);
  const buffer = await req.arrayBuffer();
  for (const [key, value] of req.headers) if (!headers.get(key)) headers.set(key, value);
  const request = {
    method: req.method,
    url: req.url,
    headers: Array.from(headers.entries()),
    data: buffer.byteLength ? Array.from(new Uint8Array(buffer)) : null,
  };
  const { invoke } = await import('@tauri-apps/api/core');
  if (signal?.aborted) throw new Error(ERROR_REQUEST_CANCELLED);
  const sent = invoke<ArrayBuffer | Uint8Array | null>('pooled_fetch', { request });
  const raw = signal
    ? await new Promise<ArrayBuffer | Uint8Array | null>((resolve, reject) => {
      const onAbort = () => reject(new Error(ERROR_REQUEST_CANCELLED));
      signal.addEventListener('abort', onAbort, { once: true });
      sent.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    })
    : await sent;
  if (!(raw instanceof ArrayBuffer) && !(raw instanceof Uint8Array)) return null;
  return decodePooledResponse(raw);
}
