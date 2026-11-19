import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearSkillsCache, getCachedSkills, putCachedSkills, skillsCacheKey } from './skills-cache';

const cfg = { serverUrl: 'https://hub.example', profileId: 'p1' };
const k = skillsCacheKey(cfg, 'n1|a');
assert.equal(getCachedSkills(k), null);
putCachedSkills(k, { skills: [{ name: 'x' } as any], roots: ['r'], warnings: [] }, 5);
assert.equal(getCachedSkills(k)?.skills[0].name, 'x');
assert.equal(getCachedSkills(k)?.at, 5);
// 另一个账号 / 另一个节点不串
assert.equal(getCachedSkills(skillsCacheKey({ ...cfg, profileId: 'p2' }, 'n1|a')), null);
assert.equal(getCachedSkills(skillsCacheKey(cfg, 'n2|a')), null);
// 上限 64,最旧的先丢
for (let i = 0; i < 70; i++) putCachedSkills(skillsCacheKey(cfg, `m${i}`), { skills: [], roots: null, warnings: [] });
assert.equal(getCachedSkills(k), null);
assert.ok(getCachedSkills(skillsCacheKey(cfg, 'm69')));
clearSkillsCache();
assert.equal(getCachedSkills(skillsCacheKey(cfg, 'm69')), null);

// 接线:有缓存先显示 ready,后台刷新失败不覆盖旧清单
const src = readFileSync(new URL('./NodeSkillsSection.tsx', import.meta.url), 'utf8');
assert.match(src, /useState<Phase>\(cached \? 'ready' : 'loading'\)/);
assert.match(src, /const fail = \(msg: string\) => \{ if \(background\) return;/);
assert.match(src, /putCachedSkills\(cacheKey,/);
assert.match(src, /runList\(\{ background: !!getCachedSkills\(cacheKey\) \}\)/);
console.log('skills-cache: ok');
