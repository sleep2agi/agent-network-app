// ck-style (self-executing; run by scripts/run-tests.mjs). 聊天信息 panel: which rows show,
// how each is wired, the single-⋯ header, and the desktop Ctrl/⌘+F.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAT_FIND_SHORTCUT,
  chatInfoDrawerWidth,
  chatInfoGroups,
  chatInfoPresentation,
  isChatFindKey,
  type ChatInfoInput,
} from './chat-info-model';
import { nodeInfoSectionKey, requestNodeSection, takeNodeSectionRequest } from './node-section-request';

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; console.log(`PASS: ${msg}`); };

const base: ChatInfoInput = { alias: '示例-A', canOpenNode: true, hasRulesTarget: true, skillsCapable: true };
const keys = (i: ChatInfoInput) => chatInfoGroups(i).map(g => g.map(r => r.key));
const flat = (i: ChatInfoInput) => chatInfoGroups(i).flat();

// ── rows ─────────────────────────────────────────────────────────────────────────────────
{
  const phone = keys({ ...base, pin: { value: false }, mute: { value: true } });
  check(JSON.stringify(phone) === JSON.stringify([
    ['node'],
    ['search'],
    ['pin', 'mute'],
    ['section:model', 'section:rules', 'section:skills', 'section:files', 'section:tasks', 'section:schedules'],
  ]), `phone: node / search / toggles / node sections, in that order (${JSON.stringify(phone)})`);
  const rows = flat({ ...base, pin: { value: false }, mute: { value: true } });
  check(rows.find(r => r.key === 'pin')?.label === '置顶聊天' && rows.find(r => r.key === 'pin')?.value === false, '置顶聊天 carries the current pin state');
  check(rows.find(r => r.key === 'mute')?.label === '消息免打扰' && rows.find(r => r.key === 'mute')?.value === true, '消息免打扰 carries the current mute state');
  check(rows.find(r => r.key === 'search')?.label === '查找聊天内容' && rows.find(r => r.key === 'search')?.kind === 'link', '查找聊天内容 is a › row');
  check(rows.find(r => r.key === 'node')?.kind === 'profile' && rows.find(r => r.key === 'node')?.section === 'overview', 'avatar + name row opens the node page on 概览');
  check(rows.filter(r => r.key.startsWith('section:')).every(r => r.kind === 'link' && !!r.section), 'every node section row is a › row with its section');
  check(!rows.some(r => r.section === 'danger'), '危险操作 never shows (the read-only node page has none either)');
}
{
  const desktop = keys({ ...base, pin: { value: true }, mute: { value: false }, windowPin: { value: false } });
  check(JSON.stringify(desktop[2]) === JSON.stringify(['pin', 'mute', 'windowPin']), 'desktop: 窗口置顶 joins the toggles (was the floating top-right 📌)');
  check(flat({ ...base, windowPin: { value: true } }).find(r => r.key === 'windowPin')?.value === true, '窗口置顶 carries the window state');
}
{
  const detached = keys({ ...base, windowPin: { value: false } });
  check(!detached.flat().includes('pin') && !detached.flat().includes('mute'), 'no pin / mute callbacks (detached window) → no such rows, nothing dead');
  const bare = keys({ ...base, canOpenNode: false });
  check(JSON.stringify(bare) === JSON.stringify([['search']]), 'no node settings entry → only 查找聊天内容');
  const noCaps = flat({ ...base, hasRulesTarget: false, skillsCapable: false }).map(r => r.key);
  check(!noCaps.includes('section:rules') && !noCaps.includes('section:skills') && noCaps.includes('section:files'), '规则文件 / 技能 follow the node page visibility (visibleNodeSections)');
  check(flat({ ...base, btw: true }).some(r => r.key === 'btw') && !flat(base).some(r => r.key === 'btw'), 'BTW row only when its flag is on');
}

