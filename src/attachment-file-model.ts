import type { UploadState } from './upload-queue';

export type FileCardStatus = 'queued' | 'uploading' | 'uploaded' | 'waitingSend' | 'sendFailed' | 'ready' | 'downloading' | 'saved' | 'error';

/**
 * 状态 → i18n key（#1051 P2）。原来这里直接存中文文案，英文界面里文件卡片会一直显示
 * 「等待上传 / 点击下载 / 下载失败 · 点击重试」。渲染处必须 `t(fileStatusKey[status])`，
 * 不在模型里拼死文案 —— 模型不该知道用户的语言。
 */
export const fileStatusKey: Record<FileCardStatus, string> = {
  queued: 'chat.fileStatus.queued', uploading: 'chat.fileStatus.uploading', uploaded: 'chat.fileStatus.uploaded',
  waitingSend: 'chat.fileStatus.waitingSend', sendFailed: 'chat.fileStatus.sendFailed',
  ready: 'chat.fileStatus.ready', downloading: 'chat.fileStatus.downloading',
  saved: 'chat.fileStatus.saved', error: 'chat.fileStatus.error',
};

export function localFileStatus(upload?: UploadState, pending = false, failed = false, uploaded = false): FileCardStatus {
  if (failed) return 'sendFailed';
  if (uploaded) return pending ? 'waitingSend' : 'uploaded';
  if (upload?.status === 'failed') return 'sendFailed';
  if (upload?.status === 'uploading') return 'uploading';
  if (upload?.status === 'done') return pending ? 'waitingSend' : 'uploaded';
  return 'queued';
}

export function formatFileSize(size?: number): string | undefined {
  if (size === undefined || !Number.isFinite(size) || size < 0) return undefined;
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function filePresentation(name: string, mime = ''): { label: string; color: string; extension: string } {
  const extension = /\.([^.\s/\\]+)$/.exec(name)?.[1] ?? '';
  const ext = extension.toLowerCase();
  let label = 'FILE';
  let color = '#667085';
  if (/^(docx?|odt|rtf)$/.test(ext) || /word|opendocument.text/.test(mime)) { label = 'DOC'; color = '#2864b4'; }
  else if (ext === 'pdf' || mime === 'application/pdf') { label = 'PDF'; color = '#c83b42'; }
  else if (/^(pptx?|odp)$/.test(ext) || /presentation|powerpoint/.test(mime)) { label = 'PPT'; color = '#c45336'; }
  else if (/^(xlsx?|csv|ods)$/.test(ext) || /spreadsheet|excel|csv/.test(mime)) { label = 'XLS'; color = '#25784d'; }
  else if (/^(zip|rar|7z|gz|tar|bz2|xz)$/.test(ext) || /zip|compressed|tar/.test(mime)) { label = 'ZIP'; color = '#9364ad'; }
  else if (/^(js|jsx|ts|tsx|json|py|rs|go|java|c|cpp|h|html|css|sh|yaml|yml|xml|sql)$/.test(ext) || /json|javascript|xml/.test(mime)) { label = 'CODE'; color = '#426f86'; }
  else if (/^(md|markdown|mdx)$/.test(ext) || mime === 'text/markdown') { label = 'MD'; color = '#3b5bdb'; }
  else if (/^(txt|log)$/.test(ext) || mime.startsWith('text/')) { label = 'TXT'; }
  return { label, color, extension: extension ? `.${extension}` : '' };
}

// ── admin 2026-11-11「能不能新增 md 文档预览」──────────────────────────────────────────
/** 预览上限：再大就只给下载（预览是读进内存再渲染的）。 */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
/** 渲染上限：超过的部分截掉并注明，避免一份长日志把聊天窗口卡住。 */
export const TEXT_PREVIEW_MAX_CHARS = 200_000;

export function isMarkdownFile(name: string, mime = ''): boolean {
  return /\.(md|markdown|mdx)$/i.test(name) || mime === 'text/markdown';
}

/** 能在应用里直接预览的文本类附件（大小未知时也给预览入口，读的时候再卡上限）。 */
export function isTextPreviewable(name: string, mime = '', size?: number): boolean {
  if (size !== undefined && Number.isFinite(size) && size > TEXT_PREVIEW_MAX_BYTES) return false;
  if (isMarkdownFile(name, mime)) return true;
  if (/\.(txt|log|json|ya?ml|toml|csv|tsv|ini|conf|env\.example|sh|py|ts|tsx|js|jsx|go|rs|java|sql|xml|html|css)$/i.test(name)) return true;
  return mime.startsWith('text/') || /json|yaml|xml/.test(mime);
}

/** UTF-8 解码 + 截断。二进制（含 NUL）直接判为不可预览。 */
export function decodePreviewText(bytes: Uint8Array): { ok: true; text: string; truncated: boolean } | { ok: false; reason: 'binary' | 'too_large' } {
  if (bytes.byteLength > TEXT_PREVIEW_MAX_BYTES) return { ok: false, reason: 'too_large' };
  if (bytes.subarray(0, 8192).includes(0)) return { ok: false, reason: 'binary' };
  const text = utf8(bytes).replace(/^\uFEFF/, '');
  return text.length > TEXT_PREVIEW_MAX_CHARS
    ? { ok: true, text: text.slice(0, TEXT_PREVIEW_MAX_CHARS), truncated: true }
    : { ok: true, text, truncated: false };
}

/** UTF-8 解码；没有 TextDecoder 的运行时（老 Hermes）走手写解码，坏字节换成 U+FFFD。 */
function utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let cp = 0xfffd, n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i + 1 < bytes.length) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); n = 2; }
    else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); n = 3; }
    else if (b >= 0xf0 && b < 0xf5 && i + 3 < bytes.length) { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); n = 4; }
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}
