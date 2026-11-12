// #4685 —— 原生 steer 客户端判定：三种节点回执 + 窗口 + 空闲不插话。
// 用例是「行为」，不是实现形状：只断言用户最终看到的结论。
import { canSteer, parseSteerAck, steerOutcome, steerThenConfirm, STEER_ACK_WINDOW_MS } from './steer-delivery';

let pass = 0;
const fails: string[] = [];
const ck = (name: string, ok: boolean) => { if (ok) pass += 1; else fails.push(name); };

// 1) 三种回执各自映射
ck('ack: merged into the running turn', JSON.stringify(parseSteerAck('steer {"ok":true,"delivered":"steer"}')) === '{"kind":"steer"}');
ck('ack: missed when the turn already ended', (() => {
  const a = parseSteerAck('steer {"ok":false,"delivered":"missed","reason":"no-running-turn"}');
  return a?.kind === 'missed' && a.reason === 'no-running-turn';
})());
ck('ack: failed carries the reason verbatim', (() => {
  const a = parseSteerAck('steer {"ok":false,"delivered":"failed","reason":"runtime_steer_unsupported"}');
  return a?.kind === 'failed' && a.reason === 'runtime_steer_unsupported';
})());

// 2) 普通聊天不能被当成回执（否则用户会看到莫名「已并入」）
ck('ack: plain chat text is not an ack', parseSteerAck('好的，我继续写第 30 条。') === null);
ck('ack: malformed json is not an ack', parseSteerAck('steer {ok:true') === null);
ck('ack: null/empty is not an ack', parseSteerAck(null) === null && parseSteerAck('') === null);
ck('ack: unknown delivered value is not an ack', parseSteerAck('steer {"ok":true,"delivered":"queued"}') === null);

// 3) 结局映射：等待 ≠ 成功；超时 ≠ 失败
ck('outcome: no ack yet is waiting, not success', steerOutcome(null, false).phase === 'waiting');
ck('outcome: timeout is unconfirmed, not delivered', steerOutcome(null, true).phase === 'unconfirmed');
ck('outcome: missed is missed', steerOutcome({ kind: 'missed', reason: 'no-running-turn' }, false).phase === 'missed');

// 4) 只有真的在飞才允许「插话」
ck('gate: working/running/busy allow steer', canSteer('working') && canSteer('running') && canSteer('BUSY'));
ck('gate: idle/offline/unknown do not steer', !canSteer('idle') && !canSteer('offline') && !canSteer('') && !canSteer(null));

// 5) 窗口行为（注入依赖，不睡真时钟）
type Row = { text: string; at: number };
const runWatch = async (opts: { rows: Row[]; clock: { t: number }; send?: () => Promise<{ ok: boolean; error?: string }> }) => {
  const reads: Array<Row[]> = [];
  return steerThenConfirm({
    send: opts.send ?? (async () => ({ ok: true, payload: { delivery: 'steer' } })),
    readRecent: async () => { const r = opts.rows.slice(); reads.push(r); return r; },
    sleep: async () => { opts.clock.t += 1000; },
    windowMs: STEER_ACK_WINDOW_MS,
    pollMs: 1000,
    now: () => opts.clock.t,
  });
};

const clock = { t: 1_000_000 };
const seenAfter = { t: 1_000_500 };

ck('watch: ack after send ⇒ delivered', await (async () => {
  const rows: Row[] = [{ text: 'steer {"ok":true,"delivered":"steer"}', at: seenAfter.t }];
  const r = await runWatch({ rows, clock: { ...clock } });
  return r.outcome.phase === 'delivered';
})());

ck('watch: ack present BEFORE send is ignored', await (async () => {
  const rows: Row[] = [{ text: 'steer {"ok":true,"delivered":"steer"}', at: 999_000 }];
  const r = await runWatch({ rows, clock: { ...clock } });
  return r.outcome.phase === 'unconfirmed';
})());

ck('watch: missed ⇒ missed (not delivered)', await (async () => {
  const rows: Row[] = [{ text: 'steer {"ok":false,"delivered":"missed","reason":"no-running-turn"}', at: seenAfter.t }];
  const r = await runWatch({ rows, clock: { ...clock } });
  return r.outcome.phase === 'missed';
})());

ck('watch: failed keeps the reason', await (async () => {
  const rows: Row[] = [{ text: 'steer {"ok":false,"delivered":"failed","reason":"boom"}', at: seenAfter.t }];
  const r = await runWatch({ rows, clock: { ...clock } });
  return r.outcome.phase === 'failed' && r.outcome.phase === 'failed' && (r.outcome as { detail: string }).detail === 'boom';
})());

ck('watch: send error short-circuits to failed', await (async () => {
  const r = await runWatch({ rows: [], clock: { ...clock }, send: async () => ({ ok: false, error: 'steer_conflicts_with_control' }) });
  return r.outcome.phase === 'failed' && (r.outcome as { detail: string }).detail === 'steer_conflicts_with_control';
})());

ck('watch: no ack within window ⇒ unconfirmed', await (async () => {
  const r = await runWatch({ rows: [{ text: '还在写…', at: seenAfter.t }], clock: { ...clock } });
  return r.outcome.phase === 'unconfirmed';
})());

console.log(`steer-delivery: ${pass}/${pass + fails.length}`);
if (fails.length) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
