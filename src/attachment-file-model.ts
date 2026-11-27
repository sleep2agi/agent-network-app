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

export type FileCategory =
  | 'audio' | 'video' | 'image'
  | 'pdf' | 'doc' | 'ppt' | 'xls' | 'zip' | 'code' | 'md' | 'txt' | 'file';

export type FileIconName =
  | 'musical-notes' | 'play-circle' | 'image'
  | 'document-text' | 'easel' | 'grid' | 'archive'
  | 'code-slash' | 'reader' | 'document-text-outline' | 'document-outline';

export interface FilePresentation {
  /** 语义分类标签（DOC / PDF / AUDIO / VIDEO / FILE 等）。 */
  label: string;
  /** 图标角标短文案：音视频/图片优先展示直观扩展名（MP3 / MP4 / WAV / MOV 等），过长或缺失时回退分类标签。 */
  badge: string;
  /** 语义分类，供卡片和预览按类别分派。 */
  kind: FileCategory;
  /** Ionicons 矢量图标名。 */
  icon: FileIconName;
  /** 浅色主题下的图标与标签主色（在浅色微底上 ≥ 4.5:1）。 */
  color: string;
  /** 深色主题下的图标与标签主色（在深色微底上 ≥ 4.5:1）。 */
  darkColor: string;
  /** 原始扩展名（含前导点，如 `.mp3` / `.PDF` / `.gitignore`）。 */
  extension: string;
}

const shortBadge = (ext: string, fallback: string): string =>
  /^[a-z0-9]{2,4}$/.test(ext) ? ext.toUpperCase() : fallback;

export function filePresentation(name: string, mime = ''): FilePresentation {
  const extension = /\.([^.\s/\\]+)$/.exec(name)?.[1] ?? '';
  const ext = extension.toLowerCase();
  const suffix = extension ? `.${extension}` : '';
  if (/^(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff)$/.test(ext) || mime.startsWith('audio/')) {
    return { label: 'AUDIO', badge: shortBadge(ext, 'AUDIO'), kind: 'audio', icon: 'musical-notes', color: '#7c3aed', darkColor: '#a78bfa', extension: suffix };
  }
  if (/^(mp4|mov|mkv|webm|avi|m4v|flv|wmv|3gp)$/.test(ext) || mime.startsWith('video/')) {
    return { label: 'VIDEO', badge: shortBadge(ext, 'VIDEO'), kind: 'video', icon: 'play-circle', color: '#c2410c', darkColor: '#fb923c', extension: suffix };
  }
  if (/^(png|jpe?g|webp|gif|svg|heic|heif|avif|bmp|ico)$/.test(ext) || mime.startsWith('image/')) {
    return { label: 'IMG', badge: shortBadge(ext, 'IMG'), kind: 'image', icon: 'image', color: '#0369a1', darkColor: '#38bdf8', extension: suffix };
  }
  if (/^(docx?|odt|rtf)$/.test(ext) || /word|opendocument\.text/.test(mime)) {
    return { label: 'DOC', badge: 'DOC', kind: 'doc', icon: 'document-text', color: '#2563eb', darkColor: '#60a5fa', extension: suffix };
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    return { label: 'PDF', badge: 'PDF', kind: 'pdf', icon: 'document-text', color: '#dc2626', darkColor: '#f87171', extension: suffix };
  }
  if (/^(pptx?|odp)$/.test(ext) || /presentation|powerpoint/.test(mime)) {
    return { label: 'PPT', badge: 'PPT', kind: 'ppt', icon: 'easel', color: '#b45309', darkColor: '#fbbf24', extension: suffix };
  }
  if (/^(xlsx?|csv|ods)$/.test(ext) || /spreadsheet|excel|csv/.test(mime)) {
    return { label: 'XLS', badge: ext === 'csv' ? 'CSV' : 'XLS', kind: 'xls', icon: 'grid', color: '#15803d', darkColor: '#4ade80', extension: suffix };
  }
  if (/^(zip|rar|7z|gz|tar|bz2|xz)$/.test(ext) || /zip|compressed|tar/.test(mime)) {
    return { label: 'ZIP', badge: 'ZIP', kind: 'zip', icon: 'archive', color: '#a21caf', darkColor: '#e879f9', extension: suffix };
  }
  if (/^(js|jsx|ts|tsx|json|py|rs|go|java|c|cpp|h|html|css|sh|yaml|yml|xml|sql)$/.test(ext) || /json|javascript|xml/.test(mime)) {
    return { label: 'CODE', badge: 'CODE', kind: 'code', icon: 'code-slash', color: '#0f766e', darkColor: '#2dd4bf', extension: suffix };
  }
  if (/^(md|markdown|mdx)$/.test(ext) || mime === 'text/markdown') {
    return { label: 'MD', badge: 'MD', kind: 'md', icon: 'reader', color: '#4338ca', darkColor: '#818cf8', extension: suffix };
  }
  if (/^(txt|log)$/.test(ext) || mime.startsWith('text/')) {
    return { label: 'TXT', badge: 'TXT', kind: 'txt', icon: 'document-text-outline', color: '#475569', darkColor: '#94a3b8', extension: suffix };
  }
  return { label: 'FILE', badge: 'FILE', kind: 'file', icon: 'document-outline', color: '#475569', darkColor: '#94a3b8', extension: suffix };
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
