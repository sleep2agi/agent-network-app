// 切换账号(Vincent 2026-09-29):一个账号的数据不能出现在另一个账号下面。ck 风格,自执行,失败 exit 1。
//   I1  手机本地文件按账号分(迁移账号沿用旧文件名,新账号带 id)
//   I2  各处按账号分的键(会话缓存 / 置顶 / 通知免打扰 / 需求 / 任务看板)对「迁移账号 vs 新账号」「同服务器不同用户」都不相撞
//   I3  未读 ledger:切账号时上一个账号的未读、user_inbox 响应、已见 id 全部清掉(角标 / 托盘 / 通知基线)
//   I4  App / storage 的接线:切换走 hydrate → bindUnreadProfile → 整棵重挂(关旧 SSE、开新 SSE)
import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountScopedFile, createSessionStore, LEGACY_SESSION_ID, type SessionKv } from './session-registry';
import { conversationScope } from './conversation-store';
import { pinScopeKey } from './chat-pins-core';
import { requirementsKey } from './requirements-store';
import { taskScopeKey } from './task-board-store';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// ── I1 files ──
const BASE = 'file:///data/user/0/app/files/outbox_v1.json';
ck('I1a migrated account (no profileId) keeps the pre-upgrade file name', accountScopedFile(BASE) === BASE);
ck('I1b added account gets its own file', accountScopedFile(BASE, 'm-abc') === 'file:///data/user/0/app/files/outbox_v1.m-abc.json');
ck('I1c two added accounts never share a file', accountScopedFile(BASE, 'm-a') !== accountScopedFile(BASE, 'm-b'));
ck('I1d odd characters in an id cannot escape the directory', !accountScopedFile(BASE, '../x').includes('/../'));

// ── I2 keys, derived from real configs the session store hands out ──
const kvMap = new Map<string, string>([['hub_config_v1', JSON.stringify({ serverUrl: 'https://hub.example.com', token: 'utok_a', username: 'alice', networkId: 'net_1' })]]);
const kv: SessionKv = { get: async k => kvMap.get(k) ?? null, set: async (k, v) => { kvMap.set(k, v); }, del: async k => { kvMap.delete(k); } };
let n = 0;
const store = createSessionStore(kv, { newId: () => `m-${++n}` });
const legacy = (await store.activeConfig())!;
const sameServerOtherUser = await store.save({ serverUrl: 'https://hub.example.com', token: 'utok_b', username: 'bob', networkId: 'net_1' });
const otherServer = await store.save({ serverUrl: 'http://127.0.0.1:9311', token: 'utok_c', username: 'alice', networkId: 'net_1' });
const cfgs = { legacy, sameServerOtherUser, otherServer };
const notifyKey = (c: { profileId?: string; serverUrl?: string; username?: string }) => c.profileId || `${c.serverUrl ?? ''}|${c.username ?? ''}`; // == notify-settings.notifyProfileKey (asserted below)
const keyFns: Record<string, (c: typeof legacy) => string> = {
  conversation: c => conversationScope(c.profileId, c.serverUrl),
  pins: c => pinScopeKey(c),
  notify: c => notifyKey(c),
  requirements: c => requirementsKey(c.profileId ?? ''),
  taskBoard: c => taskScopeKey(c),
};
for (const [name, fn] of Object.entries(keyFns)) {
  const vals = Object.values(cfgs).map(fn);
  ck(`I2 ${name}: three accounts, three keys`, new Set(vals).size === 3, vals.join(' | '));
}
ck('I2 migrated account keeps its pre-upgrade pin key (server|user)', pinScopeKey(legacy) === pinScopeKey({ serverUrl: 'https://hub.example.com', username: 'alice' }));
ck('I2 migrated account keeps its pre-upgrade conversation scope', conversationScope(legacy.profileId, legacy.serverUrl) === 'server:https://hub.example.com');
{
  const notifySrc = readFileSync(join(import.meta.dir, 'notify-settings.ts'), 'utf8');
  ck('I2 notifyProfileKey is profileId, else server|user (the copy above matches the source)', notifySrc.includes('if (cfg.profileId) return cfg.profileId;') && notifySrc.includes("return `${cfg.serverUrl ?? ''}|${cfg.username ?? ''}`;"));
}
ck('I2 the migrated account is listed under the legacy id', (await store.loadIndex()).sessions[0].id === LEGACY_SESSION_ID);

