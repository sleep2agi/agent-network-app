import { downloadEta, formatEta, formatSpeed } from './download-eta';
let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

ck('half way → 50%, eta = remaining/speed', (() => { const r = downloadEta(500, 1000, 1000); return r.percent === 50 && r.etaSeconds === 1; })());
ck('no total → percent and eta unknown, speed still shown', (() => { const r = downloadEta(500, undefined, 1000); return r.percent === null && r.etaSeconds === null && Math.round(r.speedBps!) === 500; })());
ck('too early (<250ms) → no speed yet', downloadEta(10, 1000, 100).speedBps === null);
ck('clamps percent to 100 when server sends more than declared', downloadEta(1200, 1000, 1000).percent === 100);
ck('zero received → no speed', downloadEta(0, 1000, 5000).speedBps === null);
ck('eta formatting: seconds / minutes / sub-second', formatEta(8) === '8 秒' && formatEta(80) === '1 分 20 秒' && formatEta(120) === '2 分' && formatEta(0.4) === '不到 1 秒');
ck('eta formatting: null passes through', formatEta(null) === null);
ck('speed formatting: B / KB / MB', formatSpeed(900) === '900 B/s' && formatSpeed(2048) === '2 KB/s' && formatSpeed(3 * 1024 * 1024) === '3.0 MB/s');
console.log(`download eta: ${p}/${t}`);
if (p !== t) process.exit(1);
