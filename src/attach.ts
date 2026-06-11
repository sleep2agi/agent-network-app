import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

// Image attachment groundwork (#220 roadmap ③). The picker/permission
// chain is complete; upload stays stubbed until the hub ships
// POST /api/upload (sleep2agi/agent-network#221) and SDK马 posts the
// final response contract there. ATTACH_ENABLED stays false so no
// half-wired UI ever reaches Vincent (quality bar, tg 721).
export const ATTACH_ENABLED = true; // hub /api/upload live since 2026-06-11 (#221)

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
  const form = new FormData();
  // RN FormData file part: {uri, name, type}; web Fetch accepts Blob —
  // RN's native fetch handles the uri form on device.
  form.append('file', { uri: img.uri, name: img.fileName, type: img.mimeType } as any);
  const res = await fetch(`${cfg.serverUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    const code = String(data?.error ?? `HTTP ${res.status}`);
    throw new Error(UPLOAD_ERROR_HINTS[code] ?? code);
  }
  return { file_id: data.file_id, url: data.url, size: data.size, mime: data.mime };
};

/** Attachment entry for POST /api/task (validateAttachments schema). */
export const toTaskAttachment = (img: PickedImage, up: UploadedFile) => ({
  type: 'file' as const,
  file_id: up.file_id,
  name: img.fileName,
  mime: up.mime,
  size: up.size,
});
