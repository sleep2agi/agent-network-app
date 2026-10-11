import { applyTagOp, applyTagOpToCatalog, canManageTags, catalogFromHub, localTagCounts, sidebarTagNames, tagName, tagOpErrorKey, tagSuggestions, type TagCatalog } from './task-tag-catalog';
import { createInput, emptyDraft } from './task-board-model';
import { createRequirementBody } from './requirements-hub';
import { readFileSync } from 'node:fs';
let p = 0, total = 0;
function ck(name: string, ok: boolean) { total++; if (ok) p++; else console.error(`FAIL ${name}`); }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── 读目录:新旧 Hub 两个方向 ──
const oldHub = catalogFromHub({ ok: true, tags: ['UI', '交互'] })!;
ck('old Hub: tags readable for autocomplete', eq(oldHub.tags, ['UI', '交互']));
ck('old Hub: no ops, cannot manage', !oldHub.ops && !oldHub.canManage);
ck('old Hub: management hidden even with capability', !canManageTags(['tags', 'tag_ops'], oldHub));
const cat = catalogFromHub({ ok: true, tags: ['TMWork', 'UI', '交互'], counts: { UI: 4, 交互: 2, TMWork: 1, bad: -1 }, colors: { UI: '#2563EB', 交互: 'red' }, can_manage: true })!;
ck('new Hub: counts kept, negative dropped', eq(cat.counts, { UI: 4, 交互: 2, TMWork: 1 }));
ck('new Hub: colors lowercased, invalid dropped', eq(cat.colors, { UI: '#2563eb' }));
ck('new Hub + capability: can manage', canManageTags(['tags', 'tag_ops'], cat));
ck('new Hub without capability in list: hidden', !canManageTags(['tags'], cat));
ck('scoped member (can_manage false): hidden', !canManageTags(['tag_ops'], catalogFromHub({ tags: [], can_manage: false })));
ck('no catalog: hidden', !canManageTags(['tag_ops'], null));
ck('garbage body: null', catalogFromHub({ ok: true }) === null && catalogFromHub(null) === null);

// ── 改写规则与 Hub 相同 ──
ck('rename keeps position', eq(applyTagOp(['a', 'UI', 'b'], { op: 'rename', from: 'UI', to: '界面' }), ['a', '界面', 'b']));
ck('rename into existing dedups', eq(applyTagOp(['交互', '界面'], { op: 'rename', from: '交互', to: '界面' }), ['界面']));
ck('merge several into one', eq(applyTagOp(['bug', 'x', '旧'], { op: 'merge', from: ['bug', '旧'], to: '杂项' }), ['杂项', 'x']));
ck('delete removes only that tag', eq(applyTagOp(['a', 'b'], { op: 'delete', tag: 'a' }), ['b']));
ck('untouched card = null', applyTagOp(['a'], { op: 'delete', tag: 'z' }) === null);
ck('color never touches cards', applyTagOp(['a'], { op: 'color', tag: 'a', color: '#123456' }) === null);

// ── 目录跟着改 ──
const renamed = applyTagOpToCatalog(cat, { op: 'rename', from: 'UI', to: '界面' });
ck('catalog rename moves count and color', renamed.counts['界面'] === 4 && renamed.colors['界面'] === '#2563eb' && !('UI' in renamed.counts) && !renamed.tags.includes('UI'));
const merged = applyTagOpToCatalog({ ...cat, colors: { 交互: '#16a34a', UI: '#2563eb' } }, { op: 'merge', from: ['交互', 'TMWork'], to: 'UI' });
ck('catalog merge into colored target keeps its color', merged.colors.UI === '#2563eb' && merged.counts.UI === 7 && !merged.colors['交互']);
const deleted = applyTagOpToCatalog(cat, { op: 'delete', tag: 'UI' });
ck('catalog delete drops tag, count, color', !deleted.tags.includes('UI') && !deleted.counts.UI && !deleted.colors.UI);
ck('catalog color set / clear', applyTagOpToCatalog(cat, { op: 'color', tag: 'TMWork', color: '#DC2626' }).colors.TMWork === '#dc2626' && !applyTagOpToCatalog(cat, { op: 'color', tag: 'UI', color: null }).colors.UI);

// ── 名字校验 = Hub 规则 ──
ck('tag name trimmed', tagName('  UI ') === 'UI');
ck('tag name rejects empty / long / control', tagName(' ') === null && tagName('x'.repeat(21)) === null && tagName('a\nb') === null);
ck('20 emoji is one tag', tagName('😀'.repeat(20)) !== null);

