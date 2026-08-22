import type { PickedImage } from './attach';

type ClipboardFileItem = {
  kind?: string;
  getAsFile?: () => File | null;
};

export const isTauriDesktop = (): boolean =>
  typeof window !== 'undefined' && !!(globalThis as any).__TAURI_INTERNALS__;

/** Convert the first desktop clipboard image/file into the existing
 * attachment model. Text-only content returns null, preserving native paste. */
export const attachmentFromClipboard = (
  items: ArrayLike<ClipboardFileItem> | null | undefined,
): PickedImage | null => {
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.kind !== 'file') continue;
    const file = item.getAsFile?.();
    if (!file) continue;
    return {
      uri: URL.createObjectURL(file),
      fileName: file.name || (file.type.startsWith('image/') ? 'pasted-image.png' : 'pasted-file'),
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      webFile: file,
    };
  }
  return null;
};

export const releaseClipboardAttachment = (attachment: PickedImage | null) => {
  if (attachment?.webFile && attachment.uri.startsWith('blob:')) URL.revokeObjectURL(attachment.uri);
};
