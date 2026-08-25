// 附件下载 — 纯逻辑层(无 RN 依赖, bun/node 可直跑, 见 attach-download.test.ts)。
//
// 为什么这一层要自己判成败, 而不是信 downloadAsync:
// expo-file-system 的原生实现无条件把响应体落盘, 只把状态码"报告"出来。
// android/src/main/java/expo/modules/filesystem/legacy/FileSystemLegacyModule.kt
// 的 onResponse:
//     val file = uri.toFile(); file.delete()
//     sink.writeAll(response.body!!.source())   // 不看 response.code
//     putInt("status", response.code)
//     promise.resolve(result)                   // 404 也 resolve
//
// 于是 404 的错误体(几十字节 JSON)会变成一个"文件"。用户双击打不开, 症状是
// "文件损坏/大小过小" —— 指向了完全错误的方向(Vincent 就是这样被耗掉时间的:
// 他以为是文件生成有问题, 实际是下载根本没成功)。更糟的是这个错误体非 0
// 字节, 会被 exists&&size>0 的缓存判定当成有效缓存**永久信任**, 即使服务端
// 修好、网络恢复, 该 fileId 在这台设备上也再也下不来。
//
// 所以: 先下到临时文件, 校验通过才原子 rename 到目标名。目标路径要么不存在,
// 要么是一个完整正确的文件 —— 中间态永远不会被缓存看见。

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const extOf = (name?: string) =>
  (name?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();

export const mimeFromName = (name?: string): string | undefined => EXT_MIME[extOf(name)];

export const extFromMime = (mime?: string): string => {
  if (!mime) return '';
  for (const [ext, m] of Object.entries(EXT_MIME)) if (m === mime) return ext;
  return '';
};

export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

const hash32 = (text: string, seed: number) => {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
};

/** Opaque cache namespace for one authenticated Hub profile. The raw server
 * URL and bearer token never appear in filenames/logs, while two profiles on
 * one Hub and identical file IDs on two Hubs cannot share trusted bytes. */
export const attachmentCacheScope = (serverUrl: string, token: string) => {
  let origin = serverUrl.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(origin);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    origin = parsed.toString().replace(/\/+$/, '');
  } catch { /* keep the non-secret raw endpoint spelling */ }
  const input = `${origin}\u0000${token}`;
  return `${hash32(input, 0x811c9dc5)}${hash32(input, 0x9e3779b9)}`;
};

export const cachePathIn = (cacheDir: string, fileId: string, name?: string, mime?: string, scope?: string) => {
  const ext = extOf(name) || extFromMime(mime);
  return `${cacheDir}att-${scope ? `${scope}-` : ''}${fileId}${ext}`;
};

/** The slice of expo-file-system this path needs, injected so the logic runs
 *  without a device. The fake in attach-download.test.ts reproduces the
 *  native contract quoted at the top of this file. */
export interface DownloadFs {
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>;
  downloadAsync(
    url: string,
    dest: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ status: number; headers?: Record<string, string> }>;
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
  readAsStringAsync(uri: string): Promise<string>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
}

/** Header lookup that tolerates either casing — RN normalises differently
 *  across platforms. */
const header = (h: Record<string, string> | undefined, k: string): string | undefined => {
  if (!h) return undefined;
  const hit = Object.keys(h).find((x) => x.toLowerCase() === k);
  return hit ? h[hit] : undefined;
};

/** Failure carrying the layer that actually failed, so the user is not sent
 *  to inspect a file that was never downloaded. */
export class AttachmentDownloadError extends Error {
  constructor(
    readonly status: number | null,
    readonly detail: string,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentDownloadError';
  }
}

/** Per-entry validation marker (issue #10 CR1). A cache hit on `dest`
 *  requires this sibling file to exist AND to hold the current
 *  `ATTACHMENT_CACHE_SCHEMA` — proof the file was written by *this*
 *  implementation (which validated the bytes) rather than left over by
 *  a version that wrote the response body regardless of status.
 *
 *  Why per-entry and not just the startup purge:
 *  `purgeLegacyAttachmentCacheWith` is fire-and-forget from App.tsx and
 *  a downloadAttachmentWith call can race it, or reach the module by a
 *  path that never mounts App. The marker makes cache trust self-proving
 *  on every hit rather than a lifecycle assumption. Startup purge stays
 *  as belt-and-braces (see #10 CR1). */
