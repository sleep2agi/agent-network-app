// 会话列表「全部 / 未读 N」(board #449) — run: bun src/conversation-tab.test.ts
// 钉住:N 的口径(会话数,不是消息数;只数列表里会出现的;标为未读也算)、未读视图的取舍(正打开的那一个不抽走)、
// 存储值的容错,以及 AgentsScreen 里的接线(屏幕组件 import react-native,接线按源码文本查,同 agent-list-wiring.test.ts)。
import { readFileSync } from 'node:fs';
import {
  applyConversationTab,
  applyConversationTabToPeople,
  formatTabCount,
  isUnreadConversation,
  parseConversationTab,
  unreadConversationCount,
} from './conversation-tab';
import { agentUnreadCounts } from './agent-unread-counts';
import { initialUnreadState } from './unread-ledger';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const rows = ['甲', '乙', '丙', '丁'].map(alias => ({ alias }));
const counts = { 甲: 12, 丙: 1, 已删: 5 };

// ── N 的口径 ──
ck('N = 有未读的会话数(12 条 + 1 条 → 2,不是 13)', unreadConversationCount(rows.map(r => r.alias), { counts }) === 2);
ck('列表里没有的 alias(已删 / 隐藏)不进 N', unreadConversationCount(['甲'], { counts }) === 1);
ck('标为未读的会话也算(行上是红点)', unreadConversationCount(rows.map(r => r.alias), { counts, manualUnread: ['丁'] }) === 3);
ck('同一个 alias 重复只算一次', unreadConversationCount(['甲', '甲'], { counts }) === 1);
ck('人员私信未读也是会话', unreadConversationCount(['乙'], { counts }, [{ unread: 3 }, { unread: 0 }]) === 1);
ck('没有未读 → 0', unreadConversationCount(['乙', '丁'], { counts }) === 0);

// N 与托盘 / 「新消息」组同源:同一个 agentUnreadCounts 快照。
const snap = {
  serverBody: { ok: true, messages: [], unread_by_agent: { 甲: 4, 丙: 2 } },
  ledger: initialUnreadState(),
  replyRows: [],
  replyUsername: '',
  replyWatermarks: {},
};
ck('与 agentUnreadCounts(托盘角标同一函数)同源', unreadConversationCount(rows.map(r => r.alias), { counts: agentUnreadCounts(snap as any) }) === 2);

// ── 显示 ──
ck('0 → 不显示数字', formatTabCount(0) === '');
ck('52 → "52"', formatTabCount(52) === '52');
ck('100 → "99+"(与行角标同一个上限)', formatTabCount(100) === '99+');
ck('NaN → 不显示', formatTabCount(Number.NaN) === '');

// ── 视图取舍 ──
const all = applyConversationTab(rows, 'all', { counts });
ck('「全部」原样返回同一个数组(不触发下游重算)', all === rows);
const unread = applyConversationTab(rows, 'unread', { counts });
ck('「未读」只留有未读的', unread.map(r => r.alias).join() === '甲,丙');
ck('「未读」包含标为未读的', applyConversationTab(rows, 'unread', { counts, manualUnread: ['丁'] }).map(r => r.alias).join() === '甲,丙,丁');
ck('正打开着的会话读完了也留在未读视图(不在用户眼前抽走)', applyConversationTab(rows, 'unread', { counts }, '乙').map(r => r.alias).join() === '甲,乙,丙');
ck('离开它(keep 换成别的 / 清空)后,它从未读视图消失', applyConversationTab(rows, 'unread', { counts }, null).map(r => r.alias).join() === '甲,丙');
ck('保持原顺序(排序交给 buildSections)', applyConversationTab([{ alias: '丙' }, { alias: '甲' }], 'unread', { counts }).map(r => r.alias).join() === '丙,甲');
const people = [{ username: 'a', unread: 0 }, { username: 'b', unread: 2 }];
ck('人员:未读视图只留有私信未读的人', applyConversationTabToPeople(people, 'unread').map(p => p.username).join() === 'b');
ck('人员:正打开的私信也留着', applyConversationTabToPeople(people, 'unread', 'a').map(p => p.username).join() === 'a,b');
ck('人员:「全部」原样', applyConversationTabToPeople(people, 'all') === people);
ck('isUnreadConversation: 数 > 0 或标为未读', isUnreadConversation('甲', { counts }) && !isUnreadConversation('乙', { counts }) && isUnreadConversation('乙', { counts, manualUnread: ['乙'] }));

// ── 存储值容错 ──
ck('"unread" → unread', parseConversationTab('unread') === 'unread');
ck('坏值 / null / 旧值 → all(不让人以为会话都没了)', ['', null, undefined, 'marked', 42].every(v => parseConversationTab(v) === 'all'));

// ── 接线(源码文本) ──
const screen = read('./AgentsScreen.tsx');
const prefs = read('./agent-list-prefs.ts');
ck('只在会话列表(能置顶的那个)上出现', screen.includes('const showTabs = rowMenu;'));
ck('N 取实时未读(liveUnread),只数可见会话 + 人员', /unreadConversationCount\(\s*visibleSessions\.map\(s => s\.alias\),\s*\{ counts: liveUnread\.counts, manualUnread: convFlags\.manualUnread \},\s*onOpenPerson \? people : \[\],\s*\)/.test(screen));
ck('视图过滤用 floatInput(与「新消息」组同一份,指针移动时按住)+ keep = 当前打开的会话', screen.includes('applyConversationTab(visibleSessions, effectiveTab, { counts: floatInput.counts, manualUnread: convFlags.manualUnread }, selectedAlias)'));
ck('分组吃过滤后的会话', screen.includes('buildSections(applyAgentFilter(tabbedSessions, activeFilter), query, {'));
ck('人员同样按 tab 过滤,keep = 当前私信', screen.includes('applyConversationTabToPeople(people, effectiveTab, selectedPerson)'));
ck('切换即保存(每台设备)', /setTabState\(next\);\s*void saveConversationTab\(next\);/.test(screen));
ck('首帧用已知的值,不先闪「全部」', screen.includes("useState<ConversationTab>(() => peekConversationTab() ?? 'all')"));
ck('未读视图空态说清楚并给「查看全部」', screen.includes('testID="agents-empty-unread"') && screen.includes("onPress={() => setTab('all')}"));
ck('分段控件的 testID / a11y 角色', screen.includes('testID="conversation-tabs"') && screen.includes('accessibilityRole="tablist"') && screen.includes('accessibilityRole="tab"'));
ck('不做「标记」(暂缓)', !/conversation-tab-marked|chat\.tabMarked/.test(screen));
ck('prefs:独立的键 agent_list_tab_v1,值走 parseConversationTab', prefs.includes("'agent_list_tab_v1'") && prefs.includes('parseConversationTab(await readKey(CONVERSATION_TAB_KEY))'));

console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
