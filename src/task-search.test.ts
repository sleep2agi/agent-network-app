// 任务页搜索(task-search.ts)。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import {
  EMPTY_SEARCH, SEARCH_DEBOUNCE_MS, descriptionText, focusKindOf, highlightRanges, highlightSegments, isSearchShortcut,
  filterHiddenCount, matchesSearch, needsServerSearch, taskIdQuery, searchFields, searchPool, searchTerms, searchedTasks, visibleTasks, type SearchContext,
} from './task-search';
import { HUB_LIST_CAP, listTruncated } from './requirements-hub';
import { applyFilter, boardColumns, EMPTY_FILTER, NO_PROJECT } from './task-board-model';
import { requirementFromHub } from './requirements-hub';
import type { Requirement } from './requirements-model';
import { t, setLanguagePreference } from './i18n';
import './i18n-tasks';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const R = (id: string, name: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-20T02:00:00Z', owner: null, agentOwner: null, participants: [], ...o,
});
const ctx: SearchContext = {
  people: [
    { kind: 'user', id: 'u1', networkId: 'n', name: '示例负责人' },
    { kind: 'node', id: 'a1', networkId: 'n', name: '示例-门户牛' },
    { kind: 'node', id: 'a2', networkId: 'n', name: 'Builder-Bot' },
  ],
  projects: [{ id: 'p1', name: '示例项目', color: '#000', sort: 1, archived: false }, { id: 'p2', name: 'Portal', color: '#111', sort: 2, archived: false }],
};
const items: Requirement[] = [
  R('r1', '企业组织树权限设置', { owner: { kind: 'user', id: 'u1' }, agentOwner: { kind: 'node', id: 'a1' }, projectId: 'p1', priority: 'high' }),
  R('r2', 'Portal Token 管理 | 估算成本卡布局', { agentOwner: { kind: 'node', id: 'a2' }, projectId: 'p2', column: 'doing', tags: ['前端', 'ux'] }),
  R('r3', 'Space 网络策略 | 历史 receipt 误报', { description: '看 ![截图](/api/files/abc123) 和 [链接文字](https://example.com/x),重启导致 binding 丢失', column: 'done' }),
  R('r4', '子需求:模型目录降级', { parentId: 'r1', participants: [{ kind: 'node', id: 'a2' }], projectId: null }),
  R('r5', '旧 Hub 的卡', { owner: undefined, agentOwner: undefined, assignee: '老王' }),
];
const ids = (rows: readonly Requirement[]) => rows.map(r => r.id).join(',');
const q = (s: string) => ({ ...EMPTY_SEARCH, q: s });

console.log('\n搜索词');
ck('空白切词 + 小写 + 去重', JSON.stringify(searchTerms('  Portal   portal TOKEN ')) === JSON.stringify(['portal', 'token']));
ck('全角字母 / 全角空格按半角算', JSON.stringify(searchTerms('ＰＯＲＴＡＬ　权限')) === JSON.stringify(['portal', '权限']));
ck('只有空白 = 没在搜', searchTerms(' \t ').length === 0);
ck('去抖 120ms 左右', SEARCH_DEBOUNCE_MS >= 100 && SEARCH_DEBOUNCE_MS <= 150);

console.log('\n命中字段');
const m = (id: string, s: string) => matchesSearch(items.find(i => i.id === id)!, searchTerms(s), ctx);
ck('标题(中文子串)', m('r1', '组织树'));
ck('标题(大小写不敏感)', m('r2', 'portal token'));
ck('描述', m('r3', 'binding'));
ck('描述里的图片地址不算', !m('r3', 'abc123') && !m('r3', 'api/files'));
ck('描述里的链接文字算、地址不算', m('r3', '链接文字') && !m('r3', 'example.com'));
ck('负责人显示名', m('r1', '示例负责人'));
ck('负责 Agent 显示名', m('r1', '门户牛'));
ck('参与人显示名', m('r4', 'builder'));
ck('项目名', m('r1', '示例项目') && m('r2', 'portal'));
ck('标签', m('r2', '前端') && m('r2', 'UX'));
ck('旧 Hub 的 assignee 文本', m('r5', '老王'));
ck('不相干的词不命中', !m('r1', 'receipt'));
ck('id 不参与(免得搜 r 全中)', !m('r1', 'r1'));
ck('未知成员(不在成员表)不把「未知成员」当名字以外的东西命中', matchesSearch(R('x', '甲', { agentOwner: { kind: 'node', id: 'zzz' } }), searchTerms('甲'), { people: [], projects: null }));

