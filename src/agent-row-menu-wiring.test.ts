// 会话行菜单的接线 —— run: bun src/agent-row-menu-wiring.test.ts
// 屏幕 import react-native,ck 测试 import 不了,所以这里读源码文本(CRLF 归一,Windows 检出一样)。
// 行为本身由 agent-row-menu.test.ts 的纯函数钉住;这里只证明屏幕真的走到那些函数。
//
// 两层分开(CLAUDE.md ⑤):
//   取集 —— 递归扫 src/ 与 App.tsx 里所有 `<AgentsScreen` 挂载点(路径统一成 POSIX,Windows 检出同一套键);
//   判据 —— 每个「会话列表」挂载点(给了 onTogglePin 的)都要把免打扰也接上,菜单才完整。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };
const srcDir = fileURLToPath(new URL('.', import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const app = read('../App.tsx');
const agents = read('./AgentsScreen.tsx');
const menu = read('./AgentRowMenu.tsx');
const chat = read('./ChatScreen.tsx');
const badge = read('./AgentUnreadBadge.tsx');
const flags = read('./conversation-flags.ts');

// ── 取集:所有 <AgentsScreen …> 挂载点 ───────────────────────────────────────
/** `<AgentsScreen` 起到它的 `/>` 为止,花括号内的 `>` / `/>` 不算结束。 */
export function agentsScreenTags(src: string): string[] {
  const out: string[] = [];
  const re = /<AgentsScreen\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '/' && src[i + 1] === '>' && depth === 0) { i++; break; }
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}
// 判据自检:已知阳性 / 阴性先喂进去
{
  const tags = agentsScreenTags('<AgentsScreen cfg={cfg} onTogglePin={a => { if (a > 1) f(); }} />\n<AgentsScreen cfg={c} />');
  ck('self-test: two tags, `>` inside braces does not end a tag', tags.length === 2 && tags[0].includes('f(); }}') && tags[1] === '<AgentsScreen cfg={c} />');
  ck('self-test: <AgentsScreenX> is not a mount', agentsScreenTags('<AgentsScreenX />').length === 0);
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap(e => {
  const full = join(dir, e);
  if (statSync(full).isDirectory()) return e === 'node_modules' ? [] : walk(full);
  return /\.tsx$/.test(e) ? [full] : [];
});
const rel = (full: string) => full.replace(/\\/g, '/').split('/').slice(-2).join('/'); // POSIX
const mounts: { file: string; tag: string }[] = [];
for (const f of [...walk(srcDir), fileURLToPath(new URL('../App.tsx', import.meta.url))]) {
  for (const tag of agentsScreenTags(readFileSync(f, 'utf8').replace(/\r\n?/g, '\n'))) mounts.push({ file: rel(f), tag });
}
const listMounts = mounts.filter(m => /\bonTogglePin=/.test(m.tag));
ck(`collect: found ${mounts.length} <AgentsScreen> mounts (phone, two-pane, desktop, server nodes, fixture)`, mounts.length >= 5);
ck('collect: paths are POSIX', mounts.every(m => !m.file.includes('\\')));
ck('collect: the three chat-list mounts (phone / two-pane / desktop) are the ones with onTogglePin', listMounts.length === 3 && listMounts.every(m => m.file.endsWith('App.tsx')));
for (const [i, m] of listMounts.entries()) {
  ck(`chat-list mount #${i + 1} wires 消息免打扰 too (onToggleMute + mutedAliases)`, /\bonToggleMute=\{toggleMute\}/.test(m.tag) && /\bmutedAliases=\{mutedAliases\}/.test(m.tag));
  ck(`chat-list mount #${i + 1} keeps 节点详情 reachable (onOpenNodeDetail)`, /onOpenNodeDetail=\{alias => setScreen\(\{ name: 'nodeDetail', alias \}\)\}/.test(m.tag));
}
ck('desktop list also gets 在新窗口打开', listMounts.filter(m => /\bonOpenChatWindow=/.test(m.tag)).length === 1);

// ── AgentsScreen:长按 / 右键都打开同一份菜单 ─────────────────────────────
ck('menu exists only on chat lists (the ones that can pin)', agents.includes('const rowMenu = !!onTogglePin;'));
const phoneRow = agents.slice(agents.indexOf('const renderPhoneRow = (item: Session) => {'), agents.indexOf('  return (\n    <View style={{ flex: 1'));
ck('phone row: long-press opens the menu at the press point', phoneRow.includes('onLongPress={rowMenu ? e => openRowMenu(item.alias, e.nativeEvent.pageX, e.nativeEvent.pageY) : () => onOpenNodeDetail(item.alias)}'));
ck('phone row: tap still opens the chat', phoneRow.includes('onPress={() => openChat(item.alias)}'));
ck('phone row: web right-click target (data-agent-alias) only when there is a menu', phoneRow.includes('{...(rowMenu ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}'));
ck('phone row: the pressed row keeps its pressed tint while its menu is open', phoneRow.includes('pressed || menuFor?.alias === item.alias ? colors.rowHover : colors.bg'));
const deskRow = agents.slice(agents.indexOf('const renderCompactRow = (item: Session) => {'), agents.indexOf('const renderPhoneRow'));
ck('desktop row: still no long-press (mouse), right-click target kept', deskRow.includes('onLongPress={compact ? undefined') && deskRow.includes('dataSet: { agentAlias: item.alias }'));
const ctxStart = agents.indexOf('const handleContextMenu = (event: any) => {');
const ctx = agents.slice(ctxStart, agents.indexOf('}, [rowMenu, openRowMenu]);', ctxStart));
ck('right-click (capture phase) opens the same menu at the cursor', ctx.includes('openRowMenu(alias, event.clientX ?? event.pageX ?? 180, event.clientY ?? event.pageY ?? 180);') && ctx.includes('event.preventDefault?.();'));
ck('right-click handler is bound on web whenever there is a menu (desktop and web phone layout)', agents.includes("if (!rowMenu || Platform.OS !== 'web' || !doc?.addEventListener) return;"));
ck('the old inline desktop context menu is gone (one menu, not two)', !agents.includes('setContextMenu') && !agents.includes("'置顶会话'") && !agents.includes('在新窗口打开'));
ck('one <AgentRowMenu> mounted, closed by clearing menuFor', (agents.match(/<AgentRowMenu\b/g) ?? []).length === 1 && agents.includes('<AgentRowMenu target={menuFor} items={menuItems} touch={!compact} onSelect={onRowMenu} onClose={() => setMenuFor(null)} />'));
ck('items come from agentRowMenuItems with each action gated on its callback', /agentRowMenuItems\(\{[\s\S]*?canPin: !!onTogglePin,\s*canMute: !!onToggleMute,\s*canOpenWindow: !!onOpenChatWindow,/.test(agents));
ck('item states: unread = real count or manual mark; pinned / muted / hidden from the same sources as the row',
  agents.includes('unread: rowIsUnread(rowUnreadCount(menuFor.alias), convFlags.manualUnread.includes(menuFor.alias)),')
  && agents.includes('pinned: pinnedAliases.includes(menuFor.alias),') && agents.includes('muted: mutedAliases.includes(menuFor.alias),')
  && agents.includes('hidden: isConversationHidden(convFlags, menuFor.alias, liveUnread.lastAt[menuFor.alias] ?? 0),'));
const handler = agents.slice(agents.indexOf('const onRowMenu = (key: AgentRowMenuKey, alias: string) => {'), agents.indexOf('const openChat = (alias: string) => {'));
ck('pin → onTogglePin', handler.includes("case 'pin': onTogglePin?.(alias); return;"));
ck('mute → onToggleMute', handler.includes("case 'mute': onToggleMute?.(alias); return;"));
ck('openWindow → onOpenChatWindow', handler.includes("case 'openWindow': onOpenChatWindow?.(alias); return;"));
ck('detail → onOpenNodeDetail (the old long-press action)', handler.includes("case 'detail': onOpenNodeDetail(alias); return;"));
const readCase = handler.slice(handler.indexOf("case 'read':"), handler.indexOf("case 'pin':"));
ck('标为已读: clears the manual mark, then the real unread locally and on the hub (same ack as ChatScreen)',
  /if \(rowIsUnread\(rowUnreadCount\(alias\), convFlags\.manualUnread\.includes\(alias\)\)\) \{/.test(readCase)
  && readCase.includes('clearManualUnread(f, alias)') && readCase.includes('markAgentReadLocally(alias);')
  && readCase.includes('if (hubHasAgentUnread()) {') && readCase.includes('ackAgentUnread(alias, {'));
ck('标为未读: sets the local manual mark', /\} else \{\s*updateConversationFlags\(f => markManualUnread\(f, alias\)\);/.test(readCase));
const hideCase = handler.slice(handler.indexOf("case 'hide':"));
ck('不显示该对话 records the latest message time; 恢复显示 restores',
  hideCase.includes('restoreConversation(f, alias)') && hideCase.includes('hideConversation(f, alias, liveUnread.lastAt[alias] ?? 0)'));
ck('hidden rows are partitioned out before grouping', agents.includes('partitionHidden(sessions, convFlags, alias => liveUnread.lastAt[alias] ?? 0, !!q)') && agents.includes('buildSections(applyAgentFilter(visibleSessions, activeFilter), query, {'));
ck('revived rows are pruned from storage when a newer message arrives', agents.includes('updateConversationFlags(f => pruneRevivedHidden(f, liveUnread.lastAt));'));
ck('flags bound to this account on mount', agents.includes('bindConversationFlags(cfg);') && agents.includes('useSyncExternalStore(subscribeConversationFlags, getConversationFlags, getConversationFlags)'));
const footer = agents.slice(agents.indexOf('ListFooterComponent={hiddenSessions.length ? ('), agents.indexOf(') : null}\n      />'));
ck('「已隐藏的对话」 footer: only when something is hidden, toggles, shows the count', footer.includes('testID="agent-hidden-toggle"') && footer.includes('onPress={() => setShowHidden(v => !v)}') && footer.includes('已隐藏的对话') && footer.includes('{hiddenSessions.length}'));
ck('footer renders the hidden rows with the normal row renderers (so long-press → 恢复显示 works there)', footer.includes('hiddenSessions.map(item => (') && footer.includes('compact ? renderCompactRow(item) : renderPhoneRow(item)'));
ck('opening a hidden chat restores it', /const openChat = \(alias: string\) => \{\s*if \(alias in convFlags\.hidden\) updateConversationFlags\(f => restoreConversation\(f, alias\)\);\s*onOpenChat\(alias\);/.test(agents));
ck('row badge shows the manual-unread dot when there is no real unread', agents.includes('rowBadgeWithManual(formatUnreadBadge(rowUnreadCount(alias)), convFlags.manualUnread.includes(alias))'));
ck('AgentUnreadBadge: the dot has no number', badge.includes('{badge.dot ? null : <Text style={styles.unreadBadgeText}>{badge.text}</Text>}') && badge.includes('badge.dot ? styles.unreadDot : null'));

// ── 菜单组件 ─────────────────────────────────────────────────────────────────
ck('menu is a transparent Modal closed by Android back / Esc', /<Modal[\s\S]*?transparent[\s\S]*?onRequestClose=\{onClose\}/.test(menu));
ck('menu covers the whole window on Android (status / nav bar translucent) so pageX/pageY match', menu.includes('statusBarTranslucent') && menu.includes('navigationBarTranslucent'));
ck('tap outside (scrim) closes', /testID="agent-row-menu-scrim"[\s\S]*?onPress=\{onClose\}/.test(menu));
ck('scrim is dim on touch, transparent for desktop right-click', menu.includes("const scrim = touch ? (themeMode() === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)') : 'transparent';"));
ck('light haptic on open, native touch only', /if \(!open \|\| !touch \|\| Platform\.OS === 'web'\) return;\s*void Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\)/.test(menu));
ck('reduced motion: no fade (initial value + live changes)', menu.includes("animationType={reduceMotion ? 'none' : 'fade'}") && menu.includes('AccessibilityInfo.isReduceMotionEnabled') && menu.includes("'reduceMotionChanged'"));
ck('position from anchorRowMenu with the measured layer size and safe-area insets', menu.includes('anchorRowMenu({') && menu.includes('viewportWidth: area?.width ?? win.width') && menu.includes('insets: touch ? { top: insets.top'));
ck('menu size from rowMenuMetrics / rowMenuHeight (the numbers the anchor maths uses)', menu.includes('const m = rowMenuMetrics(touch, uiScale().densityFactor, uiScale().denseFontMultiplier);') && menu.includes('const menuHeight = rowMenuHeight(m, items.length);') && menu.includes('width: m.width,'));
ck('items: fixed height, left-aligned, text vertically centred', menu.includes('height: m.itemHeight,') && menu.includes("justifyContent: 'center',") && menu.includes("alignItems: 'flex-start',") && menu.includes("includeFontPadding: false, textAlignVertical: 'center'"));
ck('choosing an item closes the menu, then runs it', menu.includes('onPress={() => { onClose(); onSelect(item.key, target.alias); }}'));
ck('menu uses the scaled Text wrapper', menu.includes("import { Text } from './ui-text';"));

// ── 其余接线 ─────────────────────────────────────────────────────────────────
ck('ChatScreen: opening a conversation clears its manual unread mark', /dispatchUnread\(\{ kind: 'conversation_opened', agent: alias \}\);[\s\S]{0,120}conversationOpened\(cfg, alias\);/.test(chat));
ck('empty chat pane hint names the menu actions', app.includes('<Text style={styles.twoPaneEmptyHint}>{ROW_MENU_EMPTY_HINT}</Text>') && !app.includes('长按列表里的 agent 查看节点详情'));
ck('flags persist per account: web localStorage via the core store, native file per scope', flags.includes('createConversationFlagsStore({') && flags.includes('conversation_flags_v1_${scope}.json'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
