// 「像微信一样支持选择多张图片」(Vincent 2026-09-26) —— composer 草稿的纯模型。
//
// 这里没有 React、没有 expo:只决定「草稿里能放什么、按什么顺序、要不要压缩、
// 能不能发」,UI(ChatScreen)和选图(attach.ts)只照着它做。
import type { PickedImage } from './attach';

/** 微信的上限:一次最多 9 张图。跨多次「相册」累计,不是单次。 */
export const MAX_DRAFT_IMAGES = 9;
/** Hub validateAttachments 的硬上限(server/src/uploads.ts:`input.length > 20`)。 */
export const MAX_DRAFT_ATTACHMENTS = 20;
/** Hub /api/upload 单文件上限(server/src/uploads.ts MAX_UPLOAD_BYTES = 12 MiB)。 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** 压缩档(原图关闭时):最长边 ~2048px、JPEG 质量 0.8。 */
export const COMPRESS_MAX_EDGE = 2048;
export const COMPRESS_QUALITY = 0.8;
/** 边长已在上限内、体积也不大的图不值得重编码(重编码可能反而更大,还会糊掉截图里的字)。 */
export const COMPRESS_SKIP_BYTES = 1.5 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i;

export const isDraftImage = (a: Pick<PickedImage, 'fileName' | 'mimeType'>): boolean =>
  (a.mimeType ?? '').startsWith('image/') || IMAGE_EXT.test(a.fileName ?? '');

export const draftImageCount = (draft: readonly PickedImage[]): number => draft.filter(isDraftImage).length;

/** 「相册」这次最多还能选几张(传给系统选图器的 selectionLimit)。0 = 已满,不要打开选图器。 */
export const remainingImageSlots = (draft: readonly PickedImage[]): number =>
  Math.max(0, Math.min(MAX_DRAFT_IMAGES - draftImageCount(draft), MAX_DRAFT_ATTACHMENTS - draft.length));

export interface DraftAddResult {
  next: PickedImage[];
  accepted: PickedImage[];
  rejected: PickedImage[];
  /** 被拒时给用户的一句 toast;全收下时为 null。 */
  notice: string | null;
}

/**
 * 按 incoming 的顺序(= 系统选图器的选择顺序)追加。超出 9 张图 / 20 个附件的部分被拒,
 * 不打乱已收下的顺序,也不挤掉草稿里已有的。
 */
export const addToDraft = (draft: readonly PickedImage[], incoming: readonly PickedImage[]): DraftAddResult => {
  const next = [...draft];
  const accepted: PickedImage[] = [];
  const rejected: PickedImage[] = [];
  let imageOverflow = 0;
  let totalOverflow = 0;
  let images = draftImageCount(draft);
  for (const item of incoming) {
    if (next.length >= MAX_DRAFT_ATTACHMENTS) {
      rejected.push(item);
      totalOverflow++;
      continue;
    }
    if (isDraftImage(item)) {
      if (images >= MAX_DRAFT_IMAGES) {
        rejected.push(item);
        imageOverflow++;
        continue;
      }
      images++;
    }
    next.push(item);
    accepted.push(item);
  }
  const notices: string[] = [];
  if (imageOverflow) notices.push(`最多选择 ${MAX_DRAFT_IMAGES} 张图片，已忽略 ${imageOverflow} 张`);
  if (totalOverflow) notices.push(`一条消息最多 ${MAX_DRAFT_ATTACHMENTS} 个附件，已忽略 ${totalOverflow} 个`);
  return { next, accepted, rejected, notice: notices.length ? notices.join('；') : null };
};

export const removeFromDraft = (draft: readonly PickedImage[], uri: string) => {
  const index = draft.findIndex(item => item.uri === uri);
  if (index < 0) return { next: [...draft], removed: null as PickedImage | null };
  return { next: [...draft.slice(0, index), ...draft.slice(index + 1)], removed: draft[index] };
};

/** 缩略图条上的计数,如「3/9 张图片」「2/9 张图片 · 1 个文件」。 */
export const draftCountLabel = (draft: readonly PickedImage[]): string => {
  const images = draftImageCount(draft);
  const files = draft.length - images;
  const parts: string[] = [];
  if (images) parts.push(`${images}/${MAX_DRAFT_IMAGES} 张图片`);
  if (files) parts.push(`${files} 个文件`);
  return parts.join(' · ');
};