// ── presentation ─────────────────────────────────────────────────────────────────────────
check(chatInfoPresentation({ desktop: true, hideBack: false }) === 'drawer', 'desktop → right drawer');
check(chatInfoPresentation({ desktop: false, hideBack: true }) === 'drawer', 'Android two-pane → right drawer');
check(chatInfoPresentation({ desktop: false, hideBack: false }) === 'page', 'phone stack → pushed page');
check(chatInfoDrawerWidth(1200) === 360 && chatInfoDrawerWidth(340) === 292 && chatInfoDrawerWidth(0) === 360, 'drawer 360 wide, leaves a 48 backdrop on narrow panes');

// ── Ctrl/⌘+F ─────────────────────────────────────────────────────────────────────────────
check(isChatFindKey({ code: 'KeyF', key: 'f', ctrlKey: true }, false), 'Ctrl+F (Windows / Linux)');
check(isChatFindKey({ code: 'KeyF', key: 'f', metaKey: true }, true), '⌘F (mac)');
check(!isChatFindKey({ code: 'KeyF', key: 'f', ctrlKey: true }, true), 'mac: ⌃F is not ⌘F');
check(!isChatFindKey({ code: 'KeyF', key: 'f', metaKey: true }, false), 'Windows: Win+F is not Ctrl+F');
check(!isChatFindKey({ code: 'KeyF', key: 'F', ctrlKey: true, shiftKey: true }, false), 'Ctrl+Shift+F is left alone');
check(!isChatFindKey({ code: 'KeyF', key: 'ƒ', metaKey: true, altKey: true }, true), '⌘⌥F is left alone');
check(!isChatFindKey({ code: 'KeyF', key: 'f', ctrlKey: true, isComposing: true }, false), 'IME composition is left alone');
check(isChatFindKey({ code: 'KeyF', key: 'а', ctrlKey: true }, false), 'physical key decides (non-Latin layout)');
check(isChatFindKey({ key: 'F', ctrlKey: true }, false) && !isChatFindKey({ key: 'g', ctrlKey: true }, false), 'no `code` (old WebView) → falls back to key');
check(CHAT_FIND_SHORTCUT.combos.join() === 'Mod+F' && CHAT_FIND_SHORTCUT.group === 'chat' && CHAT_FIND_SHORTCUT.label === '查找聊天内容', 'registered in 设置 → 快捷键 (FIXED_SHORTCUTS chatFind, group 会话)');

// ── node section request ─────────────────────────────────────────────────────────────────
{
  const key = nodeInfoSectionKey('p1', '示例-A');
  check(key === 'nodeSection:info:p1:示例-A', 'request key uses NodeDetailScreen\'s read-only handoff key');
  requestNodeSection(key, 'rules');
  check(takeNodeSectionRequest(key) === 'rules' && takeNodeSectionRequest(key) === undefined, 'a section request is taken once');
}

// ── wiring (source; POSIX paths, LF) ─────────────────────────────────────────────────────
const srcDir = fileURLToPath(new URL('.', import.meta.url));
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8').replace(/\r\n?/g, '\n');
const chat = read('ChatScreen.tsx');
const app = read('../App.tsx');
const panel = read('ChatInfoPanel.tsx');