console.log('\n多个词 = 且');
ck('两个词分别在标题和负责人', m('r1', '权限 门户牛'));
ck('两个词分别在标题和项目', m('r2', '成本 portal'));
ck('一个词不中整条不中', !m('r1', '权限 receipt'));
ck('一个词不会跨两个字段拼出来', !matchesSearch(R('y', '尾巴AB', { description: 'CD头' }), searchTerms('abcd'), ctx));
ck('searchFields 不含空串', searchFields(items[4], ctx).every(Boolean));
ck('descriptionText 去掉 html 标签', descriptionText('<b>粗</b>体') === ' 粗 体');

console.log('\n和筛选叠加');
const vis = (s: string, f = EMPTY_FILTER) => ids(visibleTasks(items, [], f, q(s), ctx));
ck('没有搜索词 = 原样(同一个数组)', searchedTasks(items, [], EMPTY_SEARCH, ctx) === items);
ck('只搜', vis('portal') === 'r2');
ck('搜 + 优先级', vis('示例', { ...EMPTY_FILTER, priorities: ['high'] }) === 'r1');
ck('搜 + 状态(完成的在状态筛选允许时出现)', vis('receipt') === 'r3' && vis('receipt', { ...EMPTY_FILTER, statuses: ['pool', 'doing'] }) === '');
ck('搜 + 项目', vis('builder', { ...EMPTY_FILTER, project: NO_PROJECT }) === 'r4' && vis('builder', { ...EMPTY_FILTER, project: 'p2' }) === 'r2');
ck('搜 + 只看顶层', vis('builder', { ...EMPTY_FILTER, topLevel: true }) === 'r2');
ck('搜 + 标签', vis('portal', { ...EMPTY_FILTER, tag: 'ux' }) === 'r2' && vis('组织', { ...EMPTY_FILTER, tag: 'ux' }) === '');
ck('搜 + 负责人', vis('示例', { ...EMPTY_FILTER, owners: ['node:a1'] }) === 'r1');
const cols = boardColumns(searchedTasks(items, [], q('portal 成本'), ctx), EMPTY_FILTER);
ck('看板列按搜索结果分组(列里的数就是搜到的数)', cols.find(c => c.column === 'doing')!.items.length === 1 && cols.find(c => c.column === 'pool')!.items.length === 0);

console.log('\n任务 ID(#563)');
const withSeq = [R('req_0a1b2c3d4e5f', '无关标题一', { seq: 12 }), R('req_99887766aabb', '标题里有 12 的任务', { seq: 3 }), R('req_55554444cccc', '别的', { seq: 120 })];
const idv = (s: string) => ids(visibleTasks(withSeq, [], EMPTY_FILTER, q(s), ctx));
ck('#12 对上短号 12,即使标题里没有 12', idv('#12') === 'req_0a1b2c3d4e5f');
ck('全角「＃１２」同样对上', idv('＃１２') === 'req_0a1b2c3d4e5f' && taskIdQuery(' ＃１２ ') === '#12');
ck('裸「12」:短号 12 或标题含 12 都算(整句「或」)', idv('12') === 'req_0a1b2c3d4e5f,req_99887766aabb');
ck('#12 不会命中 #120', !idv('#12').includes('req_55554444cccc'));
ck('完整 id / 8 位前缀对主键', idv('req_99887766aabb') === 'req_99887766aabb' && idv('55554444cc') === 'req_55554444cccc');
ck('ID 也受筛选管', ids(visibleTasks(withSeq, [], { ...EMPTY_FILTER, statuses: ['done'] }, q('#12'), ctx)) === '');
ck('「#12 portal」整句不是 ID,照文字「且」匹配(不把 ID 和文字拆开)', idv('#12 无关') === '');

ck('ID 命中和服务端结果一起:本机 ID 命中在前,服务端更老的卡并在后面', ids(searchedTasks(withSeq, [], q('#12'), ctx, [R('old9', '更老的卡')])) === 'req_0a1b2c3d4e5f,old9');

console.log('\n包含已归档');
const arch = [R('z1', '归档的组织树旧方案', { archived: true }), R('r1', '同 id:本机那份优先', { archived: true })];
// Owner 2026-10-01「经常…搜不到那个历史任务」:做完的卡常被归档,「包含已归档」默认开。
ck('默认就含归档(EMPTY_SEARCH.archived = true),排在本机行后面', EMPTY_SEARCH.archived === true && ids(visibleTasks(items, arch, EMPTY_FILTER, q('组织树'), ctx)) === 'r1,z1');
ck('关掉才不含', ids(visibleTasks(items, arch, EMPTY_FILTER, { q: '组织树', archived: false }, ctx)) === 'r1');
ck('勾了但没有搜索词:不混进来', searchPool(items, arch, { q: '', archived: true }) === items);
ck('同一个 id 用本机那份', searchPool(items, arch, { q: 'x', archived: true }).filter(r => r.id === 'r1').length === 1 && !searchPool(items, arch, { q: 'x', archived: true }).find(r => r.id === 'r1')!.archived);
ck('归档的也受筛选管', ids(visibleTasks(items, arch, { ...EMPTY_FILTER, priorities: ['high'] }, { q: '组织树', archived: true }, ctx)) === 'r1');
ck('Hub 行里 archived 不影响普通解析(没有这个字段)', requirementFromHub({ id: 'h', name: 'x', archived: true })?.archived === undefined);

