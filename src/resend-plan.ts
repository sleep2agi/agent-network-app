// #527(Vincent 10-04 09:49):「比如说图片发送失败啊？我点击重新发送它那个图片并不会去重新发送的」。
//
// 根因:未送达的回显一旦「从 outbox 重建」(桌面主窗口切到别的 agent 再切回、两栏重挂、主题/密度重 key、
// 杀 app 重开),outbox 里只有文字 + hadImage,图片丢了。打开会话时 restored 行又排在会话缓存前面
// (mergeMessagesNewestFirst 先到先得),连缓存里还带着图的那份也被顶掉。之后点「未送达 · 点击重试」,
// doSend 拿到的 imgs = [],发出去的只有「[附件] x.png」这行字 —— 图片没有重新发送。
//
// 这里是纯逻辑(不依赖 RN,bun 可测),ChatScreen 照这个组合:
//   - imagesForResend:从 outbox 条目重建气泡里的图(本进程原件 > 能活过重启的本地 uri > 已传上 hub 的文件);
//   - planResend:重试发什么。任何一张图拿不回来 ⇒ 不发(绝不发出只剩文字的半条);
//   - uploadForSend:上传阶段。已传上的那张复用 file_id(落在 outbox,重开后也认),没传上的才传,
//     传成功一张就记一张。
import { outboxRecordUpload, outboxUploadedAt, type OutboxEntry, type OutboxLiveImage, type OutboxUploaded } from './outbox';
import { runUploadQueue, uploadFailureSummary, type UploadState } from './upload-queue';

export interface ResendImage extends OutboxLiveImage {
  /** 本机已经没有原件、只剩 hub 上那一份时:预览走 /api/files/<id>(要带令牌),上传阶段直接复用。 */
  hubFileId?: string;
}

/** 从 outbox 条目重建这条消息的图(与气泡同序)。lost = 拿不回来的张数。 */
export function imagesForResend(
  entry: Pick<OutboxEntry, 'attachments' | 'hadImage'>,
  live: readonly OutboxLiveImage[] | undefined,
  serverUrl: string,
): { imgs: ResendImage[]; lost: number } {
  const atts = entry.attachments;
  // 旧版本落的盘:只知道「有图」,不知道几张、是什么 —— 一张也拿不回来。
  if (!atts) return { imgs: [], lost: entry.hadImage ? 1 : 0 };
  const imgs: ResendImage[] = [];
  let lost = 0;
  atts.forEach((a, i) => {
    const original = live?.[i];
    if (original) { imgs.push(original); return; }
    if (a.uri) {
      imgs.push({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize, width: a.width, height: a.height });
      return;
    }
    if (a.uploaded) {
      const id = a.uploaded.up.file_id;
      imgs.push({ uri: `${serverUrl}/api/files/${id}`, fileName: a.uploaded.name, mimeType: a.uploaded.mime, fileSize: a.uploaded.up.size, hubFileId: id });
      return;
    }
    lost++;
  });
  return { imgs, lost };
}

export type ResendPlan<I> =
  | { kind: 'send'; content: string; imgs: I[] }
  | { kind: 'images_lost'; lost: number }
  | { kind: 'nothing' };

/** 重试发什么。图拿不全就不发 —— 「重新发送」发出一条没图的字,比不发更糟(对方以为你只发了文字)。 */
export function planResend<I>(item: { _localId?: string; content?: string; _imgs?: I[]; _img?: I; _restoredNoImage?: boolean; _imagesLost?: number }): ResendPlan<I> {
  if (!item._localId) return { kind: 'nothing' };
  if (item._restoredNoImage || (item._imagesLost ?? 0) > 0) return { kind: 'images_lost', lost: Math.max(1, item._imagesLost ?? 0) };
  const imgs = item._imgs ?? (item._img ? [item._img] : []);
  const content = item.content ?? '';
  if (!content && !imgs.length) return { kind: 'nothing' };
  return { kind: 'send', content, imgs };
}

export interface UploadedPair<I> { img: I; up: OutboxUploaded }

/**
 * 上传阶段(并发 ≤ 3,与选择同序)。每张:outbox 里已记的 hub 文件 > 本进程 memo > 真上传;
 * 真上传成功立刻记进 outbox(下次重试、包括杀 app 重开后,都不再传这张)。
 * 返回 failed 时整条不发(调用方标未送达);否则 results 与 imgs 同序。
 */
export async function uploadForSend<I extends ResendImage>(args: {
  localId: string;
  imgs: readonly I[];
  /** prepare(压缩/读字节)+ 上传;抛错 = 这张没传上。 */
  upload: (img: I) => Promise<UploadedPair<I>>;
  memo?: { get: (img: I) => UploadedPair<I> | undefined; set: (img: I, done: UploadedPair<I>) => void };
  onState?: (index: number, state: UploadState) => void;
  concurrency?: number;
  fallbackError: string;
}): Promise<{ ok: true; uploaded: UploadedPair<I>[] } | { ok: false; summary: string }> {
  const { localId, imgs, upload, memo } = args;
  const run = await runUploadQueue(imgs, async (img, index) => {
    const prior = outboxUploadedAt(localId, index);
    if (prior) return { img: { ...img, fileName: prior.name, mimeType: prior.mime }, up: prior.up };
    // 只剩 hub 那份却没有记录(不该发生):本机没有字节可传,按这张失败处理,绝不拿 URL 当文件传。
    if (img.hubFileId) throw new Error('图片已不在本机');
    const hit = memo?.get(img);
    const done = hit ?? await upload(img);
    if (!hit) memo?.set(img, done);
    outboxRecordUpload(localId, index, done.img.fileName, done.img.mimeType, done.up);
    return done;
  }, { concurrency: args.concurrency, onState: args.onState });
  if (run.failed.length) {
    return { ok: false, summary: uploadFailureSummary(imgs.map(img => img.fileName), run.errors) ?? args.fallbackError };
  }
  return { ok: true, uploaded: run.results as UploadedPair<I>[] };
}
