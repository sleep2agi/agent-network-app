import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { filterPublicSkills, loadPublicSkills, loadSkillBody, parseSkillCatalog, resolveContentUrl, sha256Hex, skillDetailNeedsReset, SKILL_BODY_MAX_BYTES, SKILL_CATALOG_URL, SkillPlazaError, type SkillFetch } from './skill-plaza-model';
import { filterSettings, PHONE_SETTINGS_GROUPS, SETTINGS_CATEGORIES, settingsBackTarget } from './settings-model';
import { settingsText } from './i18n-settings';
import { setLanguagePreference, t } from './i18n';
import './i18n-skill-plaza';
import { fetchPublicSkill } from './skill-plaza-fetch';

let pass = 0, total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const body = '# 示例技能\n\nBrowse only, 不执行。';
const hash = createHash('sha256').update(body).digest('hex');
const row = { slug: 'example', name: '示例技能', description: 'Only browse', tags: ['review'], version: '1.0', content_sha256: hash, content_url: '/skillhub/example/SKILL.md' };
const raw = { skills: [row, { ...row }, { ...row, slug: '../bad' }, { ...row, slug: 'evil', content_url: 'https://evil.invalid/x' }, { ...row, slug: 'no-hash', content_sha256: '' }] };
const list = parseSkillCatalog(raw);
ck('keep valid same-host, hashed entry once', list.length === 1 && list[0].slug === 'example');
ck('credentials, http and foreign host refused', ['http://www.anet.sh/a', 'https://user:pass@www.anet.sh/a', 'https://evil.invalid/a'].every(u => resolveContentUrl(SKILL_CATALOG_URL, u) === null));
ck('search description/tag/name and empty', filterPublicSkills(list, ' REVIEW ').length === 1 && filterPublicSkills(list, '示例').length === 1 && filterPublicSkills(list, 'missing').length === 0 && filterPublicSkills(list, '').length === 1);
ck('native-compatible digest matches UTF-8 reference', await sha256Hex(body) === hash);
const fetchText = (text: string, status = 200): SkillFetch => async () => new Response(text, { status });
ck('load catalogue then verified content', (await loadPublicSkills(fetchText(JSON.stringify(raw)))).length === 1 && await loadSkillBody(fetchText(body), list[0]) === body);
async function rejects(name: string, code: string, work: () => Promise<unknown>) {
  try { await work(); ck(name, false); } catch (e) { ck(name, e instanceof SkillPlazaError && e.code === code); }
}
await rejects('catalogue HTTP failure stays error, not empty success', 'catalog', () => loadPublicSkills(fetchText('', 503)));
await rejects('catalogue wrong schema stays error', 'json', () => loadPublicSkills(fetchText('{}')));
await rejects('catalogue malformed JSON stays error', 'json', () => loadPublicSkills(fetchText('{')));
await rejects('mismatch never returns unverified content', 'mismatch', () => loadSkillBody(fetchText('changed'), list[0]));
await rejects('UTF-8 byte limit checked before digest', 'tooLarge', () => loadSkillBody(fetchText('文'.repeat(SKILL_BODY_MAX_BYTES / 2)), list[0], undefined, async () => { throw Error('digest must not run'); }));
ck('empty catalogue is valid', (await loadPublicSkills(fetchText('{"skills":[]}'))).length === 0);
ck('last category follows About', SETTINGS_CATEGORIES.at(-1)?.key === 'skillPlaza' && SETTINGS_CATEGORIES.at(-2)?.key === 'about');
ck('phone placement follows About', PHONE_SETTINGS_GROUPS.at(-1)?.keys.join(',') === 'about,skillPlaza');
ck('English search finds catalogue', filterSettings('catalogue', {}).some(c => c.key === 'skillPlaza'));
ck('phone content back uses existing detail contract', settingsBackTarget('skillPlaza', 'skillBody') === 'detail' && settingsBackTarget('skillPlaza', null) === 'page');
setLanguagePreference('en');
ck('category and failures translated', settingsText('技能广场') === 'Skill plaza' && t('skillPlaza.mismatch').includes('checksum') && !/[\u4e00-\u9fff]/.test(t('skillPlaza.note')));
setLanguagePreference('zh');
ck('Chinese failure remains readable', t('skillPlaza.mismatch').includes('拒绝打开'));
const screen = read('./SettingsScreen.tsx'), phone = read('./SettingsPhonePages.tsx'), section = read('./SkillPlazaSection.tsx');
ck('current desktop and phone wiring', screen.includes('<SkillPlazaSection layout="desktop" />') && screen.includes("openDetail('skillBody')") && phone.includes("case 'skillPlaza':"));
ck('no global nested back or node skill operations', !section.includes('setSettingsNestedBack') && !section.includes('listNodeSkills') && !section.includes('readNodeSkill'));
const transport = read('./skill-plaza-fetch.ts');
ck('public fetch omits credentials, content is plain selectable text', transport.includes("credentials: 'omit'") && !section.includes('Authorization') && section.includes('selectable style={styles.body}') && !section.includes('dangerouslySetInnerHTML'));
ck('desktop public requests bypass pooled transport and prohibit native redirects', transport.includes("import('@tauri-apps/plugin-http')") && transport.includes('maxRedirections: 0') && !transport.includes("from './app-fetch'"));
ck('web/SDK56 public transport prohibits redirects', transport.includes("redirect: 'error'"));
const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(body)]);
const bomHash = createHash('sha256').update(bom).digest('hex');
ck('BOM file digest checks exact bytes before decoding for display', await loadSkillBody(async () => new Response(bom), { ...list[0], contentSha256: bomHash }) === body);
const malformed = new Uint8Array([0xc0, 0xaf]);
await rejects('malformed UTF8 is not replacement-decoded into display text', 'body', () => loadSkillBody(async () => new Response(malformed), { ...list[0], contentSha256: createHash('sha256').update(malformed).digest('hex') }));
let pulled = 0, cancelled = false;
const oversized: SkillFetch = async () => ({ ok: true, status: 200, body: new ReadableStream({
  pull(c) { pulled++; c.enqueue(new Uint8Array(64 * 1024)); }, cancel() { cancelled = true; },
}, { highWaterMark: 0 }) });
await rejects('unknown-length stream cancelled at cap, not buffered to EOF', 'tooLarge', () => loadSkillBody(oversized, list[0]));
ck('oversized read stops after first excess chunk and cancels producer', pulled === 5 && cancelled);
let headerRead = false, headerCancelled = false;
await rejects('declared oversized response rejected before any read', 'tooLarge', () => loadSkillBody(async () => ({ ok: true, status: 200,
  headers: new Headers({ 'content-length': String(SKILL_BODY_MAX_BYTES + 1) }), body: new ReadableStream({ pull() { headerRead = true; }, cancel() { headerCancelled = true; } }, { highWaterMark: 0 }),
}), list[0]));
ck('declared oversized response cancels without pulling', !headerRead && headerCancelled);
await rejects('non-streaming transport fails closed, no unbounded fallback', 'body', () => loadSkillBody(async () => ({ ok: true, status: 200, body: null }), list[0]));
await rejects('foreign final URL refused without reading', 'body', () => loadSkillBody(async () => ({ ok: true, status: 200, url: 'http://127.0.0.1/x', body: null }), list[0]));
await rejects('redirect response refused', 'body', () => loadSkillBody(async () => ({ ok: false, status: 302, body: null }), list[0]));
ck('restored detail without selection reconciles parent navigation', skillDetailNeedsReset(true, false) && section.includes('skillDetailNeedsReset(detailOpen, !!selected)'));
ck('normal catalogue/detail do not spuriously reset', !skillDetailNeedsReset(false, false) && !skillDetailNeedsReset(true, true) && !skillDetailNeedsReset(undefined, true));
ck('existing back still clears an actual selection', skillDetailNeedsReset(false, true));
// Exercise the installed HTTP plugin's JS wire adapter, not a substitute fetch.
// Rust/network are stubbed here; native redirect-policy acceptance remains CI/native work.
const globals = globalThis as unknown as Record<string, any>;
const savedWindow = globals.window, savedTauri = globals.__TAURI_INTERNALS__, savedFetch = globals.fetch;
const calls: { command: string; args: any }[] = [];
try {
  globals.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
    calls.push({ command, args });
    if (command === 'plugin:http|fetch') return 101;
    if (command === 'plugin:http|fetch_send') return { rid: 102, status: 302, statusText: 'Found', url: list[0].contentUrl,
      headers: [['location', 'http://127.0.0.1/private']] };
    if (command === 'plugin:http|fetch_read_body') return [1];
    if (command === 'plugin:http|fetch_cancel_body') return;
    throw Error(`unexpected transport: ${command}`);
  } };
  globals.window = globals;
  await rejects('actual plugin adapter refuses redirect response at public reader', 'body', () => loadSkillBody(fetchPublicSkill, list[0]));
  const request = calls.find(c => c.command === 'plugin:http|fetch')?.args.clientConfig;
  ck('actual plugin IPC receives zero redirects and original public URL', request?.maxRedirections === 0 && request?.url === list[0].contentUrl);
  ck('plugin request has no auth/cookie header and never uses pooled_fetch', request?.headers.every(([key]: string[]) => !/^(authorization|cookie)$/i.test(key)) && calls.every(c => c.command !== 'pooled_fetch'));
  delete globals.__TAURI_INTERNALS__;
  let webInit: RequestInit | undefined;
  globals.fetch = async (_url: string, init: RequestInit) => { webInit = init; return new Response(body); };
  ck('web transport still returns byte-verified content', await loadSkillBody(fetchPublicSkill, list[0]) === body);
  ck('web transport gets no-redirect/no-credential options', webInit?.redirect === 'error' && webInit?.credentials === 'omit');
} finally {
  if (savedWindow === undefined) delete globals.window; else globals.window = savedWindow;
  if (savedTauri === undefined) delete globals.__TAURI_INTERNALS__; else globals.__TAURI_INTERNALS__ = savedTauri;
  globals.fetch = savedFetch;
}
console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
