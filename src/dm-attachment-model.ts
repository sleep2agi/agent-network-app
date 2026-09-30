// 私信里的附件(owner 2026-09-30「给人好像发不了图片」)。
//
// 私信和 agent 会话走同一条附件管线:草稿(image-draft)→ 上传队列(upload-queue,/api/upload)→
// 发送时带 file_id。这里只放私信特有的纯逻辑 —— 把一条私信 / 一条还在发的本地消息摊成可画的附件,
// 以及只有附件时通知里显示什么。没有 react-native,ck 测试直接跑(dm-attachment-model.test.ts)。
import type { PickedImage } from './attach';
import { isDraftImage } from './image-draft';
import { dmAttachments, isImageAttachment, type DmMessage } from './human-dm';

/** 与 ChatScreen 的 AttachmentView 同形状的子集:image-viewer-model.viewerImageFor 直接吃它。 */
export type DmAttachmentView = {
  key: string;
  name: string;
  isImage: boolean;
  uri: string;
  /** hub 上的文件要带令牌取;本地草稿(file: / blob:)不用。 */
  needsAuth: boolean;
  mime?: string;
  size?: number;
};

/** 已送达的私信:附件都在 hub 上(/api/files/<id>,要鉴权)。 */
export function dmAttachmentViews(msg: Pick<DmMessage, 'meta_json'>, serverUrl: string): DmAttachmentView[] {
  const seen = new Set<string>();
  const out: DmAttachmentView[] = [];
  for (const a of dmAttachments(msg)) {
    if (seen.has(a.file_id)) continue;
    seen.add(a.file_id);
    out.push({
      key: a.file_id,
      name: a.name || a.file_id,
      isImage: isImageAttachment(a),
      uri: `${serverUrl}/api/files/${a.file_id}`,
      needsAuth: true,
      mime: a.mime,
      size: typeof a.size === 'number' ? a.size : undefined,
    });
  }
  return out;
}

/** 还没送达的那条(乐观气泡):画本地草稿,和微信一样点了发送就先看到图。 */
export function localAttachmentViews(files: readonly PickedImage[]): DmAttachmentView[] {
  return files.map(f => ({
    key: f.uri,
    name: f.fileName,
    isImage: isDraftImage(f),
    uri: f.uri,
    needsAuth: false,
    mime: f.mimeType,
    size: f.fileSize,
  }));
}

/** 只有附件、没有文字的消息在通知 / 预览里的一行:全是图 →「[图片]」,否则「[文件]」。空列表 → null。 */
export function attachmentPreviewText(list: readonly { mime?: string; name?: string }[]): string | null {
  if (!list.length) return null;
  return list.every(a => isImageAttachment(a)) ? '[图片]' : '[文件]';
}

/** SSE 推送里的 meta.attachments(hub human-dm.ts 带上的)→ 预览一行;没有 / 不合法 → null。 */
export function eventAttachmentPreview(meta: unknown): string | null {
  const list = meta && typeof meta === 'object' ? (meta as { attachments?: unknown }).attachments : undefined;
  if (!Array.isArray(list)) return null;
  const valid = list.filter((a): a is { file_id: string; mime?: string; name?: string } =>
    !!a && typeof a === 'object' && typeof (a as { file_id?: unknown }).file_id === 'string' && !!(a as { file_id: string }).file_id);
  return attachmentPreviewText(valid);
}
