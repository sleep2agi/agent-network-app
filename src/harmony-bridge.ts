// HarmonyOS ArkWeb shell bridge (window.__ANET_HARMONY__).
//
// Pure TypeScript with zero react-native imports so Node/Bun unit tests and Expo Web
// both import cleanly. When running inside the HarmonyOS ArkWeb container
// (harmony/entry/src/main/ets/pages/Index.ets), ArkTS registers `window.__ANET_HARMONY__`
// via `javaScriptProxy`, providing:
//   - native HTTP transport (@kit.RemoteCommunicationKit) bypassing WebView CORS & LAN HTTP blocks
//   - native SSE stream transport (@kit.NetworkKit requestInStream) for real-time Hub events
//   - native file download / save / preview (@kit.CoreFileKit + @kit.PreviewKit) without JS Base64 OOM
//   - native external URL opener (UIAbilityContext.startAbility)
//   - native KV storage (@kit.ArkData preferences) surviving WebView cache clears
//   - native clipboard (@kit.BasicServicesKit pasteboard), notifications (@kit.NotificationKit),
//     live system safe-area insets (avoidAreaChange), theme/status-bar sync, and swipe-back delegation.

import type { SimInsets } from './safe-area-sim';

export interface HarmonyHttpRequestPayload {
  method: string;
  url: string;
  headers: [string, string][];
  bodyBase64: string | null;
  timeoutMs?: number;
}

export interface HarmonyHttpResponsePayload {
  ok: boolean;
  status: number;
  statusText?: string;
  url?: string;
  headers?: [string, string][];
  bodyBase64?: string | null;
  error?: string;
}

