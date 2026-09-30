// @ts-nocheck -- repository test scripts run directly under Bun.
// XHR SSE (phone / web) keeps every received byte in responseText. A chat left open for hours
// would grow it without bound, so past the cap the connection is recycled. Driven with a fake
// XMLHttpRequest through both real consumers.
import { openNetworkEventStream } from './logs-sse';
import { openUserEventStream } from './user-events-sse';
import { __setXhrSseRecycleCharsForTest, XHR_SSE_RECYCLE_CHARS } from './logs-buffer';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const opened: FakeXhr[] = [];
class FakeXhr {
  static HEADERS_RECEIVED = 2;
  readyState = 0; status = 0; responseText = ''; aborted = false; url = '';
  onreadystatechange: any; onprogress: any; onload: any; onerror: any; onabort: any;
  open(_m: string, url: string) { this.url = url; }
  setRequestHeader() {}
  send() { opened.push(this); this.status = 200; this.readyState = 2; this.onreadystatechange?.(); }
  abort() { this.aborted = true; this.onabort?.(); }
  push(text: string) { this.responseText += text; this.onprogress?.(); }
}
(globalThis as any).XMLHttpRequest = FakeXhr;
const frame = (i: number, pad = 0) => `data: ${JSON.stringify({ type: 'new_reply', from: 'a', n: i, pad: 'x'.repeat(pad) })}\n\n`;

ck('cap is 1 M characters in production', XHR_SSE_RECYCLE_CHARS === 1_000_000);

for (const [name, open] of [
  ['network stream (logs / reply push)', (h) => openNetworkEventStream({ serverUrl: 'http://hub.invalid', token: 'utok_x' }, 'net-a', h)],
  ['user stream (desktop messages / DMs)', (h) => openUserEventStream({ serverUrl: 'http://hub.invalid', token: 'utok_x', networkId: 'net-a' }, h)],
] as const) {
  opened.length = 0;
  __setXhrSseRecycleCharsForTest(500);
  const events: any[] = [];
  const states: string[] = [];
  const close = open({ onEvent: (e) => events.push(e), onState: (s) => states.push(s) });
  await sleep(0);
  const first = opened[0];
  ck(`${name}: opens one XHR`, opened.length === 1 && !!first);
  first.push(frame(1));
  first.push(frame(2));
  ck(`${name}: below the cap nothing is recycled`, opened.length === 1 && !first.aborted && events.length === 2);
  first.push(frame(3, 600));
  ck(`${name}: the event that crossed the cap is still delivered`, events.length === 3 && events[2].n === 3);
  ck(`${name}: past the cap the old XHR is aborted and dropped`, first.aborted && first.onprogress === null && first.onload === null && first.onerror === null);
  ck(`${name}: a fresh XHR replaces it at once (no backoff)`, opened.length === 2 && opened[1] !== first);
  first.push(frame(99));
  ck(`${name}: late bytes on the old XHR are ignored`, !events.some(e => e.n === 99));
  opened[1].push(frame(4));
  ck(`${name}: the new connection starts reading from zero`, events.at(-1)?.n === 4 && events.length === 4);
  close();
  ck(`${name}: close() aborts the current XHR and stops`, opened[1].aborted && opened.length === 2);
  opened[1].push(frame(5, 600));
  ck(`${name}: nothing reconnects after close()`, opened.length === 2);
}
__setXhrSseRecycleCharsForTest();

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
