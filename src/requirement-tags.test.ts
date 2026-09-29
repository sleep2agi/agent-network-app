import { normalizeTags } from './requirement-tags';
import { requirementFromHub } from './requirements-hub';
import { filterActive, matchesFilter, patchApplied } from './task-board-model';
let p = 0, total = 0;
function ck(name: string, ok: boolean) { total++; if (ok) p++; else console.error(`FAIL ${name}`); }
ck('trim and deduplicate', JSON.stringify(normalizeTags([' UI ', 'UI'])) === '["UI"]');
for (const value of [null, {}, [''], ['a'.repeat(21)], Array(11).fill('x'), [false], ['a\nb']]) ck('reject invalid', normalizeTags(value) === null);
ck('20 Unicode characters', normalizeTags(['😀'.repeat(20)])?.length === 1);
const old = requirementFromHub({ id: 'a', name: 'A', createdAt: '' })!;
ck('old Hub remains unsupported', old.tags === undefined);
ck('old Hub cannot falsely acknowledge tag write', !patchApplied(old, { tags: [] }));
const item = { ...old, tags: ['UI'] };
ck('matching tag', matchesFilter(item, { owners: [], priorities: [], tag: 'UI' }));
ck('nonmatching tag', !matchesFilter(item, { owners: [], priorities: [], tag: 'Other' }));
ck('filter active', filterActive({ owners: [], priorities: [], tag: 'UI' }));
ck('verify saved tags', patchApplied(item, { tags: ['UI'] }));
console.log(`tags: ${p}/${total}`);
if (p !== total) process.exit(1);