console.log('\n服务端搜索');
ck('新 Hub:has_more 说了算', listTruncated({ has_more: true }, 3) && !listTruncated({ has_more: false }, 500));
ck('旧 Hub(没有 has_more):正好 500 张当截断,少于 500 不算', listTruncated({}, HUB_LIST_CAP) && !listTruncated({}, 499) && HUB_LIST_CAP === 500);
// 以前只在「本机的表被截断」时问:没截断时归档的、只在描述里的词(精简行没有正文)都搜不到。
ck('Hub 支持 search 且有搜索词就问服务端(不看截不截断)', needsServerSearch(['search'], q('x')) && !needsServerSearch([], q('x')) && !needsServerSearch(['search'], q('  ')));
const oldArchived = R('old2', '很久以前归档的组织树', { archived: true, column: 'done' });
ck('服务端的归档行(include_archived=1 回来的)并进结果并保留 archived 标记', (() => { const r = searchedTasks(items, [], q('组织树'), ctx, [oldArchived]); return ids(r) === 'r1,old2' && r[1].archived === true; })());
const old1 = R('old1', '很久以前的组织树');
ck('服务端找到的更老的卡并进结果(排在本机结果后面)', ids(searchedTasks(items, [], q('组织树'), ctx, [old1])) === 'r1,old1');
ck('服务端结果里本机已有的不重复', ids(searchedTasks(items, [], q('组织树'), ctx, [items[0], old1])) === 'r1,old1');
ck('本机有、本机判不匹配的卡不被服务端结果带回来(本机是新的)', ids(searchedTasks(items, [], q('组织树'), ctx, [{ ...items[1] }])) === 'r1');
ck('服务端的卡也受筛选管', ids(visibleTasks(items, [], { ...EMPTY_FILTER, priorities: ['high'] }, q('组织树'), ctx, [old1])) === 'r1');
ck('没有搜索词:服务端结果不混进来', searchedTasks(items, [], EMPTY_SEARCH, ctx, [old1]) === items);

console.log('\n被筛选挡住的结果');
{
  const searched = searchedTasks(items, [], q('组织树'), ctx, [old1]);
  const visible = applyFilter(searched, { ...EMPTY_FILTER, priorities: ['high'] });
  ck('数得出被筛选挡住了几个', filterHiddenCount(searched, visible) === 1 && filterHiddenCount(searched, searched) === 0);
}

console.log('\n高亮区间');
const hr = (text: string, s: string) => JSON.stringify(highlightRanges(text, searchTerms(s)));
ck('中文子串', hr('企业组织树权限设置', '组织树') === '[[2,5]]');
ck('大小写不敏感,位置落在原文', hr('Portal Token', 'token') === '[[7,12]]');
ck('多处命中', hr('abcabc', 'bc') === '[[1,3],[4,6]]');
ck('两个词重叠 / 相邻就合并', hr('组织树权限', '组织 织树权') === '[[0,4]]' && hr('ab-cd', 'ab -') === '[[0,3]]');
ck('全角原文、半角搜索词:区间覆盖全角字', hr('ＡＢＣ测试', 'bc') === '[[1,3]]');
ck('原文里有 emoji(代理对)下标不乱', hr('🚀发布上线', '上线') === '[[4,6]]');
ck('没有搜索词没有区间', highlightRanges('abc', []).length === 0);
const seg = highlightSegments('Space 网络策略', searchTerms('网络'));
ck('切段:普通 / 命中 / 普通,拼回去等于原文', seg.map(x => x.text).join('') === 'Space 网络策略' && seg.filter(x => x.hit).map(x => x.text).join() === '网络');
ck('没命中就是一段原文', highlightSegments('abc', ['x']).length === 1);

