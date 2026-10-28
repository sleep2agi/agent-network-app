// #2098 / #2102:项目树与标签层级的纯判定。
// 关键约束:**没有 parent 数据时必须与旧的平铺完全一致**(顺序、深度、计数都不变)。
import { aggregateCounts, descendantIds, hasHierarchy, hubExposesProjectParent, includeTagAncestors, parentProjectOptions, projectRows, tagAncestors, tagDepth, tagParentsFromEntities, tagRows, tagWithDescendants } from './task-tree';
import { applyFilter, commitOnNameBlur, nameBlurOutcome, parentPatchForPick, projectRenamePatch, tagFilterAfterPick } from './task-board-model';
import { tagFilterEntries } from './task-tag-catalog';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); };

const P = (id: string, parentId?: string | null) => ({ id, name: id, color: '#111111', sort: 0, archived: false, parentId });

// ── 旧 Hub:没有 parent_id ───────────────────────────────────────────────
const flat = [P('TMAI'), P('ANet'), P('A站')];
ck('无 parent 时不算层级', hasHierarchy(flat) === false);
const flatRows = projectRows(flat);
ck('平铺顺序不变', flatRows.map(r => r.node.id).join(',') === 'TMAI,ANet,A站');
ck('平铺深度全为 0、无折叠箭头', flatRows.every(r => r.depth === 0 && !r.hasChildren && r.parentId === null));
const flatCounts = aggregateCounts(flatRows, n => (n.id === 'TMAI' ? 43 : n.id === 'ANet' ? 32 : 0));
ck('平铺时计数不被改动', flatCounts.get('TMAI') === 43 && flatCounts.get('ANet') === 32 && flatCounts.get('A站') === 0);

// ── 新 Hub:有父子 ─────────────────────────────────────────────────────
const tree = [P('TMAI', null), P('TMAI-客户端', 'TMAI'), P('TMAI-Hub', 'TMAI'), P('ANet', null), P('ANet-子', 'ANet')];
ck('有 parent 时判定为层级', hasHierarchy(tree) === true);
const rows = projectRows(tree);
ck('DFS 顺序:父后紧跟子', rows.map(r => r.node.id).join(',') === 'TMAI,TMAI-客户端,TMAI-Hub,ANet,ANet-子');
ck('子节点 depth=1、父节点 hasChildren', rows.find(r => r.node.id === 'TMAI-客户端')!.depth === 1
  && rows.filter(r => r.hasChildren).map(r => r.node.id).join(',') === 'TMAI,ANet');
const totals = aggregateCounts(rows, n => ({ 'TMAI': 5, 'TMAI-客户端': 3, 'TMAI-Hub': 2, 'ANet': 4, 'ANet-子': 1 } as Record<string, number>)[n.id] ?? 0);
ck('祖先计数 = 自己 + 后代', totals.get('TMAI') === 10 && totals.get('ANet') === 5 && totals.get('TMAI-客户端') === 3);

// 折叠:父还在,子不出现
const folded = projectRows(tree, new Set(['TMAI']));
ck('折叠父节点:父保留、子隐藏', folded.map(r => r.node.id).join(',') === 'TMAI,ANet,ANet-子'
  && folded.find(r => r.node.id === 'TMAI')!.hasChildren === true);

// 孤儿 / 自引用 / 环:绝不丢节点、绝不死循环
const messy = [P('A', 'A'), P('B', 'missing'), P('C', 'D'), P('D', 'C')];
const messyRows = projectRows(messy);
ck('自引用当根、孤儿当根、环不死循环且不丢节点',
  messyRows.length === messy.length && messyRows.every(r => r.depth === 0 || r.depth === 1));

// ── 标签 ────────────────────────────────────────────────────────────────
const names = ['发布', '发布-桌面', '发布-安卓', 'TMWork'];
ck('无 parents:标签平铺、顺序不变', tagRows(names, null).map(r => r.node.name).join(',') === names.join(','));
const parents = { '发布-桌面': '发布', '发布-安卓': '发布' };
const tagTree = tagRows(names, parents);
ck('有 parents:子标签缩进在父后面', tagTree.find(r => r.node.name === '发布-桌面')!.depth === 1
  && tagTree.find(r => r.node.name === '发布')!.hasChildren === true);
