import { applyUnreadDelta, applyUnreadList, byMe, countUnread, emptyUnread, markUnreadSeen, planUnreadRead, seenMark, unreadBadgeCount, unreadKey, UNREAD_FULL_POLL_MS, UNREAD_POLL_MS, type UnreadRow } from './task-unread';
import { railBadgeText } from './rail-nav';
import { badgeOffset, coveredShare, MIN_ICON_VISIBLE } from './badge-anchor';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const ME = 'u_me';
const SEEN = '2026-09-30T08:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(SEEN) + ms).toISOString();
const user = (id: string) => ({ kind: 'user' as const, id });
const node = (id: string) => ({ kind: 'node' as const, id });
const row = (id: string, ms: number, by: UnreadRow['updatedBy'], extra: Partial<UnreadRow> = {}): UnreadRow => ({ id, updatedAt: at(ms), updatedBy: by, ...extra });

// ── 自己的改动不算 ──
ck('someone else\'s edit after lastSeen counts', countUnread([row('a', 1000, user('u_other'))], SEEN, ME) === 1);
ck('my own edit after lastSeen does not count', countUnread([row('a', 1000, user(ME))], SEEN, ME) === 0);
ck('a node\'s edit counts (agents are someone else, even my own)', countUnread([row('a', 1000, node(ME))], SEEN, ME) === 1);
ck('unknown actor (no updatedBy) does not count — it may be me', countUnread([row('a', 1000, null)], SEEN, ME) === 0);
ck('unknown me (meId not read yet) counts nothing', countUnread([row('a', 1000, user('u_other'))], SEEN, null) === 0);
ck('byMe: user with my id', byMe(user(ME), ME) === true);
ck('byMe: node with my id is not me', byMe(node(ME), ME) === false);

// ── lastSeen 边界 ──
ck('edit exactly at lastSeen does not count (already on the board when I left)', countUnread([row('a', 0, user('u_other'))], SEEN, ME) === 0);
ck('edit 1 ms after lastSeen counts', countUnread([row('a', 1, user('u_other'))], SEEN, ME) === 1);
ck('edit before lastSeen does not count', countUnread([row('a', -60_000, user('u_other'))], SEEN, ME) === 0);
ck('no lastSeen (never opened 任务) = 0', countUnread([row('a', 1000, user('u_other'))], null, ME) === 0);
ck('legacy "YYYY-MM-DD HH:MM:SS" (UTC) is compared as UTC', countUnread([{ id: 'a', updatedAt: '2026-09-30 08:00:01', updatedBy: user('u_other') }], SEEN, ME) === 1);
ck('legacy timestamp equal to lastSeen does not count', countUnread([{ id: 'a', updatedAt: '2026-09-30 08:00:00', updatedBy: user('u_other') }], SEEN, ME) === 0);
ck('garbage updatedAt does not count', countUnread([{ id: 'a', updatedAt: 'nope', updatedBy: user('u_other') }], SEEN, ME) === 0);

// ── 计的是卡片张数 ──
ck('same card twice counts once', countUnread([row('a', 1000, user('u_x')), row('a', 2000, user('u_y'))], SEEN, ME) === 1);
ck('archived card does not count', countUnread([row('a', 1000, user('u_x'), { archived: true })], SEEN, ME) === 0);
ck('three cards by others, one mine → 3', countUnread([row('a', 1, user('u_x')), row('b', 2, node('n1')), row('c', 3, user('u_y')), row('d', 4, user(ME))], SEEN, ME) === 3);

// ── seenMark:Hub 时钟,不往回走 ──
ck('seenMark takes the newest board updatedAt', seenMark([row('a', 5000, null), row('b', 1000, null)], null, SEEN) === at(5000));
ck('seenMark takes server_time when newer', seenMark([row('a', 5000, null)], at(9000), SEEN) === at(9000));
ck('seenMark never moves backwards', seenMark([row('a', -5000, null)], null, SEEN) === SEEN);
ck('seenMark with nothing to go on keeps prev', seenMark([], null, null) === null);
ck('seenMark with nothing to go on keeps a set prev', seenMark([], null, SEEN) === SEEN);
ck('seenMark with a board and no prev seeds it', seenMark([row('a', 0, null)], null, null) === SEEN);

