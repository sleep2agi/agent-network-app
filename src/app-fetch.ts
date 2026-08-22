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
 */
export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}
