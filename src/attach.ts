import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { appFetch } from './app-fetch';
import { compressedFileName, isDraftImage, pickerQualityFor, planCompression } from './image-draft';

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
  /** Native only: picked with quality 1 (原图, original bytes) vs 0.8 (re-encoded).
   *  undefined on web, where compression happens at send time instead. */
  pickedOriginal?: boolean;
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

/** 「相册」多选(Vincent 2026-09-26「像微信一样支持选择多张图片」)。
 *  - Android:expo-image-picker 56 走 androidx PickMultipleVisualMedia(系统 Photo Picker),
 *    `selectionLimit` 生效;`orderedSelection` 在 Android 版本里同样透传给
 *    PickVisualMediaRequest.setOrderedSelection(类型注释只写了 ios 15+,但 Kotlin 端读它),
 *    Photo Picker 支持时显示 1、2、3… 序号徽标并按点选顺序返回。
 *  - iOS 14+:PHPicker,selectionLimit 生效,orderedSelection 需 iOS 15+。
 *  - web/桌面:<input type=file multiple>;浏览器不认 selectionLimit,多出的在 addToDraft 截掉。
 *  `limit` = 本次还能选几张(9 减去草稿里已有的图)。原生端按 `original` 选 quality:
 *  1 = 原字节(Android RawImageExporter),0.8 = JPEG 重编码(见 image-draft.pickerQualityFor)。 */
export const pickImages = async (limit: number, original: boolean): Promise<PickedImage[]> => {
  if (limit <= 0) return [];
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: pickerQualityFor(original),
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
    pickedOriginal: Platform.OS === 'web' ? undefined : original,
    webFile: (a as any).file,
  }));
};

/** web/桌面端发送前按原图开关压缩(canvas 重采样,最长边 2048、JPEG 0.8)。
 *  原生端的压缩已在选图时由 picker 的 quality 完成,这里原样返回。
 *  压缩失败或压完反而更大:退回原文件(之后的 12MB 检查照常把关)。 */
export const prepareForUpload = async (img: PickedImage, original: boolean): Promise<PickedImage> => {
  if (Platform.OS !== 'web' || original || !img.webFile || !isDraftImage(img)) return img;
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

export const uploadImage = async (cfg: HubConfig, img: PickedImage): Promise<UploadedFile> => {
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
    const res = await appFetch(`${cfg.serverUrl}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: form,
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } else {
    const res = await FileSystem.uploadAsync(`${cfg.serverUrl}/api/upload`, img.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: img.mimeType,
      parameters: {},
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
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
