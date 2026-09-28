// 技能广场:公开目录的解析、搜索、校验。run: bun src/skill-plaza-model.test.ts
import { readFileSync } from 'node:fs';
import {
  SKILL_BODY_MAX_CHARS,
  SKILL_CATALOG_URL,
  SKILL_PLAZA_NOTE,
  filterPublicSkills,
  loadPublicSkills,
  loadSkillBody,
  parseSkillCatalog,
  resolveContentUrl,
  sha256Hex,
  skillBodyAccepted,
} from './skill-plaza-model';
import { PHONE_SETTINGS_GROUPS, SETTINGS_CATEGORIES, consumeSettingsNestedBack, filterSettings, setSettingsNestedBack } from './settings-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const CATALOG = 'https://www.anet.sh/skillhub/catalog.json';
const SHA_A = 'ab'.repeat(32);
const SHA_B = 'cd'.repeat(32);

{
  ck('目录地址就是公开 SkillHub', SKILL_CATALOG_URL === 'https://www.anet.sh/skillhub/catalog.json');
  ck('说明写明不是节点页的技能,也不能安装', SKILL_PLAZA_NOTE.includes('节点页') && SKILL_PLAZA_NOTE.includes('不是这里') && SKILL_PLAZA_NOTE.includes('不能安装'));
  const raw = {
    skills: [
      { slug: 'b-skill', name: 'B', description: 'second', version: '1.0.0', license: 'Apache-2.0', tags: ['review', ''], publisher: { name: 'Maintainers' }, content_sha256: SHA_B.toUpperCase(), content_url: '/skillhub/skills/b-skill/1.0.0/SKILL.md' },
      { slug: 'a-skill', name: 'A 技能', description: '找重叠', version: '2.0.0', tags: ['github'], content_sha256: SHA_A, content_url: 'skills/a.md' },
      { slug: '../x', name: 'bad', content_sha256: SHA_A, content_url: '/x' },
      { slug: 'no-hash', name: 'no', content_url: '/x' },
      { slug: 'evil', name: 'E', content_sha256: SHA_A, content_url: 'https://evil.example/skill.md' },
      { slug: 'b-skill', name: 'dup', content_sha256: SHA_A, content_url: '/dup' },
      { slug: 'js', name: 'J', content_sha256: SHA_A, content_url: 'javascript:alert(1)' },
      { slug: 'user', name: 'U', content_sha256: SHA_A, content_url: 'https://user:pass@www.anet.sh/a' },
    ],
  };
  const list = parseSkillCatalog(raw, CATALOG);
  ck('只留下能打开的,按 slug 排序,丢掉重复', list.map(s => s.slug).join(',') === 'a-skill,b-skill', list.map(s => s.slug).join(','));
  ck('相对地址留在目录同一个主机', list[0].contentUrl === 'https://www.anet.sh/skillhub/skills/a.md' && list[1].contentUrl === 'https://www.anet.sh/skillhub/skills/b-skill/1.0.0/SKILL.md');
  ck('校验和收成小写;名字和发布者留下', list[1].contentSha256 === SHA_B && list[0].name === 'A 技能' && list[1].publisherName === 'Maintainers');
  ck('空标签丢掉', list[1].tags.join(',') === 'review');
  ck('不是目录对象 → 空', parseSkillCatalog(null, CATALOG).length === 0 && parseSkillCatalog({ skills: 'nope' }, CATALOG).length === 0);
  ck('别的主机 / http / 带账号的地址丢掉', resolveContentUrl(CATALOG, 'https://evil.example/a') === null && resolveContentUrl(CATALOG, 'http://www.anet.sh/a') === null && resolveContentUrl(CATALOG, 'https://user:pass@www.anet.sh/a') === null);
  ck('搜描述、标签、大小写和空格', filterPublicSkills(list, ' 重叠 ').map(s => s.slug).join(',') === 'a-skill' && filterPublicSkills(list, 'REVIEW').map(s => s.slug).join(',') === 'b-skill');
  ck('空搜索返回全部', filterPublicSkills(list, '  ').length === 2);
  ck('没有匹配', filterPublicSkills(list, '没有这个').length === 0);
}

{
  const huge = 'x'.repeat(SKILL_BODY_MAX_CHARS + 1);
  const big = skillBodyAccepted(huge, SHA_A, SHA_A);
  ck('超过 256 KB 不展开', big.ok === false && big.reason.includes('256 KB'));
  const bad = skillBodyAccepted('hello', SHA_A, SHA_B);
  ck('校验对不上就拒绝,不把正文当成功', bad.ok === false && bad.reason.includes('对不上'));
  const ok = skillBodyAccepted('hello', SHA_A, SHA_A.toUpperCase());
  ck('校验通过才交出正文', ok.ok === true && ok.text === 'hello');
}

