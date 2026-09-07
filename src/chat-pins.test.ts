import { readFileSync } from 'node:fs';
import { pinScopeKey, togglePinned } from './chat-pins-core';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

check('toggle adds then removes', togglePinned([], 'a').join() === 'a' && togglePinned(['a', 'b'], 'a').join() === 'b');
check('toggle keeps order of the rest and never mutates input', (() => { const src = ['x', 'y']; const out = togglePinned(src, 'z'); return out.join() === 'x,y,z' && src.join() === 'x,y'; })());
check('empty alias is a no-op copy', togglePinned(['a'], '').join() === 'a');
check('scope key prefers profileId', pinScopeKey({ profileId: 'p-1', serverUrl: 'http://x', username: 'u' }) === 'p-1');
check('scope key falls back to server+username and is filename-safe', pinScopeKey({ serverUrl: 'http://hub.example:9200', username: 'admin' }) === 'http_hub.example_9200_admin');
check('two hubs with the same alias get different scopes', pinScopeKey({ serverUrl: 'http://a', username: 'u' }) !== pinScopeKey({ serverUrl: 'http://b', username: 'u' }));
check('empty everything → default', pinScopeKey({}) === 'default');
// 接线契约(App / ChatScreen import react-native,bun 里按源码查)
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const mobileChat = app.slice(app.indexOf("      ) : screen.name === 'chat' ? ("), app.indexOf("      ) : screen.name === 'nodeInfo' ? ("));
check('mobile chat header gets pinned + onTogglePin', mobileChat.includes('pinned={mobilePins.includes(screen.alias)}') && mobileChat.includes('onTogglePin={() => toggleMobilePin(screen.alias)}'));
check('mobile agents list gets pinnedAliases + onTogglePin', app.includes('pinnedAliases={mobilePins}') && app.includes('onTogglePin={toggleMobilePin}'));
check('pins reload when the profile/server changes', app.includes('[cfg?.profileId, cfg?.serverUrl, cfg?.username]'));
check('a failed save rolls the UI back instead of lying', app.includes("console.warn('save chat pins failed', error); setMobilePins(mobilePins);"));
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
check('ChatScreen header exposes 置顶/取消置顶 with state', chat.includes("accessibilityLabel={pinned ? '取消置顶会话' : '置顶会话'}") && chat.includes("name={pinned ? 'pin' : 'pin-outline'}"));
console.log(`chat pins: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