export const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

/** 超过 Hub 12MB 上限时的报错;不超(或体积未知)返回 null。 */
export const oversizeMessage = (img: Pick<PickedImage, 'fileName' | 'fileSize'>): string | null =>
  typeof img.fileSize === 'number' && img.fileSize > MAX_UPLOAD_BYTES
    ? `「${img.fileName}」${formatMb(img.fileSize)}，超过 12MB 上限`
    : null;

export type CompressPlan =
  | { kind: 'keep'; reason: 'original' | 'not-image' | 'animated-or-vector' | 'small-enough' | 'unknown-size' }
  | { kind: 'resize'; width: number; height: number; quality: number; mimeType: 'image/jpeg' };

/**
 * 原图开关的决策(纯函数,web/桌面端在发送前据此用 canvas 重编码)。
 * - 原图 = 开:永远 keep,发原字节。
 * - GIF/SVG:keep(重编码会丢动画/矢量)。
 * - 最长边 ≤ 2048 且 ≤ 1.5MB:keep。
 * - 否则等比缩到最长边 ≤ 2048,JPEG 0.8。
 */
export const planCompression = (input: {
  original: boolean;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
}): CompressPlan => {
  if (input.original) return { kind: 'keep', reason: 'original' };
  if (!isDraftImage({ fileName: input.fileName ?? '', mimeType: input.mimeType ?? '' })) return { kind: 'keep', reason: 'not-image' };
  if (/gif|svg/i.test(input.mimeType ?? '') || /\.(gif|svg)$/i.test(input.fileName ?? '')) return { kind: 'keep', reason: 'animated-or-vector' };
  const w = input.width ?? 0;
  const h = input.height ?? 0;
  if (!(w > 0 && h > 0)) return { kind: 'keep', reason: 'unknown-size' };
  const longest = Math.max(w, h);
  if (longest <= COMPRESS_MAX_EDGE && (input.fileSize ?? 0) <= COMPRESS_SKIP_BYTES) return { kind: 'keep', reason: 'small-enough' };
  const scale = Math.min(1, COMPRESS_MAX_EDGE / longest);
  return {
    kind: 'resize',
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    quality: COMPRESS_QUALITY,
    mimeType: 'image/jpeg',
  };
};

/**
 * 选图一律 quality 1(Android 上走 RawImageExporter,逐字节复制原文件),原图开关在**发送时**
 * 才生效:原生端用 expo-image-manipulator、web/桌面用 canvas,规则同 planCompression。
 * 所以草稿里的图在点「发送」之前随时可以切原图,不用重选。
 */
export const PICKER_QUALITY = 1;

/** 这张图会不会在上传前被缩小(决定要不要按原始体积拦 12MB)。 */
export const willCompressBeforeUpload = (
  img: Pick<PickedImage, 'fileName' | 'mimeType' | 'webFile'>,
  opts: { original: boolean; platform: string },
): boolean =>
  !opts.original &&
  isDraftImage(img) &&
  !/gif|svg/i.test(img.mimeType ?? '') &&
  !/\.(gif|svg)$/i.test(img.fileName ?? '') &&
  (opts.platform !== 'web' || !!img.webFile);

/** 压缩后的文件名:换成 .jpg,保持原主干名。 */
export const compressedFileName = (fileName: string): string => {
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.jpg`;
};

/**
 * 点「发送」前的拦截:返回要提示的一句话,null = 可以发。
 * `willCompressLater(img)` 为 true 的图(原图关闭)会在上传前缩小,这里不预判它的体积。
 */
export const sendBlocker = (
  draft: readonly PickedImage[],
  willCompressLater: (img: PickedImage) => boolean,
): string | null => {
  if (draftImageCount(draft) > MAX_DRAFT_IMAGES) return `最多选择 ${MAX_DRAFT_IMAGES} 张图片`;
  if (draft.length > MAX_DRAFT_ATTACHMENTS) return `一条消息最多 ${MAX_DRAFT_ATTACHMENTS} 个附件`;
  const oversized = draft
    .filter(img => !willCompressLater(img))
    .map(oversizeMessage)
    .filter((m): m is string => !!m);
  if (!oversized.length) return null;
  return `${oversized.join('；')}。请移除后再发送`;
};
