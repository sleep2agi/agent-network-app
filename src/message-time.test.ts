// 2026-09-16 Vincent:「每条消息都展示下时间吧」—— 每个气泡的作者行带时刻(发出=创建时刻,回复=完成时刻)。
import fs from 'node:fs';
import path from 'node:path';
import { formatChatHeader } from './time';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const src = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8').replace(/\r\n?/g, '\n');
// 2026-11-12：发送侧作者来自 sentAuthor（本 agent 发给别人的行要写「A → B」），
// 但时刻仍必须是这行的 created_at。
ck('sent bubble author line carries the created time',
  /<ChatMetaLine name=\{sentAuthor\} time=\{item\.created_at \? formatChatHeader\(item\.created_at\) : ''\}/.test(src));
ck('reply bubble author line carries completed time, falling back to created', src.includes("formatChatHeader(item.completed_at ?? item.created_at)"));
ck('gap headers are still there (not replaced)', src.includes('shouldShowTimeHeader(item.created_at') && src.includes('<ChatTimePill time={formatChatHeader(item.created_at)}'));
// #683: the pill's no-clip guarantee moved to ChatTimePill (width floor) — chat-time-visible.test.ts measures it.
// same formatter as the headers: today → HH:mm, yesterday → 昨天 HH:mm
const now = new Date('2026-09-16T10:00:00Z').getTime();
ck('today shows HH:mm', /^\d{2}:\d{2}$/.test(formatChatHeader('2026-09-16 09:41:07', now)));
ck('yesterday shows 昨天 HH:mm', formatChatHeader('2026-09-15 09:41:07', now).startsWith('昨天 '));
ck('missing time → empty (no dangling separator)', formatChatHeader(undefined, now) === '');

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
