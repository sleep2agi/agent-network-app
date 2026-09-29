// @ts-nocheck -- repository test scripts run directly under Bun.
// Reply push: the hub's network observer stream wakes the open conversation on `new_reply`
// instead of waiting up to 5 s for the next poll. The poll stays as the fallback.
import { readFileSync } from 'node:fs';
import { replyWakesConversation, subscribeHubTraffic, onConversationReply, __openStreamCount } from './reply-wake';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── which events wake which conversation ──
ck('new_reply from the agent wakes its conversation', replyWakesConversation({ type: 'new_reply', from: '示例-A', to: 'tester', task_id: 't1' }, '示例-A'));
ck('new_reply from another agent does not', !replyWakesConversation({ type: 'new_reply', from: '示例-B', task_id: 't9' }, '示例-A'));
ck('new_task (someone sending to the agent) does not', !replyWakesConversation({ type: 'new_task', from: 'tester', to: '示例-A' }, '示例-A'));
ck('a reply to a task this conversation shows wakes it even under another sender name',
  replyWakesConversation({ type: 'new_reply', from: '示例-A-renamed', task_id: 't1' }, '示例-A', id => id === 't1'));
ck('an unknown task id from another sender does not', !replyWakesConversation({ type: 'new_reply', from: 'x', task_id: 't2' }, '示例-A', id => id === 't1'));
ck('malformed events never wake', !replyWakesConversation({}, '示例-A') && !replyWakesConversation({ type: 'new_reply', from: 42 }, '42'));

// ── one shared stream per hub/network ──
const opened: any[] = [];
const fakeOpen = (cfg, netId, handlers) => { const s = { netId, handlers, closed: false }; opened.push(s); return () => { s.closed = true; }; };
const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_x', networkId: 'net-a' };
const seenA: any[] = [], seenB: any[] = [];
const offA = subscribeHubTraffic(cfg, e => seenA.push(e), fakeOpen);
const offB = subscribeHubTraffic(cfg, e => seenB.push(e), fakeOpen);
ck('two subscribers share one stream', opened.length === 1 && opened[0].netId === 'net-a' && __openStreamCount() === 1);
opened[0].handlers.onEvent({ type: 'new_reply', from: 'a' });
ck('every subscriber sees each event', seenA.length === 1 && seenB.length === 1);
offA();
ck('stream stays open while a subscriber is left', !opened[0].closed);
offB();
ck('stream closes with the last subscriber', opened[0].closed && __openStreamCount() === 0);
ck('no network id → no stream at all', (subscribeHubTraffic({ ...cfg, networkId: undefined }, () => {}, fakeOpen)(), opened.length === 1));
const offC = subscribeHubTraffic({ ...cfg, networkId: 'net-b' }, () => {}, fakeOpen);
ck('another network gets its own stream', opened.length === 2 && opened[1].netId === 'net-b');
offC();

// ── wake: coalesced, filtered, cancelled on leave ──
{
  opened.length = 0;
  let wakes = 0;
  const off = onConversationReply(cfg, '示例-A', () => { wakes++; }, { coalesceMs: 20, open: fakeOpen });
  const s = opened[0];
  s.handlers.onEvent({ type: 'new_reply', from: '示例-A' });
  s.handlers.onEvent({ type: 'new_reply', from: '示例-A' });
  s.handlers.onEvent({ type: 'new_reply', from: '示例-B' });
  await sleep(50);
  ck('a burst of replies collapses into one read', wakes === 1);
  s.handlers.onEvent({ type: 'new_reply', from: '示例-A' });
  off();
  await sleep(50);
  ck('leaving the conversation cancels a pending wake and closes the stream', wakes === 1 && s.closed);
}
{
  opened.length = 0;
  let wakes = 0;
  const off = onConversationReply(cfg, '示例-A', () => { wakes++; }, { coalesceMs: 5, open: fakeOpen });
  opened[0].handlers.onEvent({ type: 'new_reply', from: '示例-A' });
  await sleep(20);
  opened[0].handlers.onEvent({ type: 'new_reply', from: '示例-A' });
  await sleep(20);
  ck('replies after the coalesce window each wake again', wakes === 2);
  off();
}

// ── wiring ──
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
ck('chat wakes its own load on a reply', /onConversationReply\(cfg, alias, \(\) => \{ void load\(limitRef\.current\); \}/.test(chat));
ck('the 5 s poll is still there as the fallback', /usePoll\(\(\) => load\(limitRef\.current\), 5000, \[load\]\)/.test(chat));
const sse = readFileSync(new URL('./logs-sse.ts', import.meta.url), 'utf8');
ck('the stream is the hub observer route /events/network/:id', sse.includes('/events/network/${encodeURIComponent(netId)}') && sse.includes("'start_network_event_stream'"));

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
