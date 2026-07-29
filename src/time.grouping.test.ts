import { shouldShowTimeHeader, formatChatHeader, CHAT_TIME_GAP_MS } from './time';
let pass=0,total=0; const ck=(n:string,c:boolean)=>{total++;if(c){pass++;console.log('  ✅',n)}else console.log('  ❌',n)};
// grouping decision
ck('oldest (no older) → header', shouldShowTimeHeader('2026-07-16 03:00:00', undefined)===true);
ck('gap 6min > 5min → header', shouldShowTimeHeader('2026-07-16 03:06:00','2026-07-16 03:00:00')===true);
ck('gap 2min < 5min → no header', shouldShowTimeHeader('2026-07-16 03:02:00','2026-07-16 03:00:00')===false);
ck('exactly 5min → no header (not >)', shouldShowTimeHeader('2026-07-16 03:05:00','2026-07-16 03:00:00')===false);
ck('bad/empty cur → no header (no crash)', shouldShowTimeHeader(undefined,'2026-07-16 03:00:00')===false);
ck('GAP const = 5min', CHAT_TIME_GAP_MS===300000);
// header format (UTC input·local render·use a fixed now to make deterministic-ish for same-day check)
const now = new Date('2026-07-16T12:00:00Z').getTime();
ck('today → HH:MM only', /^\d{2}:\d{2}$/.test(formatChatHeader('2026-07-16 04:00:00', now)));
ck('yesterday → 昨天 HH:MM', /^昨天 \d{2}:\d{2}$/.test(formatChatHeader('2026-07-15 04:00:00', now)));
ck('same year older → M月D日 HH:MM', /月.+日 \d{2}:\d{2}$/.test(formatChatHeader('2026-03-01 04:00:00', now)));
ck('prior year → 年月日', /2025年.+月.+日/.test(formatChatHeader('2025-03-01 04:00:00', now)));
ck('empty → ""', formatChatHeader(undefined, now)==='');
console.log(`\n  ${pass}/${total} passed`); process.exit(pass===total?0:1);
