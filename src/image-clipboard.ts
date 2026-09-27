// Ctrl/⌘+C in the 「图片预览」 window: put the image itself (not a link) on the system clipboard.
//
// Desktop (Tauri) → clipboard-manager's writeImage with PNG file bytes (Rust decodes them; tauri is
// built with `image-png`, and permission `clipboard-manager:allow-write-image` is granted in
// capabilities/default.json). JPEG/WebP/GIF are re-encoded to PNG through a canvas first: PNG is the
// one format every OS clipboard takes. If the plugin call fails, the web Clipboard API is tried —
// WebView2 and WKWebView both accept an image/png ClipboardItem from a key/click handler.

export type ClipboardRoute = 'tauri' | 'web';

export type ClipboardDeps = {
  tauri: boolean;
  tauriWriteImage: (png: Uint8Array) => Promise<void>;
  webWrite: ((png: Blob) => Promise<void>) | null;
  toPng: (blob: Blob) => Promise<Blob>;
};

let testDeps: ClipboardDeps | undefined;
/** Tests: inject the platform + both writers; undefined restores the real ones. */
export function __setClipboardDeps(next: ClipboardDeps | undefined): void { testDeps = next; }

async function canvasPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

function realDeps(): ClipboardDeps {
  const g = globalThis as any;
  const clip = g.navigator?.clipboard;
  return {
    tauri: !!g.__TAURI_INTERNALS__,
    tauriWriteImage: async png => { const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager'); await writeImage(png); },
    webWrite: clip?.write && typeof g.ClipboardItem === 'function'
      ? png => clip.write([new g.ClipboardItem({ 'image/png': png })])
      : null,
    toPng: canvasPng,
  };
}

/** Copy the image; resolves with the route that worked, rejects if none did. */
export async function copyImageBlob(blob: Blob): Promise<ClipboardRoute> {
  const d = testDeps ?? realDeps();
  const png = await d.toPng(blob);
  let tauriError: unknown;
  if (d.tauri) {
    try {
      await d.tauriWriteImage(new Uint8Array(await png.arrayBuffer()));
      return 'tauri';
    } catch (error) {
      tauriError = error;
      console.warn('[image-clipboard] tauri writeImage failed, trying the web clipboard', error);
    }
  }
  if (d.webWrite) {
    await d.webWrite(png);
    return 'web';
  }
  throw tauriError ?? new Error('no clipboard available');
}