const entryMarkerPath = (dest: string) => `${dest}.v`;

export const downloadAttachmentWith = async (
  fs: DownloadFs,
  cacheDir: string,
  serverUrl: string,
  token: string,
  fileId: string,
  name?: string,
  mime?: string,
): Promise<string> => {
  const dest = cachePathIn(cacheDir, fileId, name, mime, attachmentCacheScope(serverUrl, token));
  const info = await fs.getInfoAsync(dest);
  // Cache hit requires BOTH the bytes AND a per-entry marker proving those
  // bytes were validated by this implementation. An empty/missing marker
  // means the file was left by an old version (or by a purge that hasn't
  // finished) — in either case, treat the entry as absent and re-download.
  //
  // Failure-direction discipline: every uncertain branch below tips toward
  // "download one extra time", never toward "trust unvalidated bytes":
  //   - marker file missing → re-download
  //   - marker file present but unreadable (catch → empty string) → re-download
  //   - marker content ≠ current schema → re-download
  // Cache code fails almost exclusively by *wrongly trusting* the cache;
  // one extra network round-trip is a cheap cost, an unopenable file is not.
  if (info.exists && (info.size ?? 0) > 0) {
    const marker = await fs.getInfoAsync(entryMarkerPath(dest));
    if (marker.exists) {
      let markerContent = '';
      try { markerContent = await fs.readAsStringAsync(entryMarkerPath(dest)); } catch { /* unreadable → treat as "not validated" per note above */ }
      if (markerContent.trim() === String(ATTACHMENT_CACHE_SCHEMA)) return dest;
    }
    // Marker missing or mismatch — stale/pre-validation cache. Fall through
    // to a fresh download; moveAsync below will overwrite `dest`.
  }

  // Download to a sibling temp path. `dest` stays untouched until the bytes
  // have been checked, so a failure can never poison the cache.
  const part = `${dest}.part`;
  await fs.deleteAsync(part, { idempotent: true }).catch(() => {});

  const cleanup = async () => { await fs.deleteAsync(part, { idempotent: true }).catch(() => {}); };

  let r: { status: number; headers?: Record<string, string> };
  try {
    r = await fs.downloadAsync(`${serverUrl}/api/files/${fileId}`, part, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    // #10 CR2: downloadAsync itself can throw (native abort, offline, DNS,
    // TLS). The native module may have already opened and partly written
    // `part` before failing — clean it up before rethrowing so the next
    // attempt doesn't confuse itself with half-written bytes.
    await cleanup();
    throw e;
  }

  if (r.status < 200 || r.status > 299) {
    // The body sitting in `part` right now is the server's error payload —
    // read a slice of it for the message, then delete it. Never let it
    // become the "file".
    let detail = '';
    try { detail = (await fs.readAsStringAsync(part)).slice(0, 200); } catch { /* body unreadable */ }
    await cleanup();
    throw new AttachmentDownloadError(
      r.status,
      detail,
      `下载失败：服务端返回 ${r.status}${detail ? `（${detail}）` : ''}`,
    );
  }

  const declared = header(r.headers, 'content-length');
  const got = await fs.getInfoAsync(part);
  const actual = got.size ?? 0;
  if (!got.exists || actual === 0) {
    await cleanup();
    throw new AttachmentDownloadError(r.status, '', '下载失败：服务端返回了空内容');
  }
  if (declared !== undefined && Number.isFinite(Number(declared)) && Number(declared) !== actual) {
    await cleanup();
    throw new AttachmentDownloadError(
      r.status,
      `content-length=${declared} actual=${actual}`,
      `下载失败：内容长度不符（声称 ${declared} 字节，实收 ${actual} 字节）`,
    );
  }

  // Atomic-enough landing: `dest` appears only once the bytes are validated.
  // #10 CR2: moveAsync can throw (destination locked, cross-device rename,
  // permission). If it does, `part` is still on disk holding validated
  // bytes — but leaving it there defeats the point of the "one attempt
  // one file" invariant. Clean it up in `finally`.
  try {
    await fs.moveAsync({ from: part, to: dest });
  } finally {
    await cleanup();
  }
  // #10 CR1: write the per-entry marker AFTER the bytes have landed at
  // `dest`. Order matters — reversing (marker-first, then move) would
  // create a window where the marker claims "validated" but the bytes
  // are not yet in place, and the next call would serve a nonexistent
  // (or half-written) file. That failure is unrecoverable.
  //
  // Current order costs at most one extra download if the process dies
  // between moveAsync and writeAsStringAsync — the file is fine but
  // unmarked → next call re-downloads (matches the "uncertain branch
  // → one extra download, never trust unvalidated bytes" rule above).
  // If a future reader is tempted to reorder these to "optimise away
  // that one extra download", they need to accept the reverse failure
  // mode instead — a broken cache entry served as valid. Don't.
  await fs.writeAsStringAsync(entryMarkerPath(dest), String(ATTACHMENT_CACHE_SCHEMA));
  return dest;
};

/** 用户可见文案：说清是**下载**这一步失败了，而不是让人去怀疑文件本身。
 *  这个 bug 耗掉时间的原因正是症状（文件损坏/过小）指向了错误的层。 */
export const describeAttachmentError = (e: unknown): string => {
  if (e instanceof AttachmentDownloadError) return e.message;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  // 老式 `HTTP 404` 也归一到同一句式，避免两种文案并存。
  const m = msg.match(/HTTP\s+(\d{3})/);
  if (m) return `下载失败：服务端返回 ${m[1]}`;
  return msg ? `下载失败：${msg}` : '下载失败';
};

// ── one-time cleanup of caches written before the .part fix ──────────────
//
// Versions before this fix wrote the HTTP response body to the real filename
// regardless of status, so a device can be holding a ~32-byte error payload
// that `exists && size > 0` happily serves forever. Those devices do not
// self-heal: the download is never retried, so a later server-side fix never
// reaches them.
//
// The cleanup is deliberately the dumbest thing that works: delete every
// attachment cache entry once, then drop a marker so it never runs again.
// Cost is one re-download per attachment, on one launch. The rejected
// alternative was a heuristic ("file looks too small / content does not match
// its mime") — that guesses at a question we can answer exactly, and would
// misfire on legitimately small files.
export const ATTACHMENT_CACHE_SCHEMA = 3;

/** Files this module owns live under `${cacheDir}att-…`; nothing else in the
 *  cache directory is touched. */
const ATTACHMENT_PREFIX = 'att-';
const markerPath = (cacheDir: string) => `${cacheDir}att-cache-v${ATTACHMENT_CACHE_SCHEMA}`;

export const purgeLegacyAttachmentCacheWith = async (
  fs: DownloadFs,
  cacheDir: string,
): Promise<{ purged: number; skipped: boolean }> => {
  if (!cacheDir) return { purged: 0, skipped: true };
  const marker = markerPath(cacheDir);
  const seen = await fs.getInfoAsync(marker).catch(() => ({ exists: false }));
  if (seen.exists) return { purged: 0, skipped: true };

  let purged = 0;
  try {
    const entries = await fs.readDirectoryAsync(cacheDir);
    for (const entry of entries) {
      if (!entry.startsWith(ATTACHMENT_PREFIX)) continue;
      // The marker shares the `att-` prefix, so a sweep could delete the very
      // file that stops it running again — turning "purge once" into "purge
      // every launch", whose only symptom is re-downloading attachments
      // forever. It cannot currently happen (the marker is written AFTER this
      // loop, and once it exists we return before reaching the loop at all),
      // so this guard is unreachable today and no test covers it. It stays
      // because that safety is a property of the *ordering* above: anyone who
      // moves the marker write before the sweep would silently reintroduce
      // the trap, and this line is what would catch them.
      if (`${cacheDir}${entry}` === marker) continue;
      await fs.deleteAsync(`${cacheDir}${entry}`, { idempotent: true }).catch(() => {});
      purged++;
    }
  } catch {
    // A cache directory we cannot read is not worth failing app start over;
    // the marker is still written so this does not retry on every launch.
  }
  await fs.writeAsStringAsync(marker, String(ATTACHMENT_CACHE_SCHEMA)).catch(() => {});
  return { purged, skipped: false };
};
