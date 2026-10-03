import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { appFetch } from './app-fetch';
import { withDeadline } from './deadline';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { compressedFileName, isDraftImage, PICKER_QUALITY, planCompression } from './image-draft';
import { createSerialQueue, resizeForUpload } from './native-resize';
import { attachmentFromFile } from './desktop-file-intake';
import { uploadUrlFor, type UploadOptions } from './upload-url';

// Image/file attachments (#220 roadmap ③) — fully wired end to end:
// pick → upload → attach (see uploadImage below). The hub's
// POST /api/upload (sleep2agi/agent-network#221) went live 2026-06-11,
// so this flag is ON. It originally existed to keep a stubbed,
// half-wired upload UI away from Vincent (quality bar, tg 721); now that
// the real upload path is implemented the gate is effectively permanent
// — kept as a single explicit kill-switch should the endpoint regress.
export const ATTACH_ENABLED = true;

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  /** Pixel size when the picker reports it (multi-image compression decision). */
  width?: number;
  height?: number;
  /** Browser/Tauri clipboard and picker payload. Keeping the original Blob
   * lets FormData upload the bytes instead of serializing a blob: URL. */
  webFile?: Blob;
}

/** Any file (≤12MB server cap). Same shape as images — the upload and
 *  attachment paths are format-agnostic. */
export const pickDocument = async (): Promise<PickedImage | null> => {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return {
    uri: a.uri,
    fileName: a.name ?? 'file.bin',
    mimeType: a.mimeType ?? 'application/octet-stream',
    fileSize: a.size ?? undefined,
    webFile: (a as any).file,
  };
};

/** 桌面「＋」:系统文件选择器,多选、任意类型(图片也在里面)。不读 base64(大文件不白读一遍);
 *  web / Tauri 上每个结果带原始 File,转成草稿走 desktop-file-intake 同一个出口(拖放、粘贴也用它)。 */
export const pickFiles = async (): Promise<PickedImage[]> => {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true, base64: false });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map(a => {
    const file = (a as any).file as File | undefined;
    if (file) return attachmentFromFile(file);
    return { uri: a.uri, fileName: a.name ?? 'file.bin', mimeType: a.mimeType ?? 'application/octet-stream', fileSize: a.size ?? undefined };
  });
};

/** 「相册」多选(Vincent 2026-09-26「像微信一样支持选择多张图片」)。
 *  - Android:expo-image-picker 56 走 androidx PickMultipleVisualMedia(系统 Photo Picker),
 *    `selectionLimit` 生效;`orderedSelection` 在 Android 版本里同样透传给
 *    PickVisualMediaRequest.setOrderedSelection(类型注释只写了 ios 15+,但 Kotlin 端读它),
 *    Photo Picker 支持时显示 1、2、3… 序号徽标并按点选顺序返回。
 *  - iOS 14+:PHPicker,selectionLimit 生效,orderedSelection 需 iOS 15+。
 *  - web/桌面:<input type=file multiple>;浏览器不认 selectionLimit,多出的在 addToDraft 截掉。
 *  `limit` = 本次还能选几张(9 减去草稿里已有的图)。一律按 quality 1 取原字节,
 *  原图开关在发送时由 prepareForUpload 决定(见 image-draft.PICKER_QUALITY)。 */
export const pickImages = async (limit: number): Promise<PickedImage[]> => {
  if (limit <= 0) return [];
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: PICKER_QUALITY,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.length) return [];
  // 顺序 = 选择顺序;不排序、不去重。不在这里截断:web 不认 selectionLimit,多出来的交给
  // addToDraft 拒收并弹「最多选择 9 张」—— 在这里 slice 会静默丢图,用户不知道少了哪张。
  return result.assets.map((a, index) => ({
    uri: a.uri,
    fileName: a.fileName ?? `image-${index + 1}.jpg`,
    mimeType: a.mimeType ?? 'image/jpeg',
    fileSize: a.fileSize,
    width: a.width,
    height: a.height,
    webFile: (a as any).file,
  }));
};

