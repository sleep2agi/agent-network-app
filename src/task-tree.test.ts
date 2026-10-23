// #2098 / #2102:项目树与标签层级的纯判定。
// 关键约束:**没有 parent 数据时必须与旧的平铺完全一致**(顺序、深度、计数都不变)。
import { aggregateCounts, descendantIds, hasHierarchy, hubExposesProjectParent, parentProjectOptions, projectRows, tagAncestors, tagRows, tagWithDescendants } from './task-tree';

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
ck('侧栏用 projectRows 渲染项目树', /projectRows\(activeProjects\(projects\)/.test(side));
ck('侧栏用 aggregateCounts 聚合祖先计数', /aggregateCounts\(rows, p => pCounts\.get\(p\.id\) \?\? 0\)/.test(side));
ck('侧栏用 tagRows + tagCatalog.parents 渲染标签层级', /tagRows\(tagNames, tagCatalog\?\.parents \?\? null\)/.test(side));
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
ck('管理页:编辑用 parentProjectOptions(active, editing.id) 排除自身与后代', /parentProjectOptions\(active, editing\.id\)/.test(manager));
ck('管理页:编辑保存时只在父项目变化时发 parentId', /if \(parentChanged\) patch\.parentId = nextParent \?\? null;/.test(manager));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
