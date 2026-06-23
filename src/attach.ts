import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

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
  };
};

/** Ask for media-library permission and let the user pick one image. */
export const pickImage = async (): Promise<PickedImage | null> => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return {
    uri: a.uri,
    fileName: a.fileName ?? 'image.jpg',
    mimeType: a.mimeType ?? 'image/jpeg',
    fileSize: a.fileSize,
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
    form.append('file', { uri: img.uri, name: img.fileName, type: img.mimeType } as any);
    const res = await fetch(`${cfg.serverUrl}/api/upload`, {
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