export interface HarmonyFileResultPayload {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface HarmonyBridgeApi {
  httpFetch?: (reqJson: string) => Promise<string> | string;
  httpFetchAsync?: (reqId: string, reqJson: string) => void;
  openSseStream?: (streamId: string, reqJson: string) => void;
  closeSseStream?: (streamId: string) => void;
  downloadAndOpenFileAsync?: (reqId: string, reqJson: string) => void;
  openLocalFileAsync?: (reqId: string, reqJson: string) => void;
  saveBytesAsync?: (reqId: string, reqJson: string) => void;
  openExternalUrl?: (url: string) => boolean;
  setThemeMode?: (mode: string) => void;
  requestNotificationPermission?: () => void;
  postNotification?: (payloadJson: string) => void;
  cancelNotification?: (idNum: number) => void;
  kvGet?: (key: string) => string | null;
  kvSet?: (key: string, value: string) => void;
  kvDel?: (key: string) => void;
  getInsetsJson?: () => string;
  copyText?: (text: string) => void;
}

type HarmonySseEventKind = 'open' | 'chunk' | 'close' | 'error';

type HarmonyGlobal = typeof globalThis & {
  __ANET_HARMONY__?: HarmonyBridgeApi;
  __ANET_HARMONY_INSETS__?: unknown;
  __ANET_HARMONY_BACK__?: () => boolean;
  __ANET_HARMONY_HTTP_RESOLVE__?: (reqId: string, rawJson: string) => void;
  __ANET_HARMONY_SSE_EVENT__?: (streamId: string, kind: HarmonySseEventKind, data: string) => void;
  __ANET_HARMONY_FILE_RESOLVE__?: (reqId: string, rawJson: string) => void;
};

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
const ERROR_REQUEST_CANCELLED = 'Request cancelled';
export const HARMONY_INSETS_EVENT = 'anet-harmony-insets';

const pendingHarmonyHttp = new Map<string, (rawJson: string) => void>();
const pendingHarmonyFile = new Map<string, (rawJson: string) => void>();
const harmonySseListeners = new Map<string, {
  onOpen: () => void;
  onChunk: (chunk: string) => void;
  onClose: (reason: string) => void;
}>();
let nextHarmonyReqId = 1;

const harmonyGlobal = (): HarmonyGlobal => globalThis as HarmonyGlobal;

function ensureHarmonyHttpResolver(): void {
  const g = harmonyGlobal();
  if (typeof g.__ANET_HARMONY_HTTP_RESOLVE__ === 'function') return;
  g.__ANET_HARMONY_HTTP_RESOLVE__ = (reqId: string, rawJson: string) => {
    const resolve = pendingHarmonyHttp.get(reqId);
    if (!resolve) return;
    pendingHarmonyHttp.delete(reqId);
    resolve(rawJson);
  };
}

function ensureHarmonyFileResolver(): void {
  const g = harmonyGlobal();
  if (typeof g.__ANET_HARMONY_FILE_RESOLVE__ === 'function') return;
  g.__ANET_HARMONY_FILE_RESOLVE__ = (reqId: string, rawJson: string) => {
    const resolve = pendingHarmonyFile.get(reqId);
    if (!resolve) return;
    pendingHarmonyFile.delete(reqId);
    resolve(rawJson);
  };
}

function ensureHarmonySseDispatcher(): void {
  const g = harmonyGlobal();
  if (typeof g.__ANET_HARMONY_SSE_EVENT__ === 'function') return;
  g.__ANET_HARMONY_SSE_EVENT__ = (streamId: string, kind: HarmonySseEventKind, data: string) => {
    const listener = harmonySseListeners.get(streamId);
    if (!listener) return;
    if (kind === 'open') {
      listener.onOpen();
    } else if (kind === 'chunk') {
      listener.onChunk(data);
    } else {
      listener.onClose(data || (kind === 'error' ? 'network error' : 'server closed stream'));
    }
  };
}

export function getHarmonyBridge(): HarmonyBridgeApi | null {
  if (typeof globalThis === 'undefined') return null;
  const b = harmonyGlobal().__ANET_HARMONY__;
  return b && (typeof b.httpFetchAsync === 'function' || typeof b.httpFetch === 'function') ? b : null;
}

export function isHarmonyShell(): boolean {
  return getHarmonyBridge() !== null;
}

export function hasHarmonySseBridge(): boolean {
  const b = getHarmonyBridge();
  return !!(b && typeof b.openSseStream === 'function');
}

export function hasHarmonyFileBridge(): boolean {
  const b = getHarmonyBridge();
  return !!(b && typeof b.downloadAndOpenFileAsync === 'function');
}

export function hasHarmonySaveBytesBridge(): boolean {
  const b = getHarmonyBridge();
  return !!(b && typeof b.saveBytesAsync === 'function');
}

export function hasHarmonyNotificationBridge(): boolean {
  const b = getHarmonyBridge();
  return !!(b && typeof b.postNotification === 'function');
}

// ── Base64 helpers (pure JS — browser, ArkWeb, Node & Bun safe, handles arbitrary binary payloads) ──

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) map[B64_CHARS.charCodeAt(i)] = i;
  return map;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return '';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64_CHARS[(n >> 18) & 63];
    out += B64_CHARS[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64_CHARS[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64_CHARS[n & 63] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\r\n\s]+/g, '');
  if (!clean) return new Uint8Array(0);
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((clean.length * 3) / 4) - pad;
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i);
    const c1 = clean.charCodeAt(i + 1);
    const c2 = i + 2 < clean.length ? clean.charCodeAt(i + 2) : 61;
    const c3 = i + 3 < clean.length ? clean.charCodeAt(i + 3) : 61;
    const v0 = c0 < 128 ? B64_LOOKUP[c0] : -1;
    const v1 = c1 < 128 ? B64_LOOKUP[c1] : -1;
    const v2 = c2 === 61 ? 0 : c2 < 128 ? B64_LOOKUP[c2] : -1;
    const v3 = c3 === 61 ? 0 : c3 < 128 ? B64_LOOKUP[c3] : -1;
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) throw new Error('Invalid base64 character');
    const n = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ── Native HTTP transport ──