// ── I3 unread ledger reset on switch (react-native mocked: only AppState is touched at import) ──
mock.module('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' } }));
const unread = await import('./unread-store');
unread.bindUnreadProfile('m-A');
unread.ingestUserMessagesBody({ messages: [{ id: 'x1', from_alias: 'agent-of-A' }, { id: 'x2', from_alias: 'agent-of-A' }] });
const before = unread.getUnreadSnapshot();
ck('I3 precondition: account A has 2 unread from agent-of-A', before.ledger.counts['agent-of-A'] === 2 && before.serverBody !== null);
unread.bindUnreadProfile('m-B');
const after = unread.getUnreadSnapshot();
ck('I3 switching to B clears A\'s unread counts', Object.keys(after.ledger.counts).length === 0, JSON.stringify(after.ledger.counts));
ck('I3 …A\'s user_inbox body (server-side per-agent unread) is dropped', after.serverBody === null);
ck('I3 …and A\'s seen ids (so B\'s messages are counted fresh)', after.seenIds.size === 0);
ck('I3 …and the user half is marked not-yet-ingested (notifier waits for B\'s first poll)', unread.unreadHalvesIngested().user === false);
unread.ingestUserMessagesBody({ messages: [{ id: 'y1', from_alias: 'agent-of-B' }] });
unread.bindUnreadProfile('m-B');
ck('I3 re-binding the same account is a no-op (B\'s unread survives)', unread.getUnreadSnapshot().ledger.counts['agent-of-B'] === 1);
unread.bindUnreadProfile(undefined);
ck('I3 switching to the migrated account (profileId undefined) also clears', Object.keys(unread.getUnreadSnapshot().ledger.counts).length === 0);

// ── I4 wiring ──
const root = join(import.meta.dir, '..');
const app = readFileSync(join(root, 'App.tsx'), 'utf8');
const storage = readFileSync(join(root, 'src/storage.ts'), 'utf8');
ck('I4 the whole signed-in tree is keyed by account → old SSE/pollers unmount, new ones mount', app.includes('const workspaceKey = `${theme}:${scaleKey}:${cfg?.profileId ?? cfg?.serverUrl ?? \'login\'}`;'));
ck('I4 switching hydrates that account\'s local state (outbox / avatars / forwards / unread) before setCfg', /const activateProfile = async[\s\S]*?await hydrateProfileLocalState\(next\);\s*setCfg\(next\);/.test(app));
ck('I4 hydrate binds the unread store to the account', /const hydrateProfileLocalState[\s\S]*?bindUnreadProfile\(profileId\);/.test(app));
for (const base of ['SESSIONS_CACHE', 'AVATAR_LOCAL', 'OUTBOX_FILE', 'FORWARD_FILE']) {
  const raw = (storage.match(new RegExp(`FileSystem\\.(?:writeAsStringAsync|readAsStringAsync|getInfoAsync)\\(${base}\\b`, 'g')) ?? []).length;
  const scoped = (storage.match(new RegExp(`scopedFile\\(${base}, profileId\\)`, 'g')) ?? []).length;
  ck(`I4 mobile ${base} reads/writes are per account`, raw === 0 && scoped >= 2, `raw=${raw} scoped=${scoped}`);
}
ck('I4 phone/web auth goes through the session store, not the single hub_config_v1 key', !/SecureStore\.(?:setItemAsync|getItemAsync|deleteItemAsync)\(KEY\b/.test(storage) && storage.includes('mobileSessions.save(cfg)') && storage.includes('mobileSessions.switchTo(profileId)'));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
