export type ImageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const imageMimeFromName = (name: string): string => {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.heic$/i.test(name)) return 'image/heic';
  return 'application/octet-stream';
};

export const sniffImageMime = (bytes: Uint8Array): string | undefined => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return 'image/gif';
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
};

export async function downloadImageObjectUrl(
  fetcher: ImageFetch,
  url: string,
  token: string,
  name: string,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
  hintedMime?: string,
): Promise<string> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let blob = await response.blob();
  if (!blob.size) throw new Error('empty image response');
  if (!blob.type.startsWith('image/') || blob.type === 'image/*') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const resolved = sniffImageMime(bytes)
      ?? (hintedMime && hintedMime !== 'image/*' ? hintedMime : undefined)
      ?? imageMimeFromName(name);
    if (!resolved.startsWith('image/')) throw new Error('response is not a supported image');
    blob = new Blob([bytes], { type: resolved });
  }
  return createObjectUrl(blob);
}

/** Save an already authenticated blob URL. The bearer credential was used
 * only for the fetch that created this URL; neither the DOM nor the browser's
 * download manager ever receives it. */
export function saveImageObjectUrl(
  objectUrl: string,
  name: string,
  doc: Pick<Document, 'createElement'> = document,
): void {
  const anchor = doc.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.click();
}