export async function harmonyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const bridge = getHarmonyBridge();
  if (!bridge) throw new Error('HarmonyOS bridge unavailable');

  const signal = init?.signal;
  if (signal?.aborted) throw new Error(ERROR_REQUEST_CANCELLED);

  const headers = new Headers(init?.headers);
  const req = new Request(input, init);
  const bodyBuf = await req.arrayBuffer();
  if (signal?.aborted) throw new Error(ERROR_REQUEST_CANCELLED);
  for (const [k, v] of req.headers) {
    if (!headers.get(k)) headers.set(k, v);
  }

  const payload: HarmonyHttpRequestPayload = {
    method: req.method,
    url: req.url,
    headers: Array.from(headers.entries()),
    bodyBase64: bodyBuf.byteLength > 0 ? bytesToBase64(new Uint8Array(bodyBuf)) : null,
  };

  const payloadJson = JSON.stringify(payload);
  let raw: string;
  if (typeof bridge.httpFetchAsync === 'function') {
    ensureHarmonyHttpResolver();
    const reqId = `h_${nextHarmonyReqId++}`;
    raw = await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        pendingHarmonyHttp.delete(reqId);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error(ERROR_REQUEST_CANCELLED));
      };
      pendingHarmonyHttp.set(reqId, (resJson: string) => {
        cleanup();
        resolve(resJson);
      });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        bridge.httpFetchAsync!(reqId, payloadJson);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  } else {
    const run = Promise.resolve(bridge.httpFetch!(payloadJson));
    raw = signal
      ? await new Promise<string>((resolve, reject) => {
        const onAbort = () => reject(new Error(ERROR_REQUEST_CANCELLED));
        signal.addEventListener('abort', onAbort, { once: true });
        run.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
      })
      : await run;
  }

  let parsed: HarmonyHttpResponsePayload;
  try {
    parsed = JSON.parse(raw) as HarmonyHttpResponsePayload;
  } catch {
    throw new Error('Invalid HarmonyOS HTTP bridge response');
  }
  if (!parsed || parsed.ok === false) {
    throw new Error(parsed?.error || 'HarmonyOS HTTP request failed');
  }

  const status = Number(parsed.status);
  if (!Number.isFinite(status) || status < 100 || status > 599) {
    throw new Error(parsed.error || `Invalid HTTP status from HarmonyOS bridge: ${parsed.status}`);
  }

  const body = NULL_BODY_STATUS.has(status)
    ? null
    : parsed.bodyBase64
      ? base64ToBytes(parsed.bodyBase64)
      : new Uint8Array(0);
  const resHeaders = new Headers();
  for (const pair of parsed.headers ?? []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [k, v] = pair;
    if (!k || k.startsWith(':')) continue;
    try {
      resHeaders.append(k, String(v ?? ''));
    } catch {
      // Skip header names rejected by Fetch Headers (e.g. HTTP/2 pseudo-headers)
    }
  }
  const res = new Response(body ? new Uint8Array(body) : null, {
    status,
    statusText: parsed.statusText ?? '',
    headers: resHeaders,
  });
  Object.defineProperty(res, 'url', { value: parsed.url || req.url, writable: false });
  return res;
}

// ── Native SSE stream transport ──

export function openHarmonySseStream(
  url: string,
  headers: [string, string][],
  handlers: { onOpen: () => void; onChunk: (chunk: string) => void; onClose: (reason: string) => void },
): () => void {
  const bridge = getHarmonyBridge();
  if (!bridge || typeof bridge.openSseStream !== 'function') {
    handlers.onClose('HarmonyOS SSE bridge unavailable');
    return () => {};
  }
  ensureHarmonySseDispatcher();
  const streamId = `sse_${nextHarmonyReqId++}`;
  harmonySseListeners.set(streamId, handlers);
  try {
    bridge.openSseStream(streamId, JSON.stringify({ url, headers }));
  } catch (err) {
    harmonySseListeners.delete(streamId);
    handlers.onClose(err instanceof Error ? err.message : String(err));
    return () => {};
  }
  return () => {
    harmonySseListeners.delete(streamId);
    try {
      bridge.closeSseStream?.(streamId);
    } catch {
      // ignore close errors
    }
  };
}

