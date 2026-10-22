import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { filterPublicSkills, loadPublicSkills, loadSkillBody, parseSkillCatalog, resolveContentUrl, sha256Hex, SKILL_BODY_MAX_BYTES, SKILL_CATALOG_URL, SkillPlazaError, type SkillFetch } from './skill-plaza-model';
import { filterSettings, PHONE_SETTINGS_GROUPS, SETTINGS_CATEGORIES, settingsBackTarget } from './settings-model';
import { settingsText } from './i18n-settings';
import { setLanguagePreference, t } from './i18n';
import './i18n-skill-plaza';

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
const fetchText = (text: string, status = 200): SkillFetch => async () => ({ ok: status === 200, status, text: async () => text });
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
ck('public fetch omits credentials, content is plain selectable text', section.includes("credentials: 'omit'") && !section.includes('Authorization') && section.includes('selectable style={styles.body}') && !section.includes('dangerouslySetInnerHTML'));
console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
