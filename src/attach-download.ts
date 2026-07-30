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

export const cachePathIn = (cacheDir: string, fileId: string, name?: string, mime?: string) => {
  const ext = extOf(name) || extFromMime(mime);
  return `${cacheDir}att-${fileId}${ext}`;
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

export const downloadAttachmentWith = async (
  fs: DownloadFs,
  cacheDir: string,
  serverUrl: string,
  token: string,
  fileId: string,
  name?: string,
  mime?: string,
): Promise<string> => {
  const dest = cachePathIn(cacheDir, fileId, name, mime);
  const info = await fs.getInfoAsync(dest);
  // Cache hit only when the file exists AND is non-empty. Because a failed
  // download never reaches `dest` (see below), a present non-empty file here
  // is one we previously validated.
  if (info.exists && (info.size ?? 0) > 0) return dest;

  // Download to a sibling temp path. `dest` stays untouched until the bytes
  // have been checked, so a failure can never poison the cache.
  const part = `${dest}.part`;
  await fs.deleteAsync(part, { idempotent: true }).catch(() => {});

  const r = await fs.downloadAsync(`${serverUrl}/api/files/${fileId}`, part, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const cleanup = async () => { await fs.deleteAsync(part, { idempotent: true }).catch(() => {}); };

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
  await fs.moveAsync({ from: part, to: dest });
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