ck('按父标签筛选包含后代', tagWithDescendants('发布', parents).sort().join(',') === '发布,发布-安卓,发布-桌面');
ck('无层级时按标签筛选仍是精确匹配', tagWithDescendants('发布', null).join(',') === '发布');
ck('子标签的祖先链', tagAncestors('发布-桌面', parents).join(',') === '发布');

// ── 侧栏接线(source contract)───────────────────────────────────────────
import { readFileSync } from 'node:fs';
const side = readFileSync(new URL('./TaskFilterSidebar.tsx', import.meta.url), 'utf8');
// #2106 反例 2 / 3:计数必须从完整树算;可见行单独算;主树与空项目区共用 totals。
ck('侧栏:父计数来自完整树(折叠不影响数字)', /aggregateCounts\(projectRows\(active\), n => pCounts\.get\(n\.id\) \?\? 0\)/.test(side));
ck('侧栏:可见行单独按折叠算', /const visible = projectRows\(active, collapsedProjects\);/.test(side));
// 0.330 起两条都多了一层「左栏项目过滤」的 matchQ();语义不变(仍共用同一批可见行)。
ck('侧栏:主树与空项目区共用同一批可见行(父不重复)', side.includes('const emptyRows = visible.filter') && side.includes('&& matchQ(r));')
  && side.includes('{withTasks.map(drawRow)}'));