// ── 补全 ──
const counts = { UI: 4, 'UI 走查': 1, 交互: 2, bug: 9, Build: 3 };
const all = Object.keys(counts);
ck('empty query: most used first, current excluded', eq(tagSuggestions(all, counts, ['bug'], '', 3), ['UI', 'Build', '交互']));
ck('prefix before substring, case-insensitive', eq(tagSuggestions(all, counts, [], 'u'), ['UI', 'UI 走查', 'bug', 'Build']));
ck('exact match first', tagSuggestions(all, counts, [], 'ui')[0] === 'UI');
ck('no match: empty', tagSuggestions(all, counts, [], 'zzz').length === 0);
ck('limit respected', tagSuggestions(all, counts, [], '', 2).length === 2);

// ── 错误码 → 文案 key ──
ck('403 → permission', tagOpErrorKey(403, 'permission_denied') === 'tags.noPermission');
ck('404 → not found', tagOpErrorKey(404, 'tag_not_found') === 'tags.notFound');
ck('400 codes', tagOpErrorKey(400, 'invalid_tag') === 'tags.invalidName' && tagOpErrorKey(400, 'same_tag') === 'tags.sameTag' && tagOpErrorKey(500) === 'tags.opFailed');

// ── 本地用量 ──
const local = localTagCounts([{ tags: ['a', 'b'] }, { tags: ['a'] }, {}]);
ck('local counts', local.get('a') === 2 && local.get('b') === 1 && local.size === 2);

// 侧栏排序与右侧数字使用同一份计数,不改写 Hub 标签或卡片顺序。
const sidebarCounts = new Map([['权限', 59], ['桌面端', 13], ['ANet', 353], ['组织架构权限', 36]]);
ck('sidebar: numeric descending (screenshot regression)', eq(sidebarTagNames(sidebarCounts), ['ANet', '权限', '组织架构权限', '桌面端']));
ck('sidebar: equal counts retain alphabetical order', eq(sidebarTagNames(new Map([['z', 2], ['a', 2], ['b', 10]])), ['b', 'a', 'z']));
ck('sidebar: equal counts stable across response order', eq(sidebarTagNames(new Map([['a', 2], ['z', 2], ['b', 10]])), ['b', 'a', 'z']));
ck('sidebar: missing selected tag stays last at zero', eq(sidebarTagNames(local, 'missing'), ['a', 'b', 'missing']));
ck('sidebar: selected existing tag not duplicated or promoted', eq(sidebarTagNames(local, 'b'), ['a', 'b']));
ck('sidebar: empty list has no synthetic tag', eq(sidebarTagNames(new Map()), []));
ck('sidebar: empty list keeps selected tag', eq(sidebarTagNames(new Map(), 'selected'), ['selected']));
ck('sidebar: input map not mutated', eq([...sidebarCounts.keys()], ['权限', '桌面端', 'ANet', '组织架构权限']));
ck('sidebar: refreshed counts reorder automatically', eq(sidebarTagNames(localTagCounts([{ tags: ['b'] }, { tags: ['a', 'b'] }])), ['b', 'a']));
const sidebarSource = readFileSync(new URL('./TaskFilterSidebar.tsx', import.meta.url), 'utf8');
ck('sidebar wiring: sort and badges share counts', sidebarSource.includes('const tagNames = sidebarTagNames(tagCounts, filter.tag);') && sidebarSource.includes('tagNames.map(tag => tagRow(tag, tag, tagDot(tag), tagCounts.get(tag) ?? 0))'));
ck('sidebar wiring: all-tags row remains before sorted tags', sidebarSource.indexOf("{tagRow('', tr('tags.all')") >= 0 && sidebarSource.indexOf("{tagRow('', tr('tags.all')") < sidebarSource.indexOf('{tagNames.map('));

// ── 新建带标签:有就发,没有就不带字段(旧 Hub 请求形状不变) ──
const cfg = { serverUrl: 'http://h', token: 't', networkId: 'n' } as never;
const withTags = createInput({ ...emptyDraft(), name: 'x', tags: ['UI'] })!;
ck('create input carries tags', eq(withTags.tags, ['UI']) && eq(createRequirementBody(cfg, withTags).tags, ['UI']));
const noTags = createInput({ ...emptyDraft(), name: 'x' })!;
ck('create without tags sends no tags field', !('tags' in noTags) && createRequirementBody(cfg, noTags).tags === undefined && !JSON.stringify(createRequirementBody(cfg, noTags)).includes('tags'));

console.log(`tag catalog: ${p}/${total}`);
if (p !== total) process.exit(1);
