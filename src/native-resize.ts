// 原生端(Android/iOS)发送前的「原图关闭 → 缩到最长边 2048、JPEG 0.8」。
//
// 这里只有流程,真正的解码/缩放/落盘由调用方注入(attach.ts 里接 expo-image-manipulator),
// 这样判定和兜底可以在 bun 里用假实现测,不需要真机。
import type { PickedImage } from './attach';
import { compressedFileName, isDraftImage, planCompression } from './image-draft';

export interface DecodedImage {
  /** 解码后(已按 EXIF 摆正)的像素尺寸 —— 竖拍照片的宽高以这里为准,不用 picker 报的。 */
  width: number;
  height: number;
}

export interface ResizeDeps<D extends DecodedImage> {
  /** 解码一次,拿到摆正后的尺寸;返回的句柄交给 resizeAndSave 复用,不重复解码。 */
  decode: (uri: string) => Promise<D>;
  resizeAndSave: (decoded: D, width: number, height: number, quality: number) => Promise<{ uri: string; width: number; height: number }>;
  /** 产物字节数;拿不到时返回 undefined。 */
  sizeOf: (uri: string) => Promise<number | undefined>;
  /** 释放原生图像内存(SharedRef.release)。 */
  release?: (decoded: D) => void;
}

/**
 * 原图 = 开、非图片、GIF、已经够小:原样返回(同一个对象)。
 * 否则缩放重编码;任何一步出错,或压完反而更大,都退回原图 —— 之后的 12MB 检查照常把关。
 */
export async function resizeForUpload<D extends DecodedImage>(
  img: PickedImage,
  original: boolean,
  deps: ResizeDeps<D>,
): Promise<PickedImage> {
  if (original || !isDraftImage(img) || /gif|svg/i.test(img.mimeType ?? '')) return img;
  let decoded: D | undefined;
  try {
    decoded = await deps.decode(img.uri);
    const plan = planCompression({
      original,
      mimeType: img.mimeType,
      fileName: img.fileName,
      fileSize: img.fileSize,
      width: decoded.width,
      height: decoded.height,
    });
    if (plan.kind !== 'resize') return img;
    const out = await deps.resizeAndSave(decoded, plan.width, plan.height, plan.quality);
    const size = await deps.sizeOf(out.uri);
    if (typeof size === 'number' && typeof img.fileSize === 'number' && size >= img.fileSize) return img;
    return {
      ...img,
      uri: out.uri,
      fileName: compressedFileName(img.fileName),
      mimeType: plan.mimeType,
      fileSize: size,
      width: out.width,
      height: out.height,
      webFile: undefined,
    };
  } catch {
    return img;
  } finally {
    if (decoded) {
      try { deps.release?.(decoded); } catch { /* 释放失败不影响发送 */ }
    }
  }
}

/**
 * 原生缩放一次只跑一张(iPad 发图闪退的首要嫌疑)。
 *
 * 每张图的 decode → resize → save 要把整张原图解成位图:48MP 的 HEIC ≈ 8064×6048×4B ≈ 195MB,
 * 再加 2048 边长的输出(≈ 16MB)。上传队列默认 3 路并发(upload-queue.ts),以前三张大图会同时解码
 * ⇒ 峰值 ≈ 3 × 195MB,iPad 上会被 jetsam 杀掉。排成一队后,任一时刻最多一张原图位图在内存里
 * (上一张的 ImageRef 在 resizeForUpload 的 finally 里 release 之后,下一张才开始 decode)。
 * 上传本身(读缩好的小文件、走网络)仍然 3 路并发。
 *
 * 一项失败不卡住队列:下一项照常开始,失败照常抛给调用方。
 */
export function createSerialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