/** 原生端(Android/iOS):expo-image-manipulator 解码(已按 EXIF 摆正)→ 缩放 → JPEG 落盘。
 *
 *  🔴 `ImageManipulator.manipulate()` 只能传 uri 字符串,绝不能传 ImageRef(renderAsync 的结果)。
 *  iOS 原生签名是 `Either<URL, SharedRef<UIImage>>`,expo-modules-core 先按 URL 试转:对 ImageRef
 *  调 `JavaScriptValue.getAny()`,遍历属性碰到 `saveAsync` 这类函数 → `FatalError.unimplemented()`
 *  → SIGTRAP 闪退,JS 的 try/catch 接不住。TestFlight 崩溃日志(0.2.178 build 70 iPhone、
 *  build 28 iPad)两份都是这一条栈。所以 decode 只量尺寸、随即释放;缩放从 uri 重新解码一次
 *  (串行队列保证同一时刻只有一张原图位图)。 */
type NativeDecoded = { uri: string; width: number; height: number };
const nativeResizeDeps = {
  decode: async (uri: string): Promise<NativeDecoded> => {
    const context = ImageManipulator.manipulate(uri);
    try {
      const ref = await context.renderAsync();
      try {
        return { uri, width: ref.width, height: ref.height };
      } finally {
        ref.release();
      }
    } finally {
      context.release(); // context 也攥着整张解码位图,不释放就要等 GC
    }
  },
  resizeAndSave: async (decoded: NativeDecoded, width: number, height: number, quality: number) => {
    const context = ImageManipulator.manipulate(decoded.uri).resize({ width, height });
    try {
      const resized: ImageRef = await context.renderAsync();
      try {
        const saved = await resized.saveAsync({ compress: quality, format: SaveFormat.JPEG });
        return { uri: saved.uri, width: saved.width, height: saved.height };
      } finally {
        resized.release();
      }
    } finally {
      context.release();
    }
  },
  sizeOf: async (uri: string) => {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof (info as any).size === 'number' ? (info as any).size : undefined;
  },
};
/** 原生端一次只缩一张图:限住原图位图的内存峰值(见 native-resize.createSerialQueue)。 */
const nativeResizeSerial = createSerialQueue();

/** 发送前按原图开关压缩(最长边 2048、JPEG 0.8;规则见 image-draft.planCompression)。
 *  原生端走 expo-image-manipulator(native-resize.ts),web/桌面走 canvas 重采样。
 *  压缩失败或压完反而更大:退回原文件(之后的 12MB 检查照常把关)。 */
export const prepareForUpload = async (img: PickedImage, original: boolean): Promise<PickedImage> => {
  if (Platform.OS !== 'web') return nativeResizeSerial(() => resizeForUpload(img, original, nativeResizeDeps));
  if (original || !img.webFile || !isDraftImage(img)) return img;
  try {
    const g: any = globalThis as any;
    if (typeof g.createImageBitmap !== 'function' || typeof g.document === 'undefined') return img;
    const bitmap = await g.createImageBitmap(img.webFile, { imageOrientation: 'from-image' });
    const plan = planCompression({
      original,
      mimeType: img.mimeType,
      fileName: img.fileName,
      fileSize: img.fileSize ?? img.webFile.size,
      width: bitmap.width,
      height: bitmap.height,
    });
    if (plan.kind !== 'resize') { bitmap.close?.(); return img; }
    const canvas = g.document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return img; }
    ctx.fillStyle = '#fff'; // JPEG 没有透明通道:透明 PNG 铺白底,别变成黑底
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    bitmap.close?.();
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, plan.mimeType, plan.quality));
    if (!blob || blob.size >= (img.fileSize ?? img.webFile.size)) return img;
    return {
      ...img,
      fileName: compressedFileName(img.fileName),
      mimeType: plan.mimeType,
      fileSize: blob.size,
      width: plan.width,
      height: plan.height,
      webFile: blob,
    };
  } catch {
    return img;
  }
};

/** 「＋」 panel 拍照: take one photo with the system camera. Same PickedImage shape
 *  as pickImage. CAMERA is already declared by expo-image-picker's own
 *  AndroidManifest (merged at build); iOS text comes from the app.json plugin. */
export const pickCameraPhoto = async (): Promise<PickedImage | null> => {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return {
    uri: a.uri,
    fileName: a.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: a.mimeType ?? 'image/jpeg',
    fileSize: a.fileSize,
    webFile: (a as any).file,
  };
};

import { HubConfig } from './api';

