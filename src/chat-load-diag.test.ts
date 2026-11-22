// 本仓测试是**普通脚本 + ck()**（不是 bun:test）。
// 诊断日志只计数、不改行为。
import { createChatLoadDiag } from './chat-load-diag';

const logs: string[] = [];
const warns: string[] = [];
const origLog = console.log, origWarn = console.warn;
console.log = (...a: any[]) => { logs.push(a.join(' ')); };
console.warn = (...a: any[]) => { warns.push(a.join(' ')); };
try {
  const d = createChatLoadDiag('t');
  d.loadStarted(1, false, 20);
  d.paintDropped(1, 'token');
  d.paintDropped(1, 'sequence');
  d.paintDropped(1, 'unmounted');
  d.paintApplied(2, 3, 9);
  d.paintApplied(3, 3, -1);   // updater 未跑 → 应印 pending
  d.loadSettled(2, 42);
} finally { console.log = origLog; console.warn = origWarn; }

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; } else console.log('❌', n); };
const L = logs.join('\n'), W = warns.join('\n');
ck('start 行带 token 状态与累计计数', L.includes('start seq=1 token=stale') && L.includes('started=1'));
ck('paint applied 行带真实 merged', L.includes('paint applied seq=2 rows=3 merged=9'));
ck('updater 未跑时印 pending 而不是 -1', L.includes('paint applied seq=3 rows=3 merged=pending') && !L.includes('merged=-1'));
ck('settle 行带耗时', L.includes('settle seq=2 ms=42'));
ck('三类丢弃分别计数', W.includes('reason=token') && W.includes('dropped(token=1,seq=1,unmounted=1)'));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
