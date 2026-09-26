// Wiring for the 0.2.106 compact agent list + draggable two-pane divider — run: bun src/agent-list-wiring.test.ts
// The screens import react-native, so (like wide-layout-wiring.test.ts) this checks source text
// (CRLF-normalised for the Windows runner). The behaviour itself is pinned by the pure tests:
// agent-row-model / pane-divider / agents-list-collapse / wide-layout.
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const app = read('../App.tsx');
const agents = read('./AgentsScreen.tsx');
const divider = read('./TwoPaneDivider.tsx');
const prefs = read('./agent-list-prefs.ts');
const badge = read('./AgentUnreadBadge.tsx');

// ── App: two-pane width = dragged preference, persisted, divider mounted ──
const twoStart = app.indexOf('<View style={styles.twoPane} testID="android-two-pane">');
const twoEndRel = app.slice(twoStart).search(/\n *\) : screen\.name === 'chat' \? \(/);
const two = twoEndRel < 0 ? '' : app.slice(twoStart, twoStart + twoEndRel);
ck('two-pane block located', twoStart > 0 && two.includes('<AgentsScreen'));
ck('list width = twoPaneListWidth(area, saved preference)', app.includes('const paneListWidth = twoPaneListWidth(paneAreaWidth, listPaneWidth);'));
ck('preference starts at the fixed default', app.includes('useState(LIST_PANE_DEFAULT_WIDTH)'));
ck('saved width is loaded on mount', /loadListPaneWidth\(\)\.then\(w => \{ if \(live && w !== null\) setListPaneWidth\(w\); \}\)/.test(app));
ck('a committed drag updates state and persists', app.includes('const onListPaneWidth = (w: number) => { setListPaneWidth(w); void saveListPaneWidth(w); };'));
ck('divider mounted inside the two-pane with the same width / area', two.includes('<TwoPaneDivider width={paneListWidth} areaWidth={paneAreaWidth} onWidth={onListPaneWidth} />'));
ck('divider is the last child (stacks above both panes)', two.lastIndexOf('<TwoPaneDivider') > two.lastIndexOf('testID="two-pane-detail"'));
ck('divider only in the two-pane (not phone / desktop)', (app.match(/<TwoPaneDivider/g) ?? []).length === 1);

// ── divider component ──
ck('PanResponder created once (empty deps) from the tested handlers', /useMemo\(\(\) => PanResponder\.create\(dividerDragHandlers\(\{[\s\S]*?\}\)\), \[\]\)/.test(divider));
ck('values reach the handlers through refs, not closures', divider.includes('getWidth: () => widthRef.current') && divider.includes('getArea: () => areaRef.current') && divider.includes('commit: w => onWidthRef.current(w)'));
ck('strip is DIVIDER_HIT_WIDTH wide, absolutely positioned at dividerHitLeft', /width: DIVIDER_HIT_WIDTH/.test(divider) && divider.includes('{ left: dividerHitLeft(shown) }') && /position: 'absolute'/.test(divider));
ck('grip rendered, accent while dragging', divider.includes('testID="two-pane-divider-grip"') && /dragging \? \{[^}]*backgroundColor: colors\.accent/.test(divider));
ck('web: col-resize cursor + touchAction none', divider.includes("cursor: 'col-resize'") && divider.includes("touchAction: 'none'"));
ck('adjustable for TalkBack (increment / decrement)', divider.includes('accessibilityRole="adjustable"') && divider.includes('dividerStep(width, areaWidth, a)'));
ck('divider module-level styles hold no theme colours (would freeze on theme switch)', divider.includes('const s = {') && !/colors\./.test(divider.slice(divider.indexOf('const s = {'))));

// ── prefs: per device, web localStorage / native file ──
ck('prefs keys', prefs.includes("'agent_list_pane_width_v1'") && prefs.includes("'agent_list_collapsed_v1'"));
ck('prefs: localStorage on web, documentDirectory file on native', prefs.includes('localStorage') && prefs.includes('agent_list_prefs_v1.json') && prefs.includes('documentDirectory'));
ck('prefs parse through the tested parsers', prefs.includes('parseStoredListWidth(await readKey(LIST_WIDTH_KEY))') && prefs.includes('parseCollapsed(await readKey(COLLAPSED_KEY))'));

