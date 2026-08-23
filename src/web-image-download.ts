export type ImageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const imageMimeFromName = (name: string): string => {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.heic$/i.test(name)) return 'image/heic';
  return 'application/octet-stream';
};

export async function downloadImageObjectUrl(
  fetcher: ImageFetch,
  url: string,
  token: string,
  name: string,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
): Promise<string> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let blob = await response.blob();
  if (!blob.size) throw new Error('empty image response');
  if (!blob.type.startsWith('image/')) blob = new Blob([blob], { type: imageMimeFromName(name) });
  return createObjectUrl(blob);
}
