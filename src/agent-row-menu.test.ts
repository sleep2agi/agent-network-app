// 会话行菜单(长按 / 右键)的纯逻辑 —— run: bun src/agent-row-menu.test.ts
// ck-style:自执行,失败时非零退出(scripts/run-tests.mjs 汇总)。接线另见 agent-row-menu-wiring.test.ts。
import {
  agentRowMenuItems,
  anchorRowMenu,
  clearManualUnread,
  emptyConversationFlags,
  hideConversation,
  isConversationHidden,
  markManualUnread,
  parseConversationFlags,
  partitionHidden,
  pruneRevivedHidden,
  restoreConversation,
  rowBadgeWithManual,
  rowIsUnread,
  rowMenuHeight,
  rowMenuMetrics,
  serializeConversationFlags,
  ROW_MENU_EMPTY_HINT,
  type AgentRowMenuState,
} from './agent-row-menu';
import { initialUnreadState, reduceUnread } from './unread-ledger';
import { createConversationFlagsStore, conversationFlagsWebKey } from './conversation-flags-core';

let p = 0, t = 0;
const ck = (n: string, c: boolean, detail?: unknown) => {
  t++;
  if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

// ── 菜单项:顺序、文案随状态变 ─────────────────────────────────────────────
const base: AgentRowMenuState = { unread: false, pinned: false, muted: false, hidden: false, canPin: true, canMute: true, canOpenWindow: false };
const labels = (s: Partial<AgentRowMenuState>) => agentRowMenuItems({ ...base, ...s }).map(i => i.label);
const keys = (s: Partial<AgentRowMenuState>) => agentRowMenuItems({ ...base, ...s }).map(i => i.key);

ck('phone default: 标为未读 / 置顶 / 消息免打扰 / 节点详情 / 不显示该对话, in that order',
  JSON.stringify(labels({})) === JSON.stringify(['标为未读', '置顶', '消息免打扰', '节点详情', '不显示该对话']), labels({}));
ck('unread → 标为已读', labels({ unread: true })[0] === '标为已读');
ck('read → 标为未读', labels({ unread: false })[0] === '标为未读');
ck('pinned → 取消置顶', labels({ pinned: true })[1] === '取消置顶');
ck('unpinned → 置顶', labels({ pinned: false })[1] === '置顶');
ck('muted → 开启提醒', labels({ muted: true })[2] === '开启提醒');
ck('unmuted → 消息免打扰', labels({ muted: false })[2] === '消息免打扰');
ck('hidden row → 恢复显示 (last)', labels({ hidden: true }).at(-1) === '恢复显示');
ck('visible row → 不显示该对话 (last)', labels({ hidden: false }).at(-1) === '不显示该对话');
ck('all eight state combinations keep the same key order',
  [0, 1, 2, 3, 4, 5, 6, 7].every(b => JSON.stringify(keys({ unread: !!(b & 1), pinned: !!(b & 2), muted: !!(b & 4) })) === JSON.stringify(['read', 'pin', 'mute', 'detail', 'hide'])));
ck('desktop adds 在新窗口打开 between 免打扰 and 节点详情',
  JSON.stringify(keys({ canOpenWindow: true })) === JSON.stringify(['read', 'pin', 'mute', 'openWindow', 'detail', 'hide']));
ck('no pin / mute callbacks → those items are absent (not dead buttons)',
  JSON.stringify(keys({ canPin: false, canMute: false })) === JSON.stringify(['read', 'detail', 'hide']));
ck('never a delete item (deleting a node lives in 节点详情 → 危险操作)',
  [0, 1, 2, 3].every(b => !agentRowMenuItems({ ...base, canOpenWindow: !!(b & 1), hidden: !!(b & 2) }).some(i => /删除/.test(i.label) || (i.key as string) === 'delete')));
ck('keys are unique', new Set(keys({ canOpenWindow: true })).size === 6);

// ── 尺寸 ────────────────────────────────────────────────────────────────────
const touch = rowMenuMetrics(true);
const desk = rowMenuMetrics(false);
ck('touch rows are 44 dp (minimum touch target)', touch.itemHeight === 44);
ck('desktop rows are 34 px', desk.itemHeight === 34);
ck('height = 2·padY + n·itemHeight', rowMenuHeight(touch, 5) === touch.padY * 2 + 5 * 44);
ck('width fits the longest label (6 CJK chars) with both paddings', touch.width >= touch.fontSize * 6 + touch.padX * 2);
const big = rowMenuMetrics(true, 1, 1.5);
ck('a larger font widens the menu instead of clipping', big.width >= big.fontSize * 6 + big.padX * 2 && big.width > touch.width);
ck('density scales the row height', rowMenuMetrics(true, 1.2).itemHeight === Math.round(44 * 1.2));
ck('更紧凑 (0.75) never shrinks a touch row below 44 dp', rowMenuMetrics(true, 0.75).itemHeight === 44 && rowMenuMetrics(true, 0.75).width >= 140);
ck('desktop rows do follow a smaller density', rowMenuMetrics(false, 0.75).itemHeight === Math.round(34 * 0.75));

// ── 定位 / 夹紧 ─────────────────────────────────────────────────────────────
const W = 390, H = 844, mw = touch.width, mh = rowMenuHeight(touch, 5);
const at = (x: number, y: number, extra: object = {}) => anchorRowMenu({ x, y, menuWidth: mw, menuHeight: mh, viewportWidth: W, viewportHeight: H, ...extra });
const inside = (r: { left: number; top: number }, m = 8) => r.left >= m && r.top >= m && r.left + mw <= W - m && r.top + mh <= H - m;
{
  const r = at(100, 200);
  ck('room everywhere → below-right of the finger, corner at the press point + gap', r.vertical === 'below' && r.horizontal === 'right' && r.left === 100 && r.top === 204, r);
}
{
  const r = at(100, 800);
  ck('near the bottom → flips above the finger', r.vertical === 'above' && r.top + mh === 800 - 4, r);
}
{
  const r = at(370, 200);
  ck('near the right edge → opens to the left of the finger', r.horizontal === 'left' && r.left + mw === 370, r);
}
const corners: [string, number, number][] = [['top-left', 0, 0], ['top-right', W, 0], ['bottom-left', 0, H], ['bottom-right', W, H]];
for (const [name, x, y] of corners) ck(`corner ${name}: menu stays inside the viewport (8 dp margin)`, inside(at(x, y)), at(x, y));
{
  const r = at(10, 10, { insets: { top: 40, bottom: 30 } });
  ck('safe-area top inset respected (status bar)', r.top >= 48, r);
  const b = at(10, H, { insets: { top: 40, bottom: 30 } });
  ck('safe-area bottom inset respected (gesture bar)', b.top + mh <= H - 38, b);
}
{
  const r = anchorRowMenu({ x: 50, y: 50, menuWidth: 500, menuHeight: 900, viewportWidth: 300, viewportHeight: 400 });
  ck('menu bigger than the screen → pinned to the top-left margin, never negative', r.left === 8 && r.top === 8, r);
}
{
  // 大屏上随机点:永远在屏幕里
  let ok = true;
  for (let i = 0; i < 500; i++) {
    const x = (i * 97) % 1441, y = (i * 53) % 901;
    const r = anchorRowMenu({ x, y, menuWidth: 150, menuHeight: 216, viewportWidth: 1440, viewportHeight: 900 });
    if (r.left < 8 || r.top < 8 || r.left + 150 > 1432 || r.top + 216 > 892) ok = false;
  }
  ck('500 press points on 1440×900: always fully on screen', ok);
}

// ── 隐藏 / 恢复 ─────────────────────────────────────────────────────────────
let f = emptyConversationFlags();
f = hideConversation(f, 'A', 1000);
ck('hidden right after hiding', isConversationHidden(f, 'A', 1000));
ck('still hidden while no newer message', isConversationHidden(f, 'A', 999) && isConversationHidden(f, 'A', 0));
ck('a newer message brings it back', !isConversationHidden(f, 'A', 1001));
ck('other rows unaffected', !isConversationHidden(f, 'B', 0));
ck('restore removes it', !isConversationHidden(restoreConversation(f, 'A'), 'A', 0));
ck('restore of a row that is not hidden returns the same object (no write)', restoreConversation(f, 'B') === f);
{
  const g = hideConversation(markManualUnread(emptyConversationFlags(), 'A'), 'A', 5);
  ck('hiding a manually-unread row drops the unread mark', !g.manualUnread.includes('A'));
}
{
  const g = hideConversation(hideConversation(emptyConversationFlags(), 'A', 100), 'B', 100);
  const pruned = pruneRevivedHidden(g, { A: 200, B: 100 });
  ck('prune drops only the revived entry', !('A' in pruned.hidden) && pruned.hidden.B === 100);
  ck('prune with nothing revived returns the same object', pruneRevivedHidden(g, { A: 100, B: 50 }) === g);
}
{
  const sessions = [{ alias: 'A' }, { alias: 'B' }, { alias: 'C' }];
  const g = hideConversation(emptyConversationFlags(), 'B', 10);
  const part = partitionHidden(sessions, g, a => (a === 'B' ? 10 : 0), false);
  ck('partition: hidden row goes to the footer list, order kept', part.visible.map(s => s.alias).join() === 'A,C' && part.hidden.map(s => s.alias).join() === 'B');
  const searching = partitionHidden(sessions, g, () => 0, true);
  ck('partition while searching: hidden rows are findable', searching.visible.length === 3 && searching.hidden.length === 0);
}

// ── 持久化格式 ──────────────────────────────────────────────────────────────
{
  const g = markManualUnread(hideConversation(emptyConversationFlags(), '通信龙', 1727000000000), '打包牛');
  const back = parseConversationFlags(serializeConversationFlags(g));
  ck('serialize → parse round-trips', JSON.stringify(back) === JSON.stringify(g), back);
  ck('garbage → empty flags', JSON.stringify(parseConversationFlags('{not json')) === JSON.stringify(emptyConversationFlags()));
  ck('null / array → empty flags', parseConversationFlags(null).manualUnread.length === 0 && Object.keys(parseConversationFlags([]).hidden).length === 0);
  const dirty = parseConversationFlags({ hidden: { A: 5, B: 'x', C: -1, D: NaN, '': 3 }, manualUnread: ['A', 'A', 3, ''] });
  ck('bad entries are dropped, duplicates collapsed', JSON.stringify(dirty) === JSON.stringify({ hidden: { A: 5 }, manualUnread: ['A'] }), dirty);
}

// ── 手动未读 ─────────────────────────────────────────────────────────────────
{
  const g = markManualUnread(emptyConversationFlags(), 'A');
  ck('mark unread adds once', g.manualUnread.join() === 'A' && markManualUnread(g, 'A') === g);
  ck('clear on open', clearManualUnread(g, 'A').manualUnread.length === 0);
  ck('clear of an unmarked row is a no-op (same object)', clearManualUnread(g, 'B') === g);
  const real = { text: '3', a11yLabel: '3 条未读消息' };
  ck('real unread wins over the manual dot', rowBadgeWithManual(real, true) === real);
  const dot = rowBadgeWithManual(null, true) as { dot?: boolean; text: string } | null;
  ck('manual only → a dot with no number', !!dot && dot.dot === true && dot.text === '');
  ck('neither → no badge', rowBadgeWithManual(null, false) === null);
  ck('menu says 标为已读 for real or manual unread', rowIsUnread(2, false) && rowIsUnread(0, true) && !rowIsUnread(0, false));
}

// ── 标为已读:ledger 的 marked_read 只清这一个 agent ───────────────────────
{
  let s = initialUnreadState();
  for (let i = 0; i < 3; i++) s = reduceUnread(s, { kind: 'message_arrived', agent: 'A' });
  s = reduceUnread(s, { kind: 'message_arrived', agent: 'B' });
  const after = reduceUnread(s, { kind: 'marked_read', agent: 'A' });
  ck('marked_read clears A without opening it', !('A' in after.counts) && after.counts.B === 1 && after.open === null);
  ck('marked_read on a clean agent returns the same state', reduceUnread(after, { kind: 'marked_read', agent: 'A' }) === after);
}

// ── store:web(localStorage)与原生(文件)两条持久化路径 ────────────────────
{
  const mem = new Map<string, string>();
  const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  const cfgA = { profileId: 'p-a' }, cfgB = { profileId: 'p-b' };
  const s1 = createConversationFlagsStore({ web: () => ls, native: { read: async () => null, write: async () => {} } });
  let notified = 0;
  s1.subscribe(() => { notified++; });
  s1.bind(cfgA);
  s1.update(g => hideConversation(g, 'A', 42));
  s1.update(g => markManualUnread(g, 'B'));
  ck('web: writes land under a per-account key', mem.has(conversationFlagsWebKey('p-a')) && !mem.has(conversationFlagsWebKey('p-b')));
  ck('web: subscribers are notified', notified >= 3);
  const s2 = createConversationFlagsStore({ web: () => ls, native: { read: async () => null, write: async () => {} } });
  s2.bind(cfgA);
  ck('web: a fresh store (app restart) reads the hidden row back', isConversationHidden(s2.get(), 'A', 42) && s2.get().manualUnread.includes('B'));
  s2.bind(cfgB);
  ck('web: another account starts empty', Object.keys(s2.get().hidden).length === 0);
  s2.bind(cfgA);
  s2.update(g => restoreConversation(g, 'A'));
  const s3 = createConversationFlagsStore({ web: () => ls, native: { read: async () => null, write: async () => {} } });
  s3.bind(cfgA);
  ck('web: restore persists', !('A' in s3.get().hidden));
  s3.opened(cfgA, 'B');
  ck('web: opening the chat clears the manual unread mark (persisted)', !parseConversationFlags(mem.get(conversationFlagsWebKey('p-a'))!).manualUnread.includes('B'));
  // 另一个窗口(独立聊天窗口)在这个 store 背后写了盘:下一次 update 不能拿旧内存覆盖掉它。
  mem.set(conversationFlagsWebKey('p-a'), serializeConversationFlags(hideConversation(emptyConversationFlags(), 'X', 1)));
  s3.update(g => markManualUnread(g, 'Y'));
  const merged = parseConversationFlags(mem.get(conversationFlagsWebKey('p-a'))!);
  ck('web: update re-reads storage first (another window\'s write survives)', 'X' in merged.hidden && merged.manualUnread.includes('Y'), merged);
}
await (async () => {
  const files = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  files.set('p-n', serializeConversationFlags(hideConversation(emptyConversationFlags(), 'OLD', 7)));
  const native = {
    read: async (scope: string) => { await gate; return files.get(scope) ?? null; },
    write: async (scope: string, body: string) => { files.set(scope, body); },
  };
  const s = createConversationFlagsStore({ web: () => null, native });
  s.bind({ profileId: 'p-n' });
  // 读盘还没回来就改:必须排到读完之后,不能用空状态把 OLD 冲掉。
  s.update(g => markManualUnread(g, 'NEW'));
  release();
  await s.settled();
  const disk = parseConversationFlags(files.get('p-n')!);
  ck('native: an update during the initial read waits for it (old hidden row kept)', 'OLD' in disk.hidden && disk.manualUnread.includes('NEW'), disk);
  const s2 = createConversationFlagsStore({ web: () => null, native: { read: async (k: string) => files.get(k) ?? null, write: native.write } });
  s2.bind({ profileId: 'p-n' });
  await s2.settled();
  ck('native: a fresh store reads the file back', 'OLD' in s2.get().hidden && s2.get().manualUnread.includes('NEW'));
})();

ck('empty-pane hint names the new long-press actions', ROW_MENU_EMPTY_HINT.includes('长按') && ROW_MENU_EMPTY_HINT.includes('置顶') && ROW_MENU_EMPTY_HINT.includes('免打扰') && ROW_MENU_EMPTY_HINT.includes('节点详情'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