// Header: exactly one right-side action.
{
  const at = chat.indexOf('testID="chat-header"');
  check(at > 0, 'chat header located');
  const open = chat.lastIndexOf('<View', at);
  // Walk to the matching </View> of the header row.
  let depth = 0; let end = -1;
  const re = /<View\b|<\/View>/g; re.lastIndex = open;
  for (let m = re.exec(chat); m; m = re.exec(chat)) {
    if (m[0] === '<View') depth++; else if (--depth === 0) { end = m.index; break; }
  }
  const header = chat.slice(open, end);
  const pressables = header.match(/<Pressable\b/g)?.length ?? 0;
  check(pressables === 2, `header has back + ⋯ only (${pressables} Pressables; back is phone-only)`);
  check(/accessibilityLabel="聊天信息"[\s\S]*?onPress=\{\(\) => setInfoOpen\(true\)\}[\s\S]*?testID="chat-header-more"/.test(header), '⋯ opens 聊天信息');
  check(/name="ellipsis-horizontal"/.test(header), '⋯ uses ellipsis-horizontal');
  for (const gone of ['搜索聊天记录', 'chat-mute-toggle', '置顶会话', '查看节点信息', 'settings-outline', 'notifications-outline', 'pin-outline']) {
    check(!header.includes(gone), `old header control gone: ${gone}`);
  }
}
// Rows → actions.
check(chat.includes("case 'pin': onTogglePin?.(); return;"), 'pin row → onTogglePin (same state as the list long-press 置顶)');
check(chat.includes("case 'mute': onToggleMute?.(); return;"), 'mute row → onToggleMute (the former 🔔)');
check(chat.includes("case 'windowPin': windowPin.toggle(); return;"), '窗口置顶 row → the shared DesktopWindowPin state');
check(chat.includes("case 'search': setInfoOpen(false); openSearch(); return;"), '查找聊天内容 closes the panel and opens the in-chat search');
check(chat.includes('windowPin: desktop && windowPin.available ? { value: windowPin.pinned } : null,'), '窗口置顶 only on the Tauri desktop layout');
check(/const mac = isMacKeyboard\(\);/.test(chat) && /if \(e\.defaultPrevented \|\| !isChatFindKey\(e, mac\)\) return;\s*e\.preventDefault\(\);\s*setInfoOpen\(false\);\s*openSearchRef\.current\(\);/.test(chat), 'Ctrl/⌘+F opens the search directly');
// App: desktop chat gets the list's pin / mute state; the floating 📌 steps aside on chats.
check(/<ChatScreen[\s\S]*?pinned=\{pinnedAliases\.includes\(screen\.alias\)\}\s*onTogglePin=\{\(\) => togglePin\(screen\.alias\)\}\s*muted=\{mutedAliases\.includes\(screen\.alias\)\}\s*onToggleMute=\{\(\) => toggleMute\(screen\.alias\)\}\s*desktop/.test(app), 'desktop ChatScreen is wired to the list menu\'s pin + mute');
// Main window: the pin is a rail slot (#447), never over the chat header. Detached chat window: the
// floating pin steps aside while a chat is shown (its toggle is 聊天信息 → 窗口置顶).
check((app.match(/<DesktopWindowPin hidden=\{screen\.name === 'chat'\} \/>/g) ?? []).length === 1 && (app.match(/<DesktopWindowPin placement="rail" \/>/g) ?? []).length === 1 && !/<DesktopWindowPin \/>/.test(app), 'window pin: rail in the main window, floating (hidden on chat) in the detached window');
// Panel: grouped list, ≥ 48 rows, tokens, safe area.
check(/const ROW_MIN = Math\.max\(48, ds\(48\)\);/.test(panel) && /row: \{\s*minHeight: ROW_MIN,/.test(panel), 'rows ≥ 48 dp');
check(!/['"]#[0-9a-fA-F]{3,8}['"]/.test(panel), 'panel colours come from theme tokens only');
check(/const styles = useMemo\(makeStyles, \[\]\);/.test(panel), 'panel styles rebuilt on theme remount (not frozen at import)');
check(/<View style=\{\[styles\.page, safe\]\}/.test(panel) && /const safe = useModalSafePadding\('fullScreen'\);/.test(panel), 'phone page applies the modal safe padding');
check(/from '\.\/ui-text'/.test(panel) && !/Text[^]*from 'react-native'/.test(panel.split('\n').find(l => l.includes("from 'react-native'")) ?? ''), 'panel text goes through the ui-text wrapper');
check(/history\.pushState\([\s\S]*?anetChatInfo: true/.test(panel) && /addEventListener\('popstate', onPop\)/.test(panel), 'phone page (web): history back closes it');

console.log(`chat info: ${ck}/${ck} checks passed`);