{
  const fetchImpl = async (url: string) => {
    if (url.endsWith('/missing')) return { ok: false, status: 404, text: async () => '' };
    if (url.endsWith('/bad-json')) return { ok: true, status: 200, text: async () => '{' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ skills: [{ slug: 'a-skill', name: 'A', content_sha256: SHA_A, content_url: '/skillhub/skills/a.md' }] }) };
  };
  const list = await loadPublicSkills(fetchImpl, CATALOG);
  ck('拉目录只收合法条目', list.length === 1 && list[0].slug === 'a-skill');
  let http = '';
  try { await loadPublicSkills(async () => ({ ok: false, status: 503, text: async () => '' }), CATALOG); } catch (e) { http = e instanceof Error ? e.message : ''; }
  ck('目录 HTTP 失败有一句人话', http.includes('HTTP 503'));
  let json = '';
  try { await loadPublicSkills(async () => ({ ok: true, status: 200, text: async () => '{' }), CATALOG); } catch (e) { json = e instanceof Error ? e.message : ''; }
  ck('目录不是 JSON 有一句人话', json.includes('不是 JSON'));
  const skill = list[0];
  const body = await loadSkillBody(async () => ({ ok: true, status: 200, text: async () => 'hello' }), skill, undefined, async () => SHA_A);
  ck('校验通过才返回正文', body === 'hello');
  let mismatch = '';
  try { await loadSkillBody(async () => ({ ok: true, status: 200, text: async () => 'nope' }), skill, undefined, async () => SHA_B); } catch (e) { mismatch = e instanceof Error ? e.message : ''; }
  ck('校验失败不返回正文', mismatch.includes('对不上'));
}

{
  const abc = await sha256Hex('abc');
  ck('sha256(abc)', abc === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', abc);
  let missing = '';
  try { await sha256Hex('abc', null); } catch (e) { missing = e instanceof Error ? e.message : ''; }
  ck('没有校验实现时拒绝打开', missing.includes('对不上'));
}

{
  ck('技能广场是左栏最后一项,紧挨在关于下面', SETTINGS_CATEGORIES.at(-1)?.key === 'skillPlaza' && SETTINGS_CATEGORIES.at(-2)?.key === 'about');
  const help = PHONE_SETTINGS_GROUPS.find(g => g.title === '帮助与关于');
  ck('手机上技能广场跟在关于后面', JSON.stringify(help?.keys) === JSON.stringify(['about', 'skillPlaza']));
  const hit = filterSettings('技能广场', { localHub: true });
  ck('搜「技能广场」只进这一类', hit.length === 1 && hit[0].key === 'skillPlaza' && hit[0].rows[0].key === 'catalog');
  ck('搜 skill 也能到', filterSettings('skill', {}).some(c => c.key === 'skillPlaza'));
  setSettingsNestedBack(null);
  ck('没有打开正文时,返回不拦截', consumeSettingsNestedBack() === false);
  let n = 0;
  setSettingsNestedBack(() => { n += 1; return true; });
  ck('正文开着时,返回先被它吃掉', consumeSettingsNestedBack() === true && n === 1);
  setSettingsNestedBack(() => false);
  ck('它说不拦截时,返回继续走', consumeSettingsNestedBack() === false);
  setSettingsNestedBack(null);
}

{
  const screen = norm('./SettingsScreen.tsx');
  const phone = norm('./SettingsPhonePages.tsx');
  const section = norm('./SkillPlazaSection.tsx');
  ck('桌面右栏挂技能广场', screen.includes("sectionsToRender.includes('skillPlaza')") && screen.includes('<SkillPlazaSection layout="desktop" />'));
  ck('返回先问嵌套页', screen.includes('if (consumeSettingsNestedBack()) return;'));
  ck('手机子页有技能广场', phone.includes("case 'skillPlaza':"));
  ck('正文走公开目录并且带上说明', section.includes('loadPublicSkills(') && section.includes('loadSkillBody(') && section.includes('SKILL_PLAZA_NOTE'));
  ck('不走节点技能门铃', !section.includes('listNodeSkills') && !section.includes('readNodeSkill'));
  ck('拉目录不带 Hub 令牌', !/Authorization/.test(section));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
