// HarmonyOS ArkWeb shell bridge (window.__ANET_HARMONY__).
//
// Pure TypeScript with zero react-native imports so Node unit tests and Expo Web
// both import cleanly. When running inside the HarmonyOS ArkWeb container
// (harmony/entry/src/main/ets/pages/Index.ets), ArkTS registers `window.__ANET_HARMONY__`
// via `javaScriptProxy`, providing:
//   - native HTTP transport (@kit.NetworkKit) that bypasses WebView CORS and supports LAN HTTP hubs
//   - native key-value storage (@kit.ArkData preferences) that survives WebView cache clears
//   - live system safe-area insets (top status bar / cutout, bottom navigation indicator)
//   - native swipe-back delegation so HarmonyOS edge-back pops ANet screens instead of exiting.

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

export interface HarmonyBridgeApi {
  httpFetch?: (reqJson: string) => Promise<string> | string;
  httpFetchAsync?: (reqId: string, reqJson: string) => void;
  kvGet?: (key: string) => string | null;
  kvSet?: (key: string, value: string) => void;
  kvDel?: (key: string) => void;
  getInsetsJson?: () => string;
  copyText?: (text: string) => void;
}

type HarmonyGlobal = typeof globalThis & {
  __ANET_HARMONY__?: HarmonyBridgeApi;
  __ANET_HARMONY_INSETS__?: unknown;
  __ANET_HARMONY_BACK__?: () => boolean;
  __ANET_HARMONY_HTTP_RESOLVE__?: (reqId: string, rawJson: string) => void;
};

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
const ERROR_REQUEST_CANCELLED = 'Request cancelled';
export const HARMONY_INSETS_EVENT = 'anet-harmony-insets';

const pendingHarmonyHttp = new Map<string, (rawJson: string) => void>();
let nextHarmonyHttpId = 1;

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

export function getHarmonyBridge(): HarmonyBridgeApi | null {
  if (typeof globalThis === 'undefined') return null;
  const b = harmonyGlobal().__ANET_HARMONY__;
  return b && (typeof b.httpFetchAsync === 'function' || typeof b.httpFetch === 'function') ? b : null;
}

export function isHarmonyShell(): boolean {
  return getHarmonyBridge() !== null;
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
    const reqId = `h_${nextHarmonyHttpId++}`;
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
