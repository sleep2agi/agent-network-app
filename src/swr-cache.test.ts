// @ts-nocheck -- repository test scripts run directly under Bun.
// Disk stale-while-revalidate for the 任务 board and recent chat history.
import { readFileSync } from 'node:fs';
import { boardSnapshotFor, persistableMessages, historyFile, historyWith, historyFor, HISTORY_CONVERSATIONS, HISTORY_MESSAGES } from './swr-cache-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ── board snapshot ──
const snap = { v: 1, networkId: 'net-a', items: [{ id: 'r1', name: '卡片' }], projects: [{ id: 'p1' }], twoRoles: true, capabilities: ['projects', 7] };
ck('board: same network → snapshot', boardSnapshotFor(snap, 'net-a')?.items.length === 1);
ck('board: another network never paints', boardSnapshotFor(snap, 'net-b') === null);
ck('board: no network id → no snapshot', boardSnapshotFor(snap, undefined) === null);
ck('board: wrong version / corrupt → no snapshot', boardSnapshotFor({ ...snap, v: 2 }, 'net-a') === null && boardSnapshotFor('x', 'net-a') === null && boardSnapshotFor({ v: 1, networkId: 'net-a' }, 'net-a') === null);
ck('board: junk capabilities are dropped', JSON.stringify(boardSnapshotFor(snap, 'net-a')?.capabilities) === '["projects"]');

// ── chat history ──
const hub = (i: number) => ({ task_id: `t${i}`, content: `m${i}`, created_at: `2026-09-30 00:00:${String(i).padStart(2, '0')}` });
const rows = [
  { _localId: 'l1', content: 'echo', _pending: true },
  { _localId: 'l2', content: 'failed', _failed: true },
  { task_id: 't-img', _img: { uri: 'file:///x' } },
  { message_id: 'um1', content: 'proactive' },
  hub(1),
  { content: 'no identity' },
];
const kept = persistableMessages(rows);
ck('history keeps only hub rows (task / message ids), never echoes, failed sends or image previews', kept.length === 2 && kept[0].message_id === 'um1' && kept[1].task_id === 't1');
ck(`history keeps at most ${HISTORY_MESSAGES} newest per conversation`, persistableMessages(Array.from({ length: 50 }, (_, i) => hub(i))).length === HISTORY_MESSAGES && persistableMessages(Array.from({ length: 50 }, (_, i) => hub(i)))[0].task_id === 't0');

let file = historyFile(undefined);
ck('empty / corrupt file → empty history', file.conversations.length === 0 && historyFile({ v: 9 }).conversations.length === 0);
file = historyWith(file, 'k1', [hub(1)]);
file = historyWith(file, 'k2', [hub(2)]);
ck('recall by conversation key', historyFor(file, 'k1')?.[0].task_id === 't1' && historyFor(file, 'k3') === null);
file = historyWith(file, 'k1', [hub(3), hub(1)]);
ck('rewriting a conversation moves it to the front and replaces its rows', file.conversations[0].key === 'k1' && historyFor(file, 'k1').length === 2);
file = historyWith(file, 'k2', [{ _localId: 'only-local' }]);
ck('a conversation with no hub rows left is dropped', historyFor(file, 'k2') === null);
let big = historyFile(undefined);
for (let i = 0; i < HISTORY_CONVERSATIONS + 5; i++) big = historyWith(big, `k${i}`, [hub(i % 60)]);
ck(`at most ${HISTORY_CONVERSATIONS} conversations, oldest written dropped first`, big.conversations.length === HISTORY_CONVERSATIONS && !historyFor(big, 'k0') && !!historyFor(big, `k${HISTORY_CONVERSATIONS + 4}`));

// ── wiring ──
const board = readFileSync(new URL('./RequirementBoard.tsx', import.meta.url), 'utf8');
ck('board paints the disk snapshot only while nothing has been read this launch',
  /if \(!taskBoardState\(\)\.loaded && !taskBoardState\(\)\.items\.length\) \{\s*void recallBoard\(cfg\.profileId, cfg\.networkId\)/.test(board)
  && /if \(dead \|\| !snap \|\| st\.scope !== scope \|\| st\.loaded \|\| st\.items\.length\) return;/.test(board));
ck('board remembers after the first load and after polls', (board.match(/rememberBoard\(cfg\.profileId, \{ networkId: cfg\.networkId/g) || []).length === 2);
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
ck('chat paints the disk copy only when nothing (memory or live) is there yet',
  /recallConversation<ChatItem>\(cfg\.profileId, conversationKeyFor\)\.then\(cached => \{\s*if \(!cached \|\| !requestGate\.isCurrent\(token\) \|\| !mountedRef\.current \|\| conversations\.peek\(conversationKeyFor\)\) return;/.test(chat));
const recallBlock = chat.slice(chat.indexOf('void recallConversation<ChatItem>'), chat.indexOf('void recallConversation<ChatItem>') + 400);
ck('a disk copy never marks the conversation ready (acks wait for live data)', !recallBlock.includes('setConversationReady(true)'));
ck('chat remembers every live read (hub rows, newest first)', /rememberConversation\(cfg\.profileId, token\.key, mergeMessagesNewestFirst\(\[\], \[\.\.\.fetched, \.\.\.proactive\]\)/.test(chat));
const storage = readFileSync(new URL('./storage.ts', import.meta.url), 'utf8');
ck('removing an account deletes its board and history caches too', /\[SESSIONS_CACHE, BOARD_CACHE, HISTORY_CACHE, AVATAR_LOCAL, OUTBOX_FILE, FORWARD_FILE\]/.test(storage));
ck('caches live in the evictable cache directory', /BOARD_CACHE = `\$\{FileSystem\.cacheDirectory\}/.test(storage) && /HISTORY_CACHE = `\$\{FileSystem\.cacheDirectory\}/.test(storage));

const runtime = readFileSync(new URL('./swr-cache.ts', import.meta.url), 'utf8');
ck('storage.ts is loaded lazily (the board / chat never fail to load for want of the cache backend)', !/^import [^\n]*from '\.\/storage';/m.test(runtime) && /import\('\.\/storage'\)/.test(runtime));

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
