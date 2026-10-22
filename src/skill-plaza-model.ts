// Public, browse-only SkillHub catalogue. Based on app PR #471, adapted to
// current settings; never a node's installed skills and never an installer.
import { Sha256 } from './sha256';

export const SKILL_CATALOG_URL = 'https://www.anet.sh/skillhub/catalog.json';
export const SKILL_BODY_MAX_BYTES = 256 * 1024;
const CATALOG_MAX_BYTES = 1024 * 1024;
const SLUG = /^[A-Za-z0-9._-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/i;

export type PublicSkill = {
  slug: string; name: string; description: string; version: string;
  tags: readonly string[]; license: string; publisherName: string;
  contentUrl: string; contentSha256: string;
};
export type SkillFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; url?: string; redirected?: boolean;
  headers?: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
}>;
export class SkillPlazaError extends Error {
  constructor(public readonly code: 'catalog' | 'body' | 'json' | 'tooLarge' | 'mismatch' | 'digest', public readonly status?: number) {
    super(code);
  }
}
const clip = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export function resolveContentUrl(catalogUrl: string, contentUrl: string): string | null {
  if (!contentUrl || contentUrl.length > 500 || /[\s\\]/.test(contentUrl)) return null;
  try {
    const catalog = new URL(catalogUrl), url = new URL(contentUrl, catalog);
    if (url.protocol !== 'https:' || url.host !== catalog.host || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export function parseSkillCatalog(raw: unknown, catalogUrl = SKILL_CATALOG_URL): PublicSkill[] {
  const skills = raw && typeof raw === 'object' && Array.isArray((raw as { skills?: unknown }).skills)
    ? (raw as { skills: unknown[] }).skills : [];
  const out: PublicSkill[] = [], seen = new Set<string>();
  for (const item of skills) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const sha = typeof row.content_sha256 === 'string' ? row.content_sha256.toLowerCase() : '';
    const contentUrl = resolveContentUrl(catalogUrl, typeof row.content_url === 'string' ? row.content_url : '');
    if (!SLUG.test(slug) || seen.has(slug) || !SHA.test(sha) || !contentUrl) continue;
    seen.add(slug);
    const publisher = row.publisher;
    out.push({
      slug, name: clip(row.name, 80) || slug, description: clip(row.description, 400),
      version: clip(row.version, 32), license: clip(row.license, 40),
      publisherName: publisher && typeof publisher === 'object' ? clip((publisher as { name?: unknown }).name, 80) : '',
      tags: Array.isArray(row.tags) ? row.tags.map(t => clip(t, 32)).filter(Boolean).slice(0, 8) : [],
      contentUrl, contentSha256: sha,
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function filterPublicSkills(skills: readonly PublicSkill[], query: string): PublicSkill[] {
  const q = query.trim().toLowerCase();
  return q ? skills.filter(s => [s.slug, s.name, s.description, ...s.tags].some(v => v.toLowerCase().includes(q))) : skills.slice();
}
export function skillDetailMeta(skill: PublicSkill): string {
  return [skill.slug, [skill.version, skill.license, skill.publisherName].filter(Boolean).join(' · '), skill.tags.join(' ')].filter(Boolean).join('\n');
}
export function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as Error).name === 'AbortError' || /aborted|request cancel(?:l)?ed/i.test(String((e as Error).message || '')));
}
export function skillDetailNeedsReset(detailOpen: boolean | undefined, hasSelection: boolean): boolean {
  return detailOpen === false && hasSelection || detailOpen === true && !hasSelection;
}

// Existing app SHA-256 implementation also works in native RN, where WebCrypto
// subtle is not guaranteed. No new native module, no unchecked fallback.
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  try { return new Sha256().update(typeof input === 'string' ? new TextEncoder().encode(input) : input).hex(); }
  catch { throw new SkillPlazaError('digest'); }
}
function decodeUtf8(bytes: Uint8Array, what: 'catalog' | 'body'): string {
  // A BOM belongs to the checked file bytes, but is not visible content. Strip
  // it only AFTER the hash. Round-trip checks also protect native decoders that
  // ignore fatal:true and would silently replace malformed UTF-8.
  const payload = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
    const encoded = new TextEncoder().encode(text);
    if (encoded.length !== payload.length || encoded.some((b, i) => b !== payload[i])) throw new Error('invalid UTF-8');
    return text;
  } catch { throw new SkillPlazaError(what === 'catalog' ? 'json' : 'body'); }
}
async function readOk(fetchImpl: SkillFetch, url: string, signal: AbortSignal | undefined, what: 'catalog' | 'body'): Promise<Uint8Array> {
  try {
    const res = await fetchImpl(url, signal ? { signal } : undefined);
    const limit = what === 'body' ? SKILL_BODY_MAX_BYTES : CATALOG_MAX_BYTES;
    const tooLarge = () => new SkillPlazaError(what === 'body' ? 'tooLarge' : 'catalog');
    const drop = () => { void res.body?.cancel().catch(() => {}); };
    if (!res.ok || res.redirected || res.url && res.url !== url) { drop(); throw new SkillPlazaError(what, res.status); }
    const length = res.headers?.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > limit) { drop(); throw tooLarge(); }
    if (!res.body?.getReader) throw new SkillPlazaError(what);
    const reader = res.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    let used = 0, complete = false;
    const buffer = new Uint8Array(limit);
    try {
      while (true) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const { done, value } = await reader.read();
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (done) { complete = true; return buffer.subarray(0, used); }
        if (!(value instanceof Uint8Array)) throw new SkillPlazaError(what);
        if (value.byteLength > limit - used) throw tooLarge();
        buffer.set(value, used); used += value.byteLength;
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      if (!complete) abort();
      reader.releaseLock();
    }
  } catch (e) {
    if (isAbortError(e) || e instanceof SkillPlazaError) throw e;
    throw new SkillPlazaError(what);
  }
}
export async function loadPublicSkills(fetchImpl: SkillFetch, catalogUrl = SKILL_CATALOG_URL, signal?: AbortSignal): Promise<PublicSkill[]> {
  const text = decodeUtf8(await readOk(fetchImpl, catalogUrl, signal, 'catalog'), 'catalog');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SkillPlazaError('json'); }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { skills?: unknown }).skills)) throw new SkillPlazaError('json');
  return parseSkillCatalog(raw, catalogUrl);
}
export async function loadSkillBody(fetchImpl: SkillFetch, skill: PublicSkill, signal?: AbortSignal,
  digest: (bytes: Uint8Array) => Promise<string> = sha256Hex): Promise<string> {
  const bytes = await readOk(fetchImpl, skill.contentUrl, signal, 'body');
  const actual = await digest(bytes);
  if (!SHA.test(skill.contentSha256) || actual.toLowerCase() !== skill.contentSha256.toLowerCase()) throw new SkillPlazaError('mismatch');
  return decodeUtf8(bytes, 'body');
}
