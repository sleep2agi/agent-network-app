// Direct external storage upload & download helpers (ModelScope / Aliyun OSS / AWS S3).
// Pure TypeScript (no react-native import) so bun unit tests run directly.

export type DirectFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const FILE_ID_FROM_URL_RE = /\/api\/files\/([A-Za-z0-9_-]{8,64})(?:[?#]|$)/;

/** Extract file_id from a Hub `/api/files/<id>` URL (or null if not a Hub file URL). */
export function extractFileIdFromUrl(url: string): string | null {
  const m = url.match(FILE_ID_FROM_URL_RE);
  return m ? m[1] : null;
}

/** Build `/api/files/<id>/direct` from an existing `/api/files/<id>` URL. */
export function directFileDescriptorUrl(fileUrl: string): string | null {
  const m = fileUrl.match(/^(.*?\/api\/files\/[A-Za-z0-9_-]{8,64})(?:[?#].*)?$/);
  return m ? `${m[1]}/direct` : null;
}

// ── SHA-256 (WebCrypto fast path + pure-JS FIPS 180-4 fallback for Hermes/HTTP) ──

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256HexSync(data: Uint8Array): string {
  const len = data.length;
  const bitLenHi = Math.floor((len * 8) / 0x100000000);
  const bitLenLo = (len * 8) >>> 0;
  const padLen = ((len + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, bitLenHi, false);
  view.setUint32(padLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeSha256Hex(data: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const buf = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? (data.buffer as ArrayBuffer)
        : data.slice().buffer;
      const digest = await subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      /* insecure HTTP web context or partial WebCrypto → pure-JS fallback */
    }
  }
  return sha256HexSync(data);
}

function cleanHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function hasForbiddenBrowserHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === 'cookie');
}

export const HUB_LOCAL_FALLBACK_MAX_BYTES = 12 * 1024 * 1024;

/** Append `proxy=1` to a Hub `/api/files/:id` URL so Hub streams remote files instead of 302-looping back to an unreachable external URL. */
export function appendHubProxyParam(url: string): string {
  if (/[?&]proxy=(?:1|true)(?:&|$)/i.test(url)) return url;
  return url.includes('?') ? `${url}&proxy=1` : `${url}?proxy=1`;
}

export type DirectUploadResult =
  | {
      kind: 'uploaded';
      file: { file_id: string; path: string; url: string; size: number; mime: string; storage_provider?: string };
    }
  | { kind: 'fallback_hub'; corsFallback?: boolean; degradedFallback?: boolean }
  | { kind: 'error'; error: string; message: string; limitBytes?: number };

/**
 * Attempt direct upload through Hub external storage relay:
 *   POST /api/uploads/presign → direct PUT to ModelScope/OSS/S3 → POST /api/uploads/complete
 * Returns `fallback_hub` when external storage is disabled/unsupported, or when a pure web browser
 * cannot satisfy CORS/Cookie headers on direct PUT.
 */
export async function tryDirectUploadBytes(opts: {
  serverUrl: string;
  token: string;
  networkId?: string;
  purpose?: string;
  bytes: Uint8Array;
  name: string;
  mime: string;
  /** True only in a plain web browser (not Tauri desktop, not Harmony shell, not RN native). */
  isPlainBrowser?: boolean;
  fetchImpl: DirectFetchLike;
  signal?: AbortSignal;
}): Promise<DirectUploadResult> {
  const base = opts.serverUrl.replace(/\/+$/, '');
  const sha256 = await computeSha256Hex(opts.bytes);

  let presignRes: Response;
  try {
    presignRes = await opts.fetchImpl(`${base}/api/uploads/presign`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: opts.name,
        mime: opts.mime,
        size: opts.bytes.byteLength,
        sha256,
        ...(opts.networkId ? { network_id: opts.networkId } : {}),
        ...(opts.purpose ? { purpose: opts.purpose } : {}),
      }),
      signal: opts.signal,
    });
  } catch {
    return { kind: 'fallback_hub' };
  }

  const canFallbackHub = opts.bytes.byteLength <= HUB_LOCAL_FALLBACK_MAX_BYTES;

  if (presignRes.status === 404 || presignRes.status === 405 || presignRes.status === 501) {
    return { kind: 'fallback_hub' };
  }
  const presignBody: any = await presignRes.json().catch(() => null);
  if (!presignRes.ok) {
    if (
      presignRes.status === 401
      || presignRes.status === 403
      || presignRes.status === 413
      || presignRes.status === 429
      || !canFallbackHub
    ) {
      return {
        kind: 'error',
        error: String(presignBody?.error || `HTTP ${presignRes.status}`),
        message: String(presignBody?.message || presignBody?.error || `HTTP ${presignRes.status}`),
        limitBytes: typeof presignBody?.limit_bytes === 'number' ? presignBody.limit_bytes : undefined,
      };
    }
    return { kind: 'fallback_hub' };
  }
  if (!presignBody?.ok || presignBody.mode !== 'direct' || typeof presignBody.file_id !== 'string') {
    return { kind: 'fallback_hub' };
  }

  if (!presignBody.skip_upload) {
    const candidates: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    if (typeof presignBody.upload?.url === 'string' && presignBody.upload.url) {
      candidates.push({
        url: presignBody.upload.url,
        method: presignBody.upload?.method || 'PUT',
        headers: cleanHeaders(presignBody.upload?.headers),
      });
    }
    if (typeof presignBody.fallback_upload?.url === 'string' && presignBody.fallback_upload.url) {
      candidates.push({
        url: presignBody.fallback_upload.url,
        method: presignBody.fallback_upload?.method || 'PUT',
        headers: cleanHeaders(presignBody.fallback_upload?.headers),
      });
    }
    if (candidates.length === 0) {
      return canFallbackHub
        ? { kind: 'fallback_hub' }
        : { kind: 'error', error: 'storage_presign_bad_response', message: '外部存储未返回有效上传地址' };
    }
    // Plain web browsers forbid sending a Cookie header via fetch(); fall back to Hub when <= 12 MiB,
    // or surface a clear browser limitation error when > 12 MiB (never waste bandwidth into Hub 413).
    if (opts.isPlainBrowser && hasForbiddenBrowserHeader(candidates[0].headers)) {
      if (canFallbackHub) return { kind: 'fallback_hub', corsFallback: true };
      return {
        kind: 'error',
        error: 'browser_cookie_forbidden',
        message: '浏览器环境无法直传超过 12MB 的 ModelScope 文件，请使用桌面客户端或切换为私有阿里云 OSS / AWS S3',
      };
    }

    let putOk = false;
    let lastErr: DirectUploadResult = { kind: 'error', error: 'storage_put_network', message: '直传外部存储连接失败' };
    for (const cand of candidates) {
      if (opts.isPlainBrowser && hasForbiddenBrowserHeader(cand.headers)) {
        if (canFallbackHub) return { kind: 'fallback_hub', corsFallback: true };
        return {
          kind: 'error',
          error: 'browser_cookie_forbidden',
          message: '浏览器环境无法直传超过 12MB 的 ModelScope 文件，请使用桌面客户端或切换为私有阿里云 OSS / AWS S3',
        };
      }
      try {
        const putRes = await opts.fetchImpl(cand.url, {
          method: cand.method,
          headers: cand.headers,
          body: new Blob([new Uint8Array(opts.bytes)], { type: opts.mime || 'application/octet-stream' }),
          signal: opts.signal,
        });
        if (!putRes.ok) {
          lastErr = { kind: 'error', error: `storage_put_${putRes.status}`, message: `直传存储失败（HTTP ${putRes.status}）` };
          continue;
        }
        const ct = (putRes.headers.get('Content-Type') || '').toLowerCase();
        let rejected = false;
        if (ct.includes('application/json')) {
          const j: any = await putRes.json().catch(() => null);
          if ((typeof j?.Code === 'number' && j.Code !== 200) || j?.Success === false || j?.success === false) {
            lastErr = { kind: 'error', error: 'storage_put_rejected', message: String(j?.Message || '直传存储被拒绝') };
            rejected = true;
          }
        }
        if (!rejected) {
          putOk = true;
          break;
        }
      } catch {
        lastErr = { kind: 'error', error: 'storage_put_network', message: '直传外部存储连接失败' };
      }
    }
    if (!putOk) {
      if (canFallbackHub) {
        return opts.isPlainBrowser
          ? { kind: 'fallback_hub', corsFallback: true }
          : { kind: 'fallback_hub', degradedFallback: true };
      }
      return lastErr;
    }
  }

  let completeRes: Response;
  try {
    completeRes = await opts.fetchImpl(`${base}/api/uploads/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: presignBody.file_id }),
      signal: opts.signal,
    });
  } catch {
    if (canFallbackHub) return { kind: 'fallback_hub', degradedFallback: true };
    return { kind: 'error', error: 'storage_complete_network', message: '完成直传确认失败' };
  }

  const completeBody: any = await completeRes.json().catch(() => null);
  if (!completeRes.ok || !completeBody?.ok || typeof completeBody.file_id !== 'string') {
    if (canFallbackHub && completeRes.status !== 401 && completeRes.status !== 403 && completeRes.status !== 413 && completeRes.status !== 429) {
      return { kind: 'fallback_hub', degradedFallback: true };
    }
    return {
      kind: 'error',
      error: String(completeBody?.error || `HTTP ${completeRes.status}`),
      message: String(completeBody?.message || completeBody?.error || `HTTP ${completeRes.status}`),
    };
  }
  return {
    kind: 'uploaded',
    file: {
      file_id: completeBody.file_id,
      path: typeof completeBody.path === 'string' ? completeBody.path : '',
      url: typeof completeBody.url === 'string' ? completeBody.url : `/api/files/${completeBody.file_id}`,
      size: typeof completeBody.size === 'number' ? completeBody.size : opts.bytes.byteLength,
      mime: typeof completeBody.mime === 'string' ? completeBody.mime : opts.mime,
      storage_provider: typeof completeBody.storage_provider === 'string' ? completeBody.storage_provider : presignBody.provider,
    },
  };
}

/**
 * Pure native (iOS / Android) direct upload orchestrator used by `src/attach.ts`.
 * Extracted here with injectable `putFile` so Tier 1 -> Tier 2 -> Tier 3 and >12 MiB
 * presign 5xx behavior are directly unit-testable without RN runtime dependencies.
 */
export async function tryNativeDirectUpload(opts: {
  serverUrl: string;
  token: string;
  networkId?: string;
  purpose?: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  timeoutMessage: string;
  fetchImpl: DirectFetchLike;
  putFile: (url: string, headers: Record<string, string>) => Promise<{ status: number } | null>;
}): Promise<DirectUploadResult> {
  const base = opts.serverUrl.replace(/\/+$/, '');
  const canFallbackHub = opts.size <= HUB_LOCAL_FALLBACK_MAX_BYTES;

  let presignRes: Response;
  try {
    presignRes = await opts.fetchImpl(`${base}/api/uploads/presign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.name,
        mime: opts.mime,
        size: opts.size,
        ...(opts.sha256 ? { sha256: opts.sha256 } : {}),
        ...(opts.networkId ? { network_id: opts.networkId } : {}),
        ...(opts.purpose ? { purpose: opts.purpose } : {}),
      }),
    });
  } catch {
    return canFallbackHub
      ? { kind: 'fallback_hub' }
      : { kind: 'error', error: 'storage_presign_network', message: '请求外部存储预签名失败' };
  }

  if (presignRes.status === 404 || presignRes.status === 405 || presignRes.status === 501) {
    return { kind: 'fallback_hub' };
  }
  const presignBody: any = await presignRes.json().catch(() => null);
  if (!presignRes.ok) {
    if (
      presignRes.status === 401
      || presignRes.status === 403
      || presignRes.status === 413
      || presignRes.status === 429
      || !canFallbackHub
    ) {
      return {
        kind: 'error',
        error: String(presignBody?.error || `HTTP ${presignRes.status}`),
        message: String(presignBody?.message || presignBody?.error || `HTTP ${presignRes.status}`),
        limitBytes: typeof presignBody?.limit_bytes === 'number' ? presignBody.limit_bytes : undefined,
      };
    }
    return { kind: 'fallback_hub' };
  }
  if (!presignBody?.ok || presignBody.mode !== 'direct' || typeof presignBody.file_id !== 'string') {
    return { kind: 'fallback_hub' };
  }

  let putSucceeded = !!presignBody.skip_upload;
  let lastPutErr: DirectUploadResult = { kind: 'error', error: 'storage_put_network', message: '直传外部存储连接失败' };

  if (!presignBody.skip_upload) {
    const putCandidates: Array<{ url: string; headers: Record<string, string> }> = [];
    if (typeof presignBody.upload?.url === 'string' && presignBody.upload.url) {
      putCandidates.push({
        url: presignBody.upload.url,
        headers: cleanHeaders(presignBody.upload.headers),
      });
    }
    if (typeof presignBody.fallback_upload?.url === 'string' && presignBody.fallback_upload.url) {
      putCandidates.push({
        url: presignBody.fallback_upload.url,
        headers: cleanHeaders(presignBody.fallback_upload.headers),
      });
    }
    if (putCandidates.length === 0) {
      return canFallbackHub
        ? { kind: 'fallback_hub' }
        : { kind: 'error', error: 'storage_presign_bad_response', message: '外部存储未返回有效上传地址' };
    }
    for (const cand of putCandidates) {
      const putRes = await opts.putFile(cand.url, cand.headers);
      if (!putRes) {
        lastPutErr = { kind: 'error', error: 'storage_put_timeout', message: opts.timeoutMessage };
        continue;
      }
      if (putRes.status >= 200 && putRes.status < 300) {
        putSucceeded = true;
        break;
      }
      lastPutErr = putRes.status > 0
        ? { kind: 'error', error: `storage_put_${putRes.status}`, message: `直传存储失败（HTTP ${putRes.status}）` }
        : { kind: 'error', error: 'storage_put_network', message: '直传外部存储连接失败' };
    }
  }

  if (!putSucceeded) {
    if (canFallbackHub) return { kind: 'fallback_hub', degradedFallback: true };
    return lastPutErr;
  }

  let completeRes: Response;
  try {
    completeRes = await opts.fetchImpl(`${base}/api/uploads/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: presignBody.file_id }),
    });
  } catch {
    if (canFallbackHub) return { kind: 'fallback_hub', degradedFallback: true };
    return { kind: 'error', error: 'storage_complete_network', message: '完成直传确认失败' };
  }

  const completeBody: any = await completeRes.json().catch(() => null);
  if (!completeRes.ok || !completeBody?.ok || typeof completeBody.file_id !== 'string') {
    const hardAuthOrQuota = completeRes.status === 401
      || completeRes.status === 403
      || completeRes.status === 413
      || completeRes.status === 429;
    if (!hardAuthOrQuota && canFallbackHub) {
      return { kind: 'fallback_hub', degradedFallback: true };
    }
    return {
      kind: 'error',
      error: String(completeBody?.error || `HTTP ${completeRes.status}`),
      message: String(completeBody?.message || completeBody?.error || `HTTP ${completeRes.status}`),
    };
  }

  return {
    kind: 'uploaded',
    file: {
      file_id: completeBody.file_id,
      path: typeof completeBody.path === 'string' ? completeBody.path : '',
      url: typeof completeBody.url === 'string' ? completeBody.url : `/api/files/${completeBody.file_id}`,
      size: typeof completeBody.size === 'number' ? completeBody.size : opts.size,
      mime: typeof completeBody.mime === 'string' ? completeBody.mime : opts.mime,
      storage_provider: typeof completeBody.storage_provider === 'string' ? completeBody.storage_provider : presignBody.provider,
    },
  };
}

export type DirectDownloadTarget =
  | { kind: 'direct'; url: string; fallbackUrl?: string; headers: Record<string, string>; provider?: string }
  | { kind: 'hub' };

/**
 * Probe GET /api/files/:id/direct to bypass Hub bandwidth for externally stored files.
 * Safe against non-JSON mocks and older Hubs (cancels body without reading on non-JSON).
 */
export async function resolveDirectDownloadTarget(opts: {
  fileUrl: string;
  token: string;
  isPlainBrowser?: boolean;
  fetchImpl: DirectFetchLike;
}): Promise<DirectDownloadTarget> {
  const directUrl = directFileDescriptorUrl(opts.fileUrl);
  if (!directUrl) return { kind: 'hub' };
  try {
    const res = await opts.fetchImpl(directUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.token}` },
    });
    const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) {
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      return { kind: 'hub' };
    }
    const body: any = await res.json().catch(() => null);
    if (body?.ok === true && body.mode === 'direct' && typeof body.url === 'string' && body.url) {
      const headers = cleanHeaders(body.headers);
      if (opts.isPlainBrowser && hasForbiddenBrowserHeader(headers)) {
        return { kind: 'hub' };
      }
      return {
        kind: 'direct',
        url: body.url,
        ...(typeof body.fallback_url === 'string' && body.fallback_url ? { fallbackUrl: body.fallback_url } : {}),
        headers,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
      };
    }
    return { kind: 'hub' };
  } catch {
    return { kind: 'hub' };
  }
}