// Frozen contract from sleep2agi/agent-network#221 (commit 72fc790):
// POST /api/upload (multipart, single `file` field, ≤12MiB, Bearer)
// → { ok, file_id, path, url, size, mime }; errors carry { ok:false,
// error, message } with 400/401/411/413/415/429/500 statuses.
export interface UploadedFile {
  file_id: string;
  /** Absolute path on the hub host — agents on that machine can Read it. */
  path: string;
  url: string;
  size: number;
  mime: string;
}

const UPLOAD_ERROR_HINTS: Record<string, string> = {
  payload_too_large: '图片超过 12MB 上限',
  rate_limited: '上传太频繁，稍后再试',
  unauthorized: '登录已失效，请重新登录',
};

// #518 —— 附件上传的硬上限(含读完响应)。以前没有任何上限:hub 重启 / 隧道半开时上传永远 await,
// 那条消息停在「发送中…」、sendTask 根本没机会调用。与 pooled_fetch 的整体上限同量级(src-tauri hub_http.rs
// REQUEST_TIMEOUT 300 s 是给卡死的连接兜底);这里取 120 s:大图走慢链路也够,卡死时两分钟内出「未送达」。
export const UPLOAD_DEADLINE_MS = 120_000;
let uploadDeadlineMs = UPLOAD_DEADLINE_MS;
/** Test-only. No args = production value. */
export function __setUploadDeadlineForTest(ms: number = UPLOAD_DEADLINE_MS): void { uploadDeadlineMs = ms; }
const uploadTimeoutMessage = () => `上传 ${Math.round(uploadDeadlineMs / 1000)} 秒内没有完成`;

export const uploadImage = async (cfg: HubConfig, img: PickedImage, opts: UploadOptions = {}): Promise<UploadedFile> => {
  const uploadUrl = uploadUrlFor(cfg.serverUrl, opts);
  // The hub REQUIRES a Content-Length header (411 otherwise, per #221).
  // RN's fetch streams FormData chunked on Android — Vincent's first
  // image send died on exactly that (tg 737) — so native goes through
  // FileSystem.uploadAsync, which does a proper native multipart upload.
  let data: any;
  let status: number;
  if (Platform.OS === 'web') {
    const form = new FormData();
    if (img.webFile) form.append('file', img.webFile, img.fileName);
    else form.append('file', { uri: img.uri, name: img.fileName, type: img.mimeType } as any);
    const ctrl = new AbortController();
    const got = await withDeadline(
      (async () => {
        const res = await appFetch(uploadUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.token}` },
          body: form,
          signal: ctrl.signal,
        });
        return { status: res.status, data: await res.json().catch(() => null) };
      })(),
      uploadDeadlineMs,
      () => null,
    );
    if (!got) {
      ctrl.abort();
      throw new Error(uploadTimeoutMessage());
    }
    status = got.status;
    data = got.data;
  } else {
    // uploadAsync 不能中途取消;到点不再等它(结果丢弃),气泡转「未送达 · 重试」。
    const res = await withDeadline(FileSystem.uploadAsync(uploadUrl, img.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: img.mimeType,
      parameters: {},
      headers: { Authorization: `Bearer ${cfg.token}` },
    }), uploadDeadlineMs, () => null);
    if (!res) throw new Error(uploadTimeoutMessage());
    status = res.status;
    try {
      data = JSON.parse(res.body);
    } catch {
      data = null;
    }
  }
  if (!data?.ok) {
    const code = String(data?.error ?? `HTTP ${status}`);
    throw new Error(UPLOAD_ERROR_HINTS[code] ?? code);
  }
  return { file_id: data.file_id, path: data.path, url: data.url, size: data.size, mime: data.mime };
};

/** Agent runtimes don't surface meta.attachments to the agent yet
 *  (Vincent tg 744: 副指挥 couldn't see the image), so spell the file
 *  location out in the message text — hub-host agents can Read the
 *  absolute path directly, remote ones can GET the API URL. */
export const attachmentTextHint = (img: PickedImage, up: UploadedFile): string =>
  `\n\n📎 附件 ${img.fileName}（${up.mime}）\n服务器路径: ${up.path}\nAPI: GET ${up.url}`;

/** Attachment entry for POST /api/task (validateAttachments schema). */
export const toTaskAttachment = (img: PickedImage, up: UploadedFile) => ({
  type: 'file' as const,
  file_id: up.file_id,
  name: img.fileName,
  mime: up.mime,
  size: up.size,
});