ck('侧栏用 tagRows + tagCatalog.parents 渲染标签层级', /tagRows\(tagNames[\s\S]{0,90}?tagCatalog\?\.parents/.test(side));
// #2106 反例 4 / P2:筛选带后代集合;标签按 depth 真缩进。
ck('侧栏:点击标签时把后代集合写进筛选', /tagFilterAfterPick\(filter, tag, tagCatalog\?\.parents \?\? null\)/.test(side));
ck('侧栏:标签行按 depth 缩进', /tagDepth\(r\.node\.name, tagCatalog\?\.depths \?\? null/.test(side) && /depth > 0 && \{ paddingLeft:/.test(side));
ck('折叠只在有子节点时出现', /r\.hasChildren\s*\?\s*<View/.test(side));


// ── #2113:父项目候选 ────────────────────────────────────────────────────
ck('旧 Hub(没有 parent_id 字段)不暴露父项目', hubExposesProjectParent([P('A'), P('B')]) === false);
ck('新 Hub 根项目 parent_id=null 也算暴露该字段', hubExposesProjectParent([P('A', null), P('B', null)]) === true);
ck('空列表不暴露', hubExposesProjectParent([]) === false && hubExposesProjectParent(null) === true === false);
ck('旧 Hub 时父项目候选为空(控件完全不渲染)', parentProjectOptions([P('A'), P('B')]).length === 0);

const three = [P('root', null), P('child', 'root'), P('grand', 'child'), P('other', null)];
const created = parentProjectOptions(three);
ck('新建:所有未归档项目都可当父', created.map(n => n.id).join(',') === 'root,child,grand,other');
const edited = parentProjectOptions(three, 'root');
ck('编辑:排除自己与后代', edited.map(n => n.id).join(',') === 'other');
ck('后代计算覆盖多层', descendantIds(three, 'root').join(',') === 'child,grand');
ck('编辑叶子项目:只排除自己', parentProjectOptions(three, 'grand').map(n => n.id).join(',') === 'root,child,other');

const manager = readFileSync(new URL('./TaskProjectManager.tsx', import.meta.url), 'utf8');
ck('管理页:Hub 没字段时整块父项目控件不渲染', /const supportsParent = hubExposesProjectParent\(projects\);/.test(manager)
  && /supportsParent \? parentChips\(parentId, createParents/.test(manager));
ck('管理页:新建把 parentId 传给 onCreate', /onCreate\(c\.name, color, parentId\)/.test(manager));
ck('管理页:编辑用完整图 + available 排除自身与后代', /parentProjectOptions\(projects, editing\.id/.test(manager));
ck('管理页:编辑保存走 projectRenamePatch(只在父项目/名字真变时发字段)', /projectRenamePatch\(current, c\.name, supportsParent \?/.test(manager));


// ── #2106 反例(行为级)─────────────────────────────────────────────────
// 反例 1:折叠父项目后,父的计数仍应含被折叠的子树(用完整树算)。
const full = projectRows(tree);
const fullTotals = aggregateCounts(full, n => ({ 'TMAI': 0, 'TMAI-客户端': 3, 'TMAI-Hub': 2, 'ANet': 0, 'ANet-子': 1 } as Record<string, number>)[n.id] ?? 0);
ck('反例1:父自身 0、子有 3+2 → 父显示 5(不会被当成空项目)', fullTotals.get('TMAI') === 5 && fullTotals.get('ANet') === 1);
const foldedRows = projectRows(tree, new Set(['TMAI']));
ck('反例1:折叠后父仍在可见行里、子不可见', foldedRows.some(r => r.node.id === 'TMAI') && !foldedRows.some(r => r.node.id === 'TMAI-客户端'));

// 反例 2/3:可见行里去重 —— 父和子不会同时落进「有任务」和「空」两桶。
const withTasks = foldedRows.filter(r => (fullTotals.get(r.node.id) ?? 0) > 0).map(r => r.node.id);
const emptyRows = foldedRows.filter(r => (fullTotals.get(r.node.id) ?? 0) === 0).map(r => r.node.id);
ck('反例2:两桶不相交且并集=可见行', withTasks.every(id => !emptyRows.includes(id))
  && withTasks.length + emptyRows.length === foldedRows.length);
ck('反例3:折叠子树不会被当成根补进空桶', !emptyRows.includes('TMAI-客户端') && !emptyRows.includes('TMAI-Hub'));

// 反例 4:tag_entities 构造父子,筛选用后代集合。
const entities = [
  { id: 't1', name: '发布', parent_id: null, depth: 0 },
  { id: 't2', name: '发布/桌面', parent_id: 't1', depth: 1 },
  { id: 't3', name: '发布/安卓', parent_id: 't1', depth: 1 },
];
const entParents = tagParentsFromEntities(entities)!;
ck('tag_entities → 父子映射(按 id 回名字)', entParents['发布/桌面'] === '发布' && entParents['发布/安卓'] === '发布');
ck('tag_entities 无层级时返回 undefined', tagParentsFromEntities([{ id: 'a', name: 'x', parent_id: null }]) === undefined);
const desc = tagWithDescendants('发布', entParents);
const items = [
  { tags: ['发布'], priority: 'normal', column: 'pool', owners: [], participants: [] },
  { tags: ['发布/安卓'], priority: 'normal', column: 'pool', owners: [], participants: [] },
  { tags: ['其它'], priority: 'normal', column: 'pool', owners: [], participants: [] },
] as never[];
const hit = applyFilter(items, { owners: [], priorities: [], tag: '发布', tagDescendants: { '发布': desc.filter(d => d !== '发布') } } as never);
ck('反例4:按父标签筛选命中后代卡(2/3)', hit.length === 2);
const exact = applyFilter(items, { owners: [], priorities: [], tag: '发布' } as never);
ck('反例4:无层级数据时仍是精确匹配(1/3)', exact.length === 1);
ck('标签深度:有 depth 用 depth,没有就按父链算', tagDepth('发布/桌面', { '发布/桌面': 3 }, entParents) === 3 && tagDepth('发布/安卓', null, entParents) === 1);


// ── #2122 F2–F6 反例(先红后绿)─────────────────────────────────────────
// F2:归档的父项目不进入候选,但「自己 + 后代」的禁选仍要在完整图上算。
const withArchived = [
  P('root', null), P('mid', 'root'), P('leaf', 'mid'), P('free', null),
];
const archivedSet = new Set(['root']);
const candF2 = parentProjectOptions(withArchived, 'root', n => !archivedSet.has(n.id));
ck('F2 父项目归档后不进候选', !candF2.some(n => n.id === 'root'));
const candF2b = parentProjectOptions(withArchived, 'mid', n => !archivedSet.has(n.id));
ck('F2 禁选在完整图上算:归档父不在,但后代仍被排除', !candF2b.some(n => n.id === 'mid' || n.id === 'leaf') && candF2b.some(n => n.id === 'free'));

// F3:只有子标签有卡时,父标签入口仍要在侧栏出现。
const onlyChildCounts = new Map([['发布/桌面', 2]]);
const listedF3 = includeTagAncestors(['发布/桌面'], { '发布/桌面': '发布' }, new Set(['发布/桌面', '发布']));
ck('F3 父标签自身 0 张也出现在侧栏且排在子前', listedF3.join(',') === '发布,发布/桌面');

// F5:显式实体只认 parent_id;名字里的 "/" 不能自己造父子。
const nameSlash = tagParentsFromEntities([{ id: 'a', name: '发布/桌面', parent_id: null } as never]);
ck('F5 名字带斜杠但 parent_id 为空 → 不发明父子', nameSlash === undefined);
const explicit = tagParentsFromEntities([
  { id: 'p', name: '发布', parent_id: null },
  { id: 'c', name: '桌面端', parent_id: 'p' },
] as never)!;
ck('F5 有 parent_id 时按 id 映射父名', explicit['桌面端'] === '发布');
const viaPath = tagParentsFromEntities([
  { id: 'p', name: '发布', parent_id: null, path: '发布' },
  { id: 'c', name: '桌面端', parent_id: null, path: '发布/桌面端' },
] as never)!;
ck('F5 Hub 显式 path 可作父子依据', viaPath['桌面端'] === '发布');

// F4:无层级时必须精确匹配(旧 tagDescendants 不能残留生效)。
const itemsF4 = [{ tags: ['发布/桌面'] }, { tags: ['发布/安卓'] }] as never[];
const stale = applyFilter(itemsF4, { owners: [], priorities: [], tag: '发布', tagDescendants: { '发布': ['发布/桌面', '发布/安卓'] } } as never);
ck('F4 有层级后代时命中子孙(2/2)', stale.length === 2);
const cleared = applyFilter(itemsF4, { owners: [], priorities: [], tag: '发布', tagDescendants: undefined } as never);
ck('F4 层级消失后回到精确匹配(0/2)', cleared.length === 0);

// F6:Hub 合同是 parent_id(驼峰只存在于客户端)。
const hubSrc = readFileSync(new URL('./requirements-hub.ts', import.meta.url), 'utf8');
ck('F6 项目创建/更新把 parentId 翻成 parent_id', /parent_id: parentId/.test(hubSrc));
ck('F6 不再把驼峰 parentId 直接发出去', /const \{ parentId, \.\.\.rest \} = input;/.test(hubSrc) && /const \{ parentId, \.\.\.rest \} = patch;/.test(hubSrc));


// ── #2127 三条反例(先红后绿)─────────────────────────────────────────
// F2:A→B(归档)→C(在用);编辑 A 时 C 仍必须禁选(禁选在完整图算,归档只过滤候选)。
const chain = [P('A', null), P('B', 'A'), P('C', 'B'), P('D', null)];
const archivedB = new Set(['B']);
const cand = parentProjectOptions(chain, 'A', n => !archivedB.has(n.id));
ck('F2 A→B(归档)→C:编辑 A 时 C 仍禁选', !cand.some(n => n.id === 'C'));
ck('F2 归档的 B 不进候选,D 可当父', !cand.some(n => n.id === 'B') && cand.some(n => n.id === 'D'));
ck('F2 页面表达式用完整图 + available 谓词', /parentProjectOptions\(projects, editing\.id, p => !p\.archived\)/.test(manager)
  && /parentProjectOptions\(projects, undefined, p => !p\.archived\)/.test(manager));

// F3:fallback parents 指向目录外的父 → 不合成入口;授权内的父 0 卡仍保留入口。
const fallbackParents = { '发布/桌面': '发布', '外部子': '外部父' };
const known = new Set(['发布/桌面', '发布']);
const listed = includeTagAncestors(['发布/桌面', '外部子'], fallbackParents, known);
ck('F3 授权内父标签(0 卡)保留入口', listed.includes('发布'));
ck('F3 目录外的父不合成入口', !listed.includes('外部父'));

// F4:旧图 P→c / Q→d,换到 Q→d 后再点独立根 P:不得命中 c。
const itemsF4b = [{ tags: ['c'] }, { tags: ['d'] }, { tags: ['P'] }] as never[];
const afterSwitch = { owners: [], priorities: [], tag: 'P', tagDescendants: { P: ['d'] } } as never;
ck('F4 旧 map 残留时会误命中(反例成立:2 张)', applyFilter(itemsF4b, afterSwitch).length === 2);
const overwritten = { owners: [], priorities: [], tag: 'P', tagDescendants: undefined } as never;
ck('F4 覆盖/删除后只命中独立根 P', applyFilter(itemsF4b, overwritten).length === 1
  && applyFilter([{ tags: ['c'] }] as never, overwritten).length === 0);
ck('F4 侧栏覆盖写入而不是合并旧键', /tagFilterAfterPick\(filter, tag, tagCatalog\?\.parents \?\? null\)/.test(side)
  && /tagDescendants: want\.length \? \{ \[current\.tag\]: want \} : undefined/.test(side));

// ── #2127 F4(第二个入口):顶部标签筛选 TaskTagFilter ────────────────────
// 下面调的就是两个入口 onPress 里那一句 `tagFilterAfterPick(当前筛选, tag, parents)`:
// 给定「当前筛选」+ 点哪个标签 + 当前目录,函数返回**进去渲染的那份新筛选**。
const itemsF4c = [{ tags: ['c'] }, { tags: ['d'] }, { tags: ['P'] }] as never[];
const tagOf = (r: unknown) => (r as { tags: string[] }).tags[0];
// 反例 1:旧 map 是 {P:['c'],Q:['d']},当前目录里 P 是独立根 —— 从该入口点 P 不得命中 c。
const fromQ = { owners: [], priorities: [], tag: 'Q', tagDescendants: { P: ['c'], Q: ['d'] } } as never;
ck('F4 前置:旧 map 下当前选中 Q 只命中 d(反例基座成立)', applyFilter(itemsF4c, fromQ).length === 1 && tagOf(applyFilter(itemsF4c, fromQ)[0]) === 'd');
const nextP = tagFilterAfterPick(fromQ, 'P', null);
const pickedP = applyFilter(itemsF4c, nextP);
ck('F4 从 TaskTagFilter 点 P(无层级):只命中独立根 P,不命中 c', pickedP.length === 1 && tagOf(pickedP[0]) === 'P');
ck('F4 从 TaskTagFilter 点 P:旧 {P:["c"]} 被显式清掉(键写 undefined,不靠省略)',
  nextP.tagDescendants === undefined && Object.prototype.hasOwnProperty.call(nextP, 'tagDescendants'));
ck('F4 从 TaskTagFilter 点 P:另一个旧键 Q 也不残留', !('Q' in (nextP.tagDescendants ?? {})) && Object.keys(nextP.tagDescendants ?? {}).length === 0);
// 反例 2:当前目录 P→c —— 从该入口点 P 必须命中 c。
const liveParents = { c: 'P' };
const nextP2 = tagFilterAfterPick(fromQ, 'P', liveParents);
const pickedP2 = applyFilter(itemsF4c, nextP2);
ck('F4 当前 P→c,从 TaskTagFilter 点 P 命中 P 与 c(2 张)', pickedP2.length === 2
  && pickedP2.map(tagOf).sort().join(',') === 'P,c');
ck('F4 当前 P→c:后代 map 覆盖成只有 P→["c"]', JSON.stringify(nextP2.tagDescendants) === '{"P":["c"]}');
// 「全部」:必须显式覆盖(键写 undefined),否则旧图继续生效。
const nextAll = tagFilterAfterPick(fromQ, '', { c: 'P' });
ck('F4 点「全部」清掉后代 map', nextAll.tag === '' && nextAll.tagDescendants === undefined
  && Object.prototype.hasOwnProperty.call(nextAll, 'tagDescendants'));
ck('F4 点「全部」后三张都回来', applyFilter(itemsF4c, nextAll).length === 3);
// 接线:两个入口都调这同一个函数,且「只换 tag」的老写法已不存在。
const tagFilterSrc = readFileSync(new URL('./TaskTags.tsx', import.meta.url), 'utf8');
ck('F4 TaskTagFilter 的 onPress 调 tagFilterAfterPick', /setTaskFilter\(tagFilterAfterPick\(filter, tag, tagParents\)\)/.test(tagFilterSrc));
ck('F4 TaskTagFilter 不再只替换 tag(旧写法已消失)', !/setTaskFilter\(\{ \.\.\.filter, tag, untagged: false \}\)/.test(tagFilterSrc));
ck('F4 两个入口共用同一个函数', /tagFilterAfterPick\(filter, tag, tagCatalog\?\.parents \?\? null\)/.test(side)
  && /tagFilterAfterPick\(filter, tag, tagParents\)/.test(tagFilterSrc));

// ── #2138:父项目 chip × 名称框 blur 的真实事件顺序(可重复事件模型)──────
// 浏览器顺序:pointerdown(chip) → blur(input) → press(chip);编辑行里的 chip 随编辑结束一起卸载。
// 模型里的 rename() 用的就是组件那份判定 projectRenamePatch,onUpdate 收到什么 = updates。
const runPick = (o: { guarded: boolean; picked: string | null; draft?: string; supportsParent?: boolean; current?: { name: string; parentId: string | null } }) => {
  const current = o.current ?? { name: 'A', parentId: null };
  const supports = o.supportsParent ?? true;
  const updates: { name?: string; parentId?: string | null }[] = [];
  let editing = true, parent: string | null = current.parentId, picking = false;
  const rename = (pickedArg?: string | null) => {
    const patch = projectRenamePatch(current, o.draft ?? current.name, pickedArg !== undefined ? pickedArg : parent, supports);
    if (patch) updates.push(patch);
    editing = false;
  };
  if (o.guarded) picking = true;                          // chip onPressIn(pointerdown)
  if (commitOnNameBlur(picking)) rename();                // 名称框 blur
  if (editing) { parent = o.picked; rename(o.picked); }   // chip press(行还在才发生)
  return { updates, editing, parent };
};
const lostClick = runPick({ guarded: false, picked: 'B' });
ck('#2138 反例:不守卫时 blur 先关编辑,父项目没换成(0 次 PATCH)', lostClick.updates.length === 0 && lostClick.parent === null);
const kept = runPick({ guarded: true, picked: 'B' });
ck('#2138 守卫后:onUpdate 只收到 { parentId: "B" },不多发 name', JSON.stringify(kept.updates) === '[{"parentId":"B"}]');
const toNone = runPick({ guarded: true, picked: null, current: { name: 'A', parentId: 'B' } });
ck('#2138 点「无父项目」:发显式 null(不是省略字段)', JSON.stringify(toNone.updates) === '[{"parentId":null}]');
const same = runPick({ guarded: true, picked: 'B', current: { name: 'A', parentId: 'B' } });
ck('#2138 父项目没变:不 PATCH(no-op),编辑照样收起', same.updates.length === 0 && same.editing === false);
const plainBlur = runPick({ guarded: false, picked: 'B', draft: 'A2' });
ck('#2138 普通 blur 改名仍保存 { name: "A2" }', JSON.stringify(plainBlur.updates) === '[{"name":"A2"}]');
const plainEnter = runPick({ guarded: true, picked: 'B', draft: 'A2', current: { name: 'A', parentId: null } });
ck('#2138 名字 + 父项目一起换:一次 PATCH 带两个字段', JSON.stringify(plainEnter.updates) === '[{"name":"A2","parentId":"B"}]');
const oldHub = runPick({ guarded: true, picked: 'B', draft: 'A2', supportsParent: false });
ck('#2138 旧 Hub:永不发 parentId', JSON.stringify(oldHub.updates) === '[{"name":"A2"}]');
ck('#2138 旧 Hub 无变化:不 PATCH', projectRenamePatch({ name: 'A', parentId: null }, 'A', 'B', false) === null);
// Enter 路径:名字框 onSubmitEditing 直接 rename() —— 没有 picked 参数,用当前 editParentId state。
const managerNow = readFileSync(new URL('./TaskProjectManager.tsx', import.meta.url), 'utf8');
const enterAfterPick = (() => {
  const current = { name: 'A', parentId: null };
  let parent: string | null = current.parentId, editing = true;
  const updates: { name?: string; parentId?: string | null }[] = [];
  parent = 'B';                                        // 先点 chip(未失焦前 state 已更新)
  const patch = projectRenamePatch(current, 'A', parent, true); // Enter → rename()
  if (patch) updates.push(patch);
  editing = false;
  return { updates, editing };
})();
ck('#2138 Enter 改名:先点父项目再回车,一次 PATCH { parentId: "B" }', JSON.stringify(enterAfterPick.updates) === '[{"parentId":"B"}]' && enterAfterPick.editing === false);
// 归档候选:编辑行的可选父项目来自 parentProjectOptions(⋯ p => !p.archived),归档项目不可选。
const editCandidates = parentProjectOptions([P('A', null), P('B', null), { ...P('Z', null), archived: true }], 'A', p => !p.archived);
ck('#2138 归档项目不出现在父项目候选里', !editCandidates.some(n => n.id === 'Z') && editCandidates.some(n => n.id === 'B'));
ck('#2138 编辑行的候选 = parentProjectOptions(projects, editing.id, !archived)', /editing \? parentProjectOptions\(projects, editing\.id, p => !p\.archived\) : \[\]/.test(managerNow) || /parentProjectOptions\(projects, editing\.id, p => !p\.archived\)/.test(managerNow));

ck('#2138 接线:名称框 onBlur 走 nameBlurOutcome 并写回 pickingParent', /onBlur=\{\(\) => \{ const d = nameBlurOutcome\(pickingParent\.current\); pickingParent\.current = d\.picking; if \(!d\.commit\) return; void rename\(\); \}\}/.test(managerNow));
ck('#2138 接线:编辑行 chip 在 pointerdown 置位', /onChipPressIn/.test(managerNow) && /pickingParent\.current = true/.test(managerNow));
ck('#2138 接线:点 chip 用点到的那一个值提交', /rename\(parentPatchForPick\(id\)\.parentId\)/.test(managerNow));
ck('#2138 接线:旧 Hub 不渲染父项目控件', /supportsParent \? parentChips\(editParentId/.test(managerNow) || /editing\?\.id === p\.id && supportsParent \? parentChips/.test(managerNow));
ck('#2138 接线:新建表单 chip 不传 onPressIn(不受影响)', /parentChips\(parentId, createParents, setParentId, 'project-new-parent'\)/.test(managerNow));

// ── #2139(1):手机顶部快筛要能选「零直属卡的父标签」──────────────────────
const itemsT = [{ tags: ['发布/桌面'] }, { tags: ['发布/桌面'] }, { tags: ['TMWork'] }] as never[];
const cardTags = ['发布/桌面', 'TMWork'];
ck('#2139 反例:只取卡片标签时父标签不在候选里(选不到)', !cardTags.includes('发布'));
const entries = tagFilterEntries(itemsT, ['发布', '发布/桌面', 'TMWork'], { '发布/桌面': '发布' });
ck('#2139 父标签零直属卡也进候选,且排在子标签前面', entries.includes('发布') && entries.indexOf('发布') < entries.indexOf('发布/桌面'));
const pickedParent = applyFilter(itemsT, tagFilterAfterPick({ owners: [], priorities: [] } as never, '发布', { '发布/桌面': '发布' }));
ck('#2139 选父标签命中两张子卡', pickedParent.length === 2);
ck('#2139 不相干的标签仍在候选里(顺序不乱)', entries.join(',') === '发布,发布/桌面,TMWork');
const ghost = tagFilterEntries([{ tags: ['x'] }] as never, ['x'], { x: '外部父' });
ck('#2139 目录外的父不合成入口', !ghost.includes('外部父') && ghost.includes('x'));
const flatEntries = tagFilterEntries([{ tags: ['b'] }, { tags: ['a'] }, { tags: ['b'] }] as never, null, null);
ck('#2139 旧 Hub:平铺顺序不变、无新增项', JSON.stringify(flatEntries) === '["b","a"]');
ck('#2139 旧 Hub:按标签仍是精确匹配', tagFilterAfterPick({ owners: [], priorities: [] } as never, 'a', null).tagDescendants === undefined);
const quickSrc = readFileSync(new URL('./TaskTags.tsx', import.meta.url), 'utf8');
ck('#2139 接线:TaskTagFilter 用 tagFilterEntries(items, catalogTags, tagParents)', /const tags = tagFilterEntries\(items, catalogTags, tagParents\);/.test(quickSrc));
ck('#2139 接线:不再只从 items 现拼标签', !/const tags = \[\.\.\.new Set\(items\.flatMap/.test(quickSrc));
// admin 2026-10-24(折叠屏):标签可以有几十个,「管理标签」原来挂在横向标签条的最后一个,
// 要横滑很久才看得到 —— 折叠屏上看起来就像「没有管理标签这个功能」。它必须钉在滚动区外面。
const manageAt = quickSrc.indexOf('testID="task-tags-manage"');
const scrollEnd = quickSrc.indexOf('</ScrollView>');
ck('标签筛选:「管理标签」在横向滚动条之外(不会被几十个标签挤到最右端)', manageAt > scrollEnd && scrollEnd > 0);
ck('标签筛选:「管理标签」仍在打开标签条时才出现(match 展开状态)', /\{open \? \(/.test(quickSrc));

// ── #2139(2):pickingParent 的真实复位(取消按压不能把 blur 永久停掉)────
const replay = (draft: string, steps: readonly ('in' | 'out' | 'blur' | 'pressB')[]) => {
  const current = { name: 'A', parentId: null };
  let picking = false, editing = true, parentState: string | null = null;
  const updates: { name?: string; parentId?: string | null }[] = [];
  const rename = (picked?: string | null) => {
    if (!editing) return;
    const patch = projectRenamePatch(current, draft, picked !== undefined ? picked : parentState, true);
    if (patch) updates.push(patch);
    editing = false;
  };
  for (const step of steps) {
    if (step === 'in') picking = true;                                  // chip onPressIn
    else if (step === 'out') picking = false;                           // chip onPressOut(取消也算)
    else if (step === 'blur') {                                         // 名称框 onBlur
      const d = nameBlurOutcome(picking); picking = d.picking;          // 组件写回 ref
      if (d.commit) rename();
    } else if (step === 'pressB') { parentState = 'B'; picking = false; rename('B'); }
  }
  return { updates, picking, editing };
};
const normalPick = replay('A', ['in', 'blur', 'pressB']);
ck('#2139 正常点击:blur 不提交,press 只发 { parentId: "B" }', JSON.stringify(normalPick.updates) === '[{"parentId":"B"}]' && normalPick.picking === false);
const cancelled = replay('A2', ['in', 'blur', 'out', 'blur']);
ck('#2139 取消按压后:标志已复位,下一次普通 blur 正常保存', JSON.stringify(cancelled.updates) === '[{"name":"A2"}]' && cancelled.picking === false && cancelled.editing === false);
const cancelNoOut = replay('A2', ['in', 'blur', 'blur']);
ck('#2139 只靠 blur 消费标志也能复位(onPressOut 缺失时)', cancelNoOut.picking === false);
const outThenBlur = replay('A2', ['in', 'out', 'blur']);
ck('#2139 pressIn → 取消(out) → blur 仍保存改名', JSON.stringify(outThenBlur.updates) === '[{"name":"A2"}]');
const stuck = (() => { // 反例:blur 不复位标志(旧缺陷)
  const current = { name: 'A', parentId: null };
  let picking = true, editing = true;
  const updates: unknown[] = [];
  const blur = (draft: string) => { if (picking) return; const patch = projectRenamePatch(current, draft, null, true); if (patch) updates.push(patch); editing = false; };
  blur('A'); blur('A2');
  return { updates, editing };
})();
ck('#2139 反例:标志不复位时连续 blur 全被跳过(改名丢失)', stuck.updates.length === 0 && stuck.editing === true);
ck('#2139 接线:blur 写回 ref + chip 在 pointerdown/out 置位复位',
  /pickingParent\.current = d\.picking/.test(managerNow) && /pickingParent\.current = true/.test(managerNow) && /pickingParent\.current = false/.test(managerNow)
  && /onChipPressOut/.test(managerNow));


console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
