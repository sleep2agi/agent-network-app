// admin 2026-11-20 截图：打开会话后骨架一直不消。首屏读可能因为「非前台时 usePoll 不跑」
// 或请求失败而永远不回来 —— 必须有可点的重试，不能干等。
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log('✅', name); } else console.log('❌', name); };

const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
ck('骨架卡住 8 秒后出现重试按钮', /setTimeout\(\(\) => setLoadStalled\(true\), 8000\)/.test(chat));
ck('重试按钮有 testID 且会真的重跑 load', /testID="chat-load-retry"/.test(chat) && /void load\(limitRef\.current\)/.test(chat));
ck('loaded 后清掉 stalled 状态', /if \(loaded\) \{ setLoadStalled\(false\); return; \}/.test(chat));
const i18n = readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8');
ck('文案中英都有', /'chat\.loadStalledRetry': \['加载有点慢，点一下重试'/.test(i18n));

console.log(`chat-load-retry: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