console.log('\n快捷键');
ck('「/」在普通位置聚焦', isSearchShortcut({ key: '/' }, 'none', false));
ck('「/」在输入框里照常打字', !isSearchShortcut({ key: '/' }, 'input', false) && !isSearchShortcut({ key: '/' }, 'rich', false));
ck('「搜索」快捷键(⌘/Ctrl+K)聚焦,输入框里也行', isSearchShortcut({ key: 'k', ctrlKey: true }, 'input', true) && isSearchShortcut({ key: 'k', metaKey: true }, 'none', true));
ck('描述编辑器(富文本)里 Ctrl+K 留给插入链接', !isSearchShortcut({ key: 'k', ctrlKey: true }, 'rich', true));
ck('不是「搜索」那条组合的 Ctrl+K 不接(用户改了绑定)', !isSearchShortcut({ key: 'k', ctrlKey: true }, 'none', false));
ck('Ctrl+/ 不当「/」', !isSearchShortcut({ key: '/', ctrlKey: true }, 'none', false));
ck('focusKindOf', focusKindOf({ tagName: 'input' }) === 'input' && focusKindOf({ tagName: 'DIV', isContentEditable: true }) === 'rich' && focusKindOf({ tagName: 'DIV' }) === 'none' && focusKindOf(null) === 'none');

console.log('\n接线(静态)');
const board = src('./RequirementBoard.tsx');
ck('看板 / 列表 / 甘特图都从搜索后的集合取', /const searched = useMemo\(\(\) => searchedTasks\(items, archived, search/.test(board) && /const visible = useMemo\(\(\) => applyFilter\(searched, filter\)/.test(board) && /const columns = useMemo\(\(\) => boardColumns\(searched, filter\)/.test(board));
ck('甘特图 / 日历拿的都是 visible(搜索 + 筛选后的集合)', /<TaskGantt items=\{visible\}/.test(board) && /<TaskCalendar items=\{visible\} terms=\{terms\}/.test(board));
ck('日历标题高亮(四处)', (src('./TaskCalendar.tsx').match(/highlight\([a-z.]*name, terms\)/g) ?? []).length === 4);
ck('没有结果时出「没找到」', board.includes('<SearchEmpty q={search.q}'));
ck('去抖用常量', board.includes('SEARCH_DEBOUNCE_MS'));
ck('⌘K 走设置里「搜索」的绑定,window 捕获阶段抢在全局快捷键前面', board.includes("=== 'nav.search'") && board.includes("win.addEventListener('keydown', onKey, true)"));
ck('旧 Hub(没有 search):归档只在勾选 + 有搜索词时整表读一次', /const wantArchived = archivedCapable && search\.archived && !!searchTerms\(search\.q\)\.length && !serverSearchCap/.test(board) && board.includes('listArchivedRequirements(cfg)'));
ck('列表标题高亮', /highlight\((item\.name|titleText\(item\)), terms\)/.test(src('./TaskListTable.tsx')));
ck('甘特图标题高亮(四处)', (src('./TaskGantt.tsx').match(/highlight\([a-z.]*name, terms\)/g) ?? []).length === 4);
ck('共享状态里有 search,换网络清空', /search: EMPTY_SEARCH/.test(src('./task-board-store.ts')));
ck('Hub 支持 search 时问服务端(连归档的一起),结果并进 searchedTasks', board.includes('needsServerSearch(serverSearchCap') && board.includes('searchRequirementsOnHub(cfg, search.q, { includeArchived: includeArchivedOnServer })') && /searchedTasks\(items, archived, search, \{ people, projects \}, extraHits\)/.test(board));
ck('「加载更多」带上一页的 cursor,按 key 丢掉换词前的回包', board.includes('cursor: next })') && board.includes('if (cur.key !== key) return cur;'));
ck('搜索时结果上方有状态行:被筛选挡住的个数 + 清除筛选 + 加载更多', board.includes('<SearchStatusBar') && board.includes('hidden={filterHiddenCount(searched, visible)}') && board.includes('more={serverCurrent && !!serverHits.next}'));
ck('请求带 include_archived=1 / cursor,回包按 has_more + next_cursor 给下一页', /include_archived=1/.test(src('./requirements-hub.ts')) && /data\.has_more === true && typeof data\.next_cursor === 'string'/.test(src('./requirements-hub.ts')));
ck('首屏和轮询都更新 truncated', (board.match(/truncated: cut \}\);/g) ?? []).length === 2);

console.log('\n文案');
for (const lang of ['zh', 'en'] as const) {
  setLanguagePreference(lang);
  ck(`${lang}:搜索文案都有翻译`, ['taskSearch.placeholder', 'taskSearch.cancel', 'taskSearch.clear', 'taskSearch.includeArchived', 'taskSearch.archived', 'taskSearch.empty', 'taskSearch.hint', 'taskSearch.hiddenByFilter', 'taskSearch.clearFilters', 'taskSearch.loadMore', 'taskSearch.loadingMore'].every(k => t(k) !== k));
}
setLanguagePreference('zh');
ck('没找到的原话', t('taskSearch.empty', { q: '发布' }) === '没有找到包含 “发布” 的任务');
ck('包含已归档的原话', t('taskSearch.includeArchived') === '包含已归档' && t('taskSearch.cancel') === '取消');

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
