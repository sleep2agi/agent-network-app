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
  else if (/^(txt|md|log)$/.test(ext) || mime.startsWith('text/')) { label = 'TXT'; }
  return { label, color, extension: extension ? `.${extension}` : '' };
}