// ── Native file download / save / preview (zero JS Base64 OOM) ──

function awaitHarmonyFileBridge(invoke: (reqId: string) => void): Promise<HarmonyFileResultPayload> {
  ensureHarmonyFileResolver();
  const reqId = `file_${nextHarmonyReqId++}`;
  return new Promise<HarmonyFileResultPayload>((resolve, reject) => {
    pendingHarmonyFile.set(reqId, (rawJson: string) => {
      try {
        const parsed = JSON.parse(rawJson) as HarmonyFileResultPayload;
        if (!parsed || parsed.ok === false) {
          reject(new Error(parsed?.error || 'HarmonyOS file action failed'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error('Invalid HarmonyOS file bridge response'));
      }
    });
    try {
      invoke(reqId);
    } catch (err) {
      pendingHarmonyFile.delete(reqId);
      reject(err);
    }
  });
}

export async function harmonyDownloadFile(opts: {
  url: string;
  token: string;
  fileName: string;
  mimeType?: string;
  mode?: 'open' | 'save';
}): Promise<string> {
  const bridge = getHarmonyBridge();
  if (!bridge || typeof bridge.downloadAndOpenFileAsync !== 'function') {
    throw new Error('HarmonyOS file bridge unavailable');
  }
  const res = await awaitHarmonyFileBridge((reqId) => {
    bridge.downloadAndOpenFileAsync!(reqId, JSON.stringify(opts));
  });
  return res.path ?? '';
}

export async function harmonyOpenLocalFile(opts: {
  path: string;
  fileName?: string;
  mimeType?: string;
}): Promise<void> {
  const bridge = getHarmonyBridge();
  if (!bridge || typeof bridge.openLocalFileAsync !== 'function') {
    throw new Error('HarmonyOS file bridge unavailable');
  }
  await awaitHarmonyFileBridge((reqId) => {
    bridge.openLocalFileAsync!(reqId, JSON.stringify(opts));
  });
}

export async function harmonySaveBytes(opts: {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string;
}): Promise<string> {
  const bridge = getHarmonyBridge();
  if (!bridge || typeof bridge.saveBytesAsync !== 'function') {
    throw new Error('HarmonyOS save-bytes bridge unavailable');
  }
  const res = await awaitHarmonyFileBridge((reqId) => {
    bridge.saveBytesAsync!(reqId, JSON.stringify({
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      bytesBase64: bytesToBase64(opts.bytes),
    }));
  });
  return res.path ?? '';
}

// ── Native external URL opener ──

export function harmonyOpenExternalUrl(url: string): boolean {
  const b = getHarmonyBridge();
  if (!b || typeof b.openExternalUrl !== 'function') return false;
  return b.openExternalUrl(url) !== false;
}

// ── Native clipboard shim (routes expo-clipboard & navigator.clipboard.writeText → pasteboard) ──

let clipboardShimInstalled = false;
export function installHarmonyClipboardShim(): void {
  if (clipboardShimInstalled) return;
  const b = getHarmonyBridge();
  if (!b || typeof b.copyText !== 'function') return;
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } } }).navigator;
  if (!nav) return;
  const writeText = async (text: string): Promise<void> => {
    const active = getHarmonyBridge();
    if (active?.copyText) {
      active.copyText(String(text ?? ''));
      return;
    }
    throw new Error('HarmonyOS clipboard unavailable');
  };
  try {
    if (nav.clipboard) {
      Object.defineProperty(nav.clipboard, 'writeText', { value: writeText, configurable: true, writable: true });
    } else {
      Object.defineProperty(nav, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    }
    clipboardShimInstalled = true;
  } catch {
    try {
      Object.defineProperty(nav, 'clipboard', { value: { writeText }, configurable: true, writable: true });
      clipboardShimInstalled = true;
    } catch {
      // Non-configurable navigator.clipboard; callers fall back gracefully
    }
  }
}

