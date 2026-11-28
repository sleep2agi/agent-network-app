import { appendHubProxyParam, resolveDirectDownloadTarget } from './direct-storage';
import { isTauriDesktop } from './desktop-download';
import { isHarmonyShell } from './harmony-bridge';

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
  let response: Response | null = null;
  const target = await resolveDirectDownloadTarget({
    fileUrl: url,
    token,
    isPlainBrowser: !isTauriDesktop() && !isHarmonyShell(),
    fetchImpl: fetcher,
  });
  if (target.kind === 'direct') {
    const directCandidates = target.fallbackUrl ? [target.url, target.fallbackUrl] : [target.url];
    for (const directUrl of directCandidates) {
      try {
        const directRes = await fetcher(directUrl, { headers: target.headers });
        if (directRes.ok) { response = directRes; break; }
        try { await directRes.body?.cancel?.(); } catch { /* ignore */ }
      } catch {
        /* CORS or direct network error → try regional fallback or Hub proxy */
      }
    }
  }
  if (!response) {
    const hubFallbackUrl = target.kind === 'direct' ? appendHubProxyParam(url) : url;
    response = await fetcher(hubFallbackUrl, { headers: { Authorization: `Bearer ${token}` } });
  }
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
