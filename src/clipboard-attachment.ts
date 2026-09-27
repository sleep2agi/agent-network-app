import type { PickedImage } from './attach';
import { attachmentsFromFiles, filesFromTransfer } from './desktop-file-intake';

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
): PickedImage | null => attachmentsFromClipboard(items)[0] ?? null;

/** Every file on the clipboard (several copied files / screenshots), same
 * conversion as the ＋ picker and drag-and-drop (desktop-file-intake.ts). */
export const attachmentsFromClipboard = (
  items: ArrayLike<ClipboardFileItem> | null | undefined,
): PickedImage[] => attachmentsFromFiles(filesFromTransfer({ items }));

export const releaseClipboardAttachment = (attachment: PickedImage | null) => {
  if (attachment?.webFile && attachment.uri.startsWith('blob:')) URL.revokeObjectURL(attachment.uri);
};

/** Queue pasted files by object/URI identity, not by filename. Clipboard
 * screenshots commonly all arrive as `image.png`; equal names are valid. */
export const appendAttachmentQueue = (current: PickedImage[], next: PickedImage, max = 20): PickedImage[] =>
  current.length >= max ? current : [...current, next];