// ── Native theme & system bar sync ──

export function syncHarmonyTheme(mode: 'dark' | 'light'): void {
  const b = getHarmonyBridge();
  if (!b || typeof b.setThemeMode !== 'function') return;
  try {
    b.setThemeMode(mode);
  } catch {
    // ignore
  }
}

// ── Native notifications ──

export function harmonyNotificationId(identifier: string): number {
  let hash = 2166136261;
  for (let i = 0; i < identifier.length; i++) {
    hash ^= identifier.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash | 0);
  return positive > 0 ? positive : 1;
}

export function harmonyRequestNotificationPermission(): void {
  try {
    getHarmonyBridge()?.requestNotificationPermission?.();
  } catch {
    // ignore
  }
}

export function harmonyPostNotification(identifier: string, title: string, body: string): void {
  const b = getHarmonyBridge();
  if (!b || typeof b.postNotification !== 'function') return;
  try {
    b.postNotification(JSON.stringify({ id: harmonyNotificationId(identifier), title, body }));
  } catch {
    // ignore
  }
}

export function harmonyCancelNotification(identifier: string): void {
  const b = getHarmonyBridge();
  if (!b || typeof b.cancelNotification !== 'function') return;
  try {
    b.cancelNotification(harmonyNotificationId(identifier));
  } catch {
    // ignore
  }
}

// ── Native KV persistence (with localStorage mirror fallback) ──

function safeLocalStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export const harmonyKv = {
  get: async (key: string): Promise<string | null> => {
    const b = getHarmonyBridge();
    if (b?.kvGet) {
      try {
        const val = b.kvGet(key);
        if (typeof val === 'string' && val.length > 0) return val;
      } catch { /* fall through to localStorage */ }
    }
    const ls = safeLocalStorage();
    return ls ? ls.getItem(key) : null;
  },
  set: async (key: string, value: string): Promise<void> => {
    const b = getHarmonyBridge();
    if (b?.kvSet) {
      try { b.kvSet(key, value); } catch { /* keep localStorage mirror */ }
    }
    const ls = safeLocalStorage();
    if (ls) ls.setItem(key, value);
  },
  del: async (key: string): Promise<void> => {
    const b = getHarmonyBridge();
    if (b?.kvDel) {
      try { b.kvDel(key); } catch { /* keep localStorage mirror */ }
    }
    const ls = safeLocalStorage();
    if (ls) ls.removeItem(key);
  },
};

// ── Live safe-area insets (top status bar / cutout, bottom navigation bar) ──

export function parseHarmonyInsets(raw: unknown): SimInsets | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const r = obj as Record<string, unknown>;
  const top = Number(r.top);
  const right = Number(r.right);
  const bottom = Number(r.bottom);
  const left = Number(r.left);
  if ([top, right, bottom, left].some(v => !Number.isFinite(v) || v < 0 || v > 200)) return null;
  return { top, right, bottom, left };
}

export function readHarmonyInsets(): SimInsets | null {
  if (typeof globalThis === 'undefined') return null;
  const fromGlobal = parseHarmonyInsets(harmonyGlobal().__ANET_HARMONY_INSETS__);
  if (fromGlobal) return fromGlobal;
  const b = getHarmonyBridge();
  if (b?.getInsetsJson) {
    try {
      return parseHarmonyInsets(b.getInsetsJson());
    } catch {
      return null;
    }
  }
  return null;
}

// ── Swipe-back delegation ──

export function registerHarmonyBackHandler(handler: () => boolean): () => void {
  if (typeof globalThis === 'undefined') return () => {};
  const g = harmonyGlobal();
  g.__ANET_HARMONY_BACK__ = handler;
  return () => {
    if (g.__ANET_HARMONY_BACK__ === handler) delete g.__ANET_HARMONY_BACK__;
  };
}
