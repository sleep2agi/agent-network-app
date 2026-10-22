// #2064 regression: the two P2 defects from PR1031.
//
// These assertions are written against the CURRENT behaviour first (the `legacy*` helpers
// below copy what 0.2.287 actually did), so the suite fails on that code and passes only
// after the block expands on search and offers a way past row 8.
import { readFileSync } from 'node:fs';
import * as view from './registered-agents-view';
import {
  REGISTERED_PAGE, registeredExpanded, registeredHiddenCount, registeredNeedsMore, registeredVisibleCount,
} from './registered-agents-view';
import { registeredAgentRows } from './registered-agents';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); };
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

// ---- defect 1: a search that only matches registered nodes must show them ----------
// 0.2.287 behaviour: the block ignored the query and stayed collapsed.
const legacyExpanded = (_query: string, collapsed: boolean) => !collapsed;

ck('旧实现：有查询时仍然按折叠状态决定（这就是缺陷）', legacyExpanded('鲸', true) === false);
ck('修复后：查询非空强制展开', registeredExpanded('鲸', true) === true);
ck('修复后：空白查询不改变折叠语义', registeredExpanded('   ', true) === false && registeredExpanded('', false) === true);
ck('修复后：只有已登记节点命中也能显示行', (() => {
  const row = {
    kind: 'registered', association: 'unconfirmed',
    node: { network_id: 'n1', node_id: 'nd1', alias: 'TMAI鲸', runtime: null },
  } as any;
  const rows = registeredAgentRows([row], { query: '鲸', match: () => true, excludeIdentities: new Set<string>() });
  return rows.length === 1 && registeredExpanded('鲸', true);
})(), 'row 未出现或未展开');

// ---- defect 2: rows past the page size must stay reachable -------------------------
ck('旧实现：第 9 个之后没有任何入口', (() => {
  const legacyVisible = (total: number) => Math.min(total, REGISTERED_PAGE);
  return legacyVisible(12) === 8; // 只说明旧代码截断，入口由下一行断言
})());
ck('修复后：需要 more 入口（短列表也一样）', registeredNeedsMore(12, false) && registeredNeedsMore(9, false));
ck('修复后：全部展开后不再需要入口', registeredNeedsMore(12, true) === false);
ck('修复后：页大小边界', registeredVisibleCount(8, false) === 8 && registeredNeedsMore(8, false) === false);
ck('修复后：隐藏计数可读', registeredHiddenCount(12, false) === 4 && registeredHiddenCount(12, true) === 0);
ck('修复后：0 行不渲染入口', registeredVisibleCount(0, false) === 0 && registeredNeedsMore(0, false) === false);

// ---- source contract: the component must USE these decisions ------------------------
const section = src('RegisteredAgentsSection.tsx');
const screen = src('AgentsScreen.tsx');
ck('组件引用 registeredExpanded / 分页助手', /registeredExpanded/.test(section) && /registeredVisibleCount|registeredNeedsMore/.test(section));
ck('组件提供 show-more 入口（testID 可点）', /registered-agents-more/.test(section) && /onPress|Pressable/.test(section));
ck('页面把 query 传进区块（否则搜索命中仍不可见）', /query=\{query\}|query:\s*query/.test(screen) && /<RegisteredAgentsSection[\s\S]*?query/.test(screen));

// ---- review 5617180895, three P2s -------------------------------------------------
const fn = (n: string): any => (typeof (view as any)[n] === 'function' ? (view as any)[n] : null);

ck('新增决策已注册（缺一即失败）',
  !!fn('registeredToggleEnabled') && !!fn('showAllScopeKey') && !!fn('searchCountLabel') && !!fn('searchHasMatches'));

// P2-1: a search must not read "0 / N" while matching registered rows are visible.
const label = fn('searchCountLabel');
ck('只命中已登记节点时计数不为 0/N', label ? (() => {
  const out = label('鲸', 0, 40, 3);
  return typeof out === 'string' && out !== '0 / 40 agents' && out.includes('3');
})() : false);
ck('命中 live 会话时保持原格式', label ? label('wf', 2, 40, 0) === '2 / 40 agents' : false);
ck('空态判定把已登记节点算作命中', !!fn('searchHasMatches') && fn('searchHasMatches')(0, 2) === true && fn('searchHasMatches')(0, 0) === false);

// P2-2: while the search forces the block open, the header must not silently flip it.
ck('搜态禁用折叠开关', !!fn('registeredToggleEnabled') && fn('registeredToggleEnabled')('鲸') === false);
ck('非搜态仍可折叠', !!fn('registeredToggleEnabled') && fn('registeredToggleEnabled')('  ') === true);

// P2-3: showAll is scoped to a query + row set.
const key = fn('showAllScopeKey');
ck('query 变化使 showAll 失效', key ? key('鲸', ['a']) !== key('', ['a']) : false);
ck('row set 变化使 showAll 失效', key ? key('', ['a']) !== key('', ['a', 'b']) : false);
ck('同一作用域内保持稳定', key ? key('鲸', ['a', 'b']) === key('鲸', ['a', 'b']) : false);

const section2 = src('RegisteredAgentsSection.tsx');
const screen2 = src('AgentsScreen.tsx');
ck('区块按作用域重置 showAll', /showAllScopeKey\(query, rows\.map/.test(section2) && /useEffect\([\s\S]{0,80}setShowAll\(false\)/.test(section2));
ck('搜态 header 不再调用 onToggle', /registeredToggleEnabled/.test(section2) && /onPress=\{toggleEnabled \? onToggle : undefined\}/.test(section2));
ck('页面空态在存在已登记行时不渲染', /registeredRows\.length > 0 \? null :/.test(screen2));
ck('页面计数纳入已登记行', /searchCountLabel\(q, shownCount, sessions\.length, registeredRows\.length\)/.test(screen2));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