// ── 读的计划 ──
const s0 = emptyUnread('k', SEEN);
ck('on the 任务 page: never read (the board polls)', planUnreadRead(['changes'], s0, true, 1e12).kind === 'none');
ck('never opened 任务: never read', planUnreadRead(['changes'], emptyUnread('k', null), false, 1e12).kind === 'none');
const pc = planUnreadRead(['list_summary', 'changes'], s0, false, 1e12);
ck('changes hub: first read is changes since lastSeen', pc.kind === 'changes' && pc.since === SEEN);
ck('changes hub: next read waits UNREAD_POLL_MS', planUnreadRead(['changes'], { ...s0, readAt: 1e12 }, false, 1e12 + UNREAD_POLL_MS - 1).kind === 'none');
ck('changes hub: after UNREAD_POLL_MS reads again', planUnreadRead(['changes'], { ...s0, readAt: 1e12 }, false, 1e12 + UNREAD_POLL_MS).kind === 'changes');
const withCursor = planUnreadRead(['changes'], { ...s0, cursor: at(7000) }, false, 1e12);
ck('changes hub: reads from the cursor once it has one', withCursor.kind === 'changes' && withCursor.since === at(7000));
ck('old hub (.74, no changes): full read', planUnreadRead(['tags'], s0, false, 1e12).kind === 'full');
ck('old hub: full reads are UNREAD_FULL_POLL_MS apart', planUnreadRead([], { ...s0, readAt: 1e12 }, false, 1e12 + UNREAD_FULL_POLL_MS - 1).kind === 'none');

// ── 增量 ──
let s = applyUnreadDelta(s0, { rows: [row('a', 1000, user('u_x')), row('b', 2000, node('n1'))], deleted: [], serverTime: at(3000), hasMore: false }, 1);
ck('delta: two cards by others → 2', unreadBadgeCount(s, ME, false) === 2);
ck('delta: cursor moves to server_time', s.cursor === at(3000));
s = applyUnreadDelta(s, { rows: [row('a', 4000, user(ME))], deleted: [], serverTime: at(5000), hasMore: false }, 2);
ck('delta: my later edit of the same card clears it (latest change is mine)', unreadBadgeCount(s, ME, false) === 1);
s = applyUnreadDelta(s, { rows: [], deleted: ['b'], serverTime: at(6000), hasMore: false }, 3);
ck('delta: deleted card is gone', unreadBadgeCount(s, ME, false) === 0);
const full = applyUnreadDelta(s0, { rows: [row('a', 1000, user('u_x'))], deleted: [], serverTime: at(3000), hasMore: true }, 1);
ck('delta: has_more → badge full (99+)', railBadgeText(unreadBadgeCount(full, ME, false)) === '99+');
ck('delta: has_more → cursor stays put (re-read the same window)', full.cursor === null);
ck('on the 任务 page the badge is 0 whatever is held', unreadBadgeCount(full, ME, true) === 0);

// ── 旧 Hub 整读 ──
const listed = applyUnreadList(s0, [row('a', 1000, user('u_x')), row('b', -1000, user('u_x')), row('c', 0, user('u_y'))], 1);
ck('full list: only cards changed after lastSeen are kept', Object.keys(listed.rows).join() === 'a');
ck('full list: count 1', unreadBadgeCount(listed, ME, false) === 1);

// ── 打开任务页 = 看过了 ──
const seen = markUnreadSeen(s, at(9000));
ck('markUnreadSeen moves lastSeen and drops held rows + cursor', seen.lastSeen === at(9000) && Object.keys(seen.rows).length === 0 && seen.cursor === null);
ck('markUnreadSeen with null keeps state', markUnreadSeen(s, null) === s);
ck('markUnreadSeen with same lastSeen keeps state', markUnreadSeen(s, s.lastSeen) === s);

// ── 换账号 ──
ck('unreadKey separates accounts', unreadKey('p1', 'net') !== unreadKey('p2', 'net'));
ck('unreadKey separates networks of one account', unreadKey('p1', 'net-a') !== unreadKey('p1', 'net-b'));
const edits = [row('a', 1000, user('u_alice')), row('b', 2000, user('u_bob'))];
ck('account alice: bob\'s edit counts, hers does not', countUnread(edits, SEEN, 'u_alice') === 1);
ck('switch to account bob: alice\'s edit counts, his does not', countUnread(edits, SEEN, 'u_bob') === 1);
ck('switch to a third account: both count', countUnread(edits, SEEN, 'u_carol') === 2);
ck('a fresh account state holds nothing from the last one', unreadBadgeCount(emptyUnread(unreadKey('p2', 'net'), SEEN), 'u_bob', false) === 0);

// ── 手机底栏角标几何(app-styles tabBadge:26 图标、18 高):不盖住图标 ──
const glyph = { x: 0, y: 0, w: 26, h: 26 };
const off = badgeOffset(0, 0, 26, 18);
for (const w of [18, 22, 28]) {
  const share = coveredShare(glyph, { x: off.left, y: off.top, w, h: 18 });
  ck(`phone tab badge ${w}px wide covers ≤ ${Math.round((1 - MIN_ICON_VISIBLE) * 100)}% of the icon (${Math.round(share * 100)}%)`, share <= 1 - MIN_ICON_VISIBLE);
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
