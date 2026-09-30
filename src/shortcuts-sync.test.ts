// 设置窗口里改的快捷键 / 发送键,已开着的主窗口要跟着变(2026-09-30,tests/test-voice-shortcuts 与
// tests/test-shortcuts-settings 的 sync 检查在 main 上红:主窗口 localStorage 已经是 F8,按 F8 没反应)。
// 桌面设置是单独的窗口;shortcuts-store 每个窗口各缓存一份,原来没有 `storage` 监听。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import * as M from './shortcuts-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

// 这个窗口的 localStorage 与 window 替身:另一个窗口写同源存储时,浏览器只给「别的」窗口发 storage 事件。
const mem = new Map<string, string>();
const handlers: ((e: { key: string | null }) => void)[] = [];
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
(globalThis as any).addEventListener = (type: string, fn: (e: { key: string | null }) => void) => { if (type === 'storage') handlers.push(fn); };
const S = await import('./shortcuts-store');
const otherWindowWrites = (key: string, value: string | null) => { if (value === null) mem.delete(key); else mem.set(key, value); for (const h of handlers) h({ key }); };

console.log('\n另一个窗口改了快捷键');
ck('store 加载时挂了 storage 监听', handlers.length === 1);
S.__reloadShortcutPrefs();
ck('起始:默认绑定(先读一次,缓存住)', S.shortcutBindings()['input.voiceHold'] !== 'F8' && S.sendKeyPref() === 'enter');
let fired = 0;
const off = S.subscribeShortcuts(() => { fired++; });
otherWindowWrites(S.SHORTCUTS_KEY, M.serializeShortcutPrefs({ overrides: { 'input.voiceHold': 'F8' }, sendKey: 'modEnter' }));
ck('设置窗改成 F8 → 本窗口不重开就认 F8', S.shortcutBindings()['input.voiceHold'] === 'F8', S.shortcutBindings()['input.voiceHold']);
ck('发送键同一份存储,也跟着变(modEnter)', S.sendKeyPref() === 'modEnter');
ck('订阅者被通知(ChatScreen / DmChatScreen / 设置页重渲染)', fired === 1);

console.log('\n别的键 / 清空');
otherWindowWrites('some_other_key', 'x');
ck('别的 localStorage 键不失效缓存、不通知', fired === 1 && S.onShortcutsStorageChange('some_other_key') === false);
mem.clear();
for (const h of handlers) h({ key: null });  // localStorage.clear() in another window
ck('整个存储被清空(key=null)→ 回到默认', fired === 2 && S.shortcutBindings()['input.voiceHold'] !== 'F8' && S.sendKeyPref() === 'enter');
off();

console.log('\n接线(源码)');
const dm = read('./DmChatScreen.tsx'), chat = read('./ChatScreen.tsx');
ck('私信输入框订阅发送键(不是只在渲染时读一次)', /useSyncExternalStore\(subscribeShortcuts, sendKeyPref, sendKeyPref\)/.test(dm) && !/const sendKey = sendKeyPref\(\)/.test(dm));
ck('会话输入框订阅发送键', /useSyncExternalStore\(subscribeShortcuts, sendKeyPref, sendKeyPref\)/.test(chat));

delete (globalThis as any).localStorage;
delete (globalThis as any).addEventListener;
console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