// ── AgentsScreen: phone / two-pane rows ──
const phoneRow = agents.slice(agents.indexOf('const renderPhoneRow = (item: Session) => {'), agents.indexOf('  return (\n    <View style={{ flex: 1'));
ck('phone row block located', phoneRow.length > 200);
ck('row content comes from agentRowModel, with the task time for the text it shows', phoneRow.includes('agentRowModel(item, { latest: latestByAgent[item.alias], taskAt: taskTimes.timeFor(item.alias, item.task), pinned, nowMs })'));
// ── last-activity time (0.2.114): task times come from the latest task row, never updated_at ──
ck('task-time resolver reads the latest task row for that alias only', agents.includes('fetchTasks(cfg, { to_name: alias, limit: 1, skipStats: true })'));
ck('lookups only for rows whose preview IS the task text (no message text)', agents.includes('.filter(s => s.task && !latestByAgent[s.alias]?.text)'));
ck('a resolved task time re-renders the list', agents.includes('taskTimes.subscribe(() => setTaskTimesTick(n => n + 1))'));
ck('the screen never derives a row time from updated_at', !/updated_at/.test(agents));
ck('sort-by-activity is wired through the flag (one-line switch), not hard-coded', agents.includes('sortByActivity: SORT_BY_ACTIVITY,') && agents.includes('activityAt: alias => activityByAlias.get(alias) ?? 0,'));
ck('sort-by-activity flag is ON (owner 2026-09-26)', /export const SORT_BY_ACTIVITY = true;/.test(read('./agents-list.ts')));
ck('no 「在线」 status word in the phone row', !phoneRow.includes('agentStatusLabel') && !phoneRow.includes("'在线'"));
ck('44 dp avatar + dot coloured by the model', phoneRow.includes('size={AGENT_ROW_AVATAR}') && phoneRow.includes('colors[model.status.dot]'));
ck('label only when the model gives one, in its tone', phoneRow.includes('model.status.label && model.status.labelTone ?') && phoneRow.includes('colors[model.status.labelTone]'));
ck('time + inline unread badge on the right', phoneRow.includes('{model.time}') && phoneRow.includes('const badge = rowBadge(item.alias);') && phoneRow.includes('<AgentUnreadBadge inline badge={badge}'));
ck('pinned indicator kept', phoneRow.includes('pinned ? <Ionicons name="pin"'));
ck('selected row highlighted with rowActive', phoneRow.includes('selected ? colors.rowActive'));
ck('tap opens chat, long-press opens node detail', phoneRow.includes('onPress={() => onOpenChat(item.alias)}') && phoneRow.includes('onLongPress={() => onOpenNodeDetail(item.alias)}'));
ck('rows are flat: no card style / border in the phone row', !phoneRow.includes('styles.card') && !/borderWidth/.test(phoneRow));
ck('hairline separators between phone rows only', /ItemSeparatorComponent=\{compact \? undefined : \(\) => \(/.test(agents) && /separator: \{ height: StyleSheet\.hairlineWidth, marginLeft: ds\(AGENT_ROW_PAD_X\) \+ ds\(AGENT_ROW_AVATAR\) \+ ds\(AGENT_ROW_GAP\) \}/.test(agents));
ck('rows are full-bleed on the phone (no list side padding)', agents.includes('contentContainerStyle={compact ? { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm } : { paddingBottom: spacing.sm }}'));
ck('renderItem picks the desktop or phone row', agents.includes('renderItem={({ item }) => (compact ? renderCompactRow(item) : renderPhoneRow(item))}'));
ck('rowStyles hold no theme colours', agents.includes('const makeRowStyles = () => ({') && !/colors\./.test(agents.slice(agents.indexOf('const makeRowStyles = () => ({'))));
ck('preview line uses the same snapshot as the counts', agents.includes('latestMessageByAgent(preview') && agents.includes(': unreadSnap), [preview, unreadSnap]);'));

// ── group headers ──
ck('list renders the folded view of the sections', agents.includes('sections={shownSections}') && agents.includes('applyCollapsed(sections, collapsed, query)'));
ck('header tap toggles and persists', agents.includes('onPress={() => toggleGroup(section.title)}') && /toggleCollapsed\(prev, title\);\s*void saveCollapsedGroups\(next\);/.test(agents));
ck('folded state loaded on mount', agents.includes('loadCollapsedGroups().then('));
ck('non-collapsible header is disabled and has no chevron', agents.includes('disabled={!section.collapsible}') && agents.includes('{section.collapsible ? (\n            <Ionicons'));
ck('header shows online/total', agents.includes('{section.online}/{section.total}'));

// ── search / + / sorting kept ──
ck('search input still bound to query', (agents.match(/value=\{query\}/g) ?? []).length === 2 && (agents.match(/onChangeText=\{setQuery\}/g) ?? []).length === 2);
ck('+ still opens the picker in both headers', (agents.match(/onPress=\{onOpenPicker\}/g) ?? []).length === 2);
ck('sorting / pins / 新消息 still from buildSections', agents.includes('buildSections(applyAgentFilter(sessions, activeFilter), query, {') && agents.includes('pinned: alias => pinnedAliases.includes(alias),'));

// ── desktop (Tauri) sidebar row unchanged ──
const deskRow = agents.slice(agents.indexOf('const renderCompactRow = (item: Session) => {'), agents.indexOf('const renderPhoneRow'));
ck('desktop row keeps 34 dp avatar, flat transparent rows, hover + context menu hooks', deskRow.includes('<AliasAvatar alias={item.alias} size={34} />') && deskRow.includes("backgroundColor: 'transparent'") && deskRow.includes('dataSet: { agentAlias: item.alias }') && deskRow.includes('onHoverIn={compact ?'));
ck('desktop row keeps its header (search placeholder)', agents.includes('placeholder="搜索 agent…"'));

// ── inline badge ──
ck('AgentUnreadBadge inline variant only changes placement', badge.includes('inline ? [styles.unreadBadge, styles.unreadBadgeInline] : styles.unreadBadge'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
