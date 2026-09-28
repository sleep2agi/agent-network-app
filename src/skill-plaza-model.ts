// 设置里的「技能广场」:公开 SkillHub 目录(https://www.anet.sh/skillhub/catalog.json)。
// 节点页「技能」是那个节点已经能加载的,只读,走另一条门铃。这里不能安装。
// 纯逻辑,不 import react-native。

export const SKILL_CATALOG_URL = 'https://www.anet.sh/skillhub/catalog.json';
export const SKILL_BODY_MAX_CHARS = 256 * 1024;
export const SKILL_PLAZA_NOTE = '公开目录，用来看和搜。节点页的「技能」是那个节点已经能加载的，不是这里。这里还不能安装。';

const SLUG = /^[A-Za-z0-9._-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/i;

export type PublicSkill = {
  slug: string;
  name: string;
  description: string;
  version: string;
  tags: readonly string[];
  license: string;
  publisherName: string;
  contentUrl: string;
  contentSha256: string;
};

export type SkillFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 正文地址必须是 https,而且和目录在同一个主机上。别的主机、带账号的地址,丢掉。 */
export function resolveContentUrl(catalogUrl: string, contentUrl: string): string | null {
  if (!contentUrl || contentUrl.length > 500 || /[\s\\]/.test(contentUrl)) return null;
  let catalog: URL;
  let url: URL;
  try {
    catalog = new URL(catalogUrl);
    url = new URL(contentUrl, catalog);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.host !== catalog.host) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** 解析目录。slug / 校验 / 地址不合法的条目丢掉;同名留第一条;按 slug 排序。 */
export function parseSkillCatalog(raw: unknown, catalogUrl: string): PublicSkill[] {
  const skills = raw && typeof raw === 'object' && Array.isArray((raw as { skills?: unknown }).skills)
    ? (raw as { skills: unknown[] }).skills
    : [];
  const out: PublicSkill[] = [];
  const seen = new Set<string>();
  for (const item of skills) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const slug = typeof row.slug === 'string' ? row.slug : '';
    if (!SLUG.test(slug) || seen.has(slug)) continue;
    const sha = typeof row.content_sha256 === 'string' ? row.content_sha256.toLowerCase() : '';
    if (!SHA.test(sha)) continue;
    const contentUrl = resolveContentUrl(catalogUrl, typeof row.content_url === 'string' ? row.content_url : '');
    if (!contentUrl) continue;
    seen.add(slug);
    const publisher = row.publisher;
    const publisherName = publisher && typeof publisher === 'object' ? clip((publisher as { name?: unknown }).name, 80) : '';
    const tags: string[] = [];
    if (Array.isArray(row.tags)) {
      for (const tag of row.tags) {
        const s = clip(tag, 32);
        if (s) tags.push(s);
        if (tags.length >= 8) break;
      }
    }
    const name = clip(row.name, 80) || slug;
    out.push({
      slug,
      name,
      description: clip(row.description, 400),
      version: clip(row.version, 32),
      tags,
      license: clip(row.license, 40),
      publisherName,
      contentUrl,
      contentSha256: sha,
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export function filterPublicSkills(skills: readonly PublicSkill[], query: string): PublicSkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills.slice();
  return skills.filter((s) =>
    s.slug.toLowerCase().includes(q)
    || s.name.toLowerCase().includes(q)
    || s.description.toLowerCase().includes(q)
    || s.tags.some((t) => t.toLowerCase().includes(q)));
}

export function skillDetailMeta(skill: PublicSkill): string {
  const bits = [skill.version, skill.license, skill.publisherName].filter(Boolean);
  const tags = skill.tags.length ? skill.tags.join(' ') : '';
  return [skill.slug, bits.join(' · '), tags].filter(Boolean).join('\n');
}

export function skillBodyAccepted(text: string, expectedSha256: string, actualSha256: string): { ok: true; text: string } | { ok: false; reason: string } {
  if (text.length > SKILL_BODY_MAX_CHARS) return { ok: false, reason: '正文超过 256 KB，这里不展开。' };
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) return { ok: false, reason: '内容和目录里的校验对不上，已拒绝打开。' };
  return { ok: true, text };
}

export function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  const message = String((e as { message?: string }).message || '');
  return name === 'AbortError' || /aborted/i.test(message);
}

type Sha256Digest = { digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer> };

export async function sha256Hex(text: string, subtle?: Sha256Digest | null): Promise<string> {
  const impl = subtle === undefined
    ? (globalThis as { crypto?: { subtle?: Sha256Digest } }).crypto?.subtle
    : subtle;
  if (!impl?.digest) throw new Error('这个环境对不上内容校验，打不开正文。');
  const digest = await impl.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readOk(fetchImpl: SkillFetch, url: string, signal: AbortSignal | undefined, what: '目录' | '正文'): Promise<string> {
  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await fetchImpl(url, signal ? { signal } : undefined);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error(`${what}打不开。请检查网络后再试。`);
  }
  if (!res.ok) throw new Error(`${what}打不开（HTTP ${res.status}）。`);
  return res.text();
}

export async function loadPublicSkills(fetchImpl: SkillFetch, catalogUrl = SKILL_CATALOG_URL, signal?: AbortSignal): Promise<PublicSkill[]> {
  const text = await readOk(fetchImpl, catalogUrl, signal, '目录');
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('目录不是 JSON。'); }
  return parseSkillCatalog(json, catalogUrl);
}

export async function loadSkillBody(
  fetchImpl: SkillFetch,
  skill: PublicSkill,
  signal?: AbortSignal,
  digest: (text: string) => Promise<string> = sha256Hex,
): Promise<string> {
  const text = await readOk(fetchImpl, skill.contentUrl, signal, '正文');
  const actual = await digest(text);
  const verdict = skillBodyAccepted(text, skill.contentSha256, actual);
  if (!verdict.ok) throw new Error(verdict.reason);
  return verdict.text;
}
