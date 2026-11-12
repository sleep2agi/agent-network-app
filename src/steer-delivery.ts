// #4685 —— 原生 steer（插话）的客户端判定：把节点回执翻成三种结局。
//
// 链路（Hub #3553 / 节点刀 4e2f1a78）：
//   客户端 → send_message(alias, message, steer:true) → Hub 落 inbox(meta.delivery="steer")
//   → 节点在「当前有在跑的轮次」时把它注入该轮，并回一条消息：
//       steer {"ok":true,"delivered":"steer"}                        已并入当前轮次
//       steer {"ok":false,"delivered":"missed","reason":"no-running-turn"}  这一轮已结束，未插入
//       steer {"ok":false,"delivered":"failed","reason":…}            失败
//
// 关键边界（2026-11-12 与运行时侧确认）：
//   · 投递后若轮次已结束，节点**丢弃**，不会「变成下一轮」；
//   · 所以 UI 不能在只拿到 accepted 时说「已并入」，必须等这条回执。
import { INTERRUPT_CONFIRM_MS } from './turn-interrupt';

/** 等节点回执的窗口：与打断确认同一量级（一次消息轮询 5s + 余量）。 */
export const STEER_ACK_WINDOW_MS = INTERRUPT_CONFIRM_MS + 2000;

export type SteerAck =
  | { kind: 'steer' }
  | { kind: 'missed'; reason: string }
  | { kind: 'failed'; reason: string };

/** 节点的 steer 回执文本 → 三态；不是 steer 回执返回 null（不能把普通聊天当成回执）。 */
export function parseSteerAck(text: string | null | undefined): SteerAck | null {
  if (typeof text !== 'string') return null;
  const i = text.indexOf('steer');
  if (i < 0) return null;
  const tail = text.slice(i + 'steer'.length).trim();
  const brace = tail.indexOf('{');
  if (brace < 0) return null;
  const end = tail.indexOf('}', brace);
  if (end < 0) return null;
  let parsed: { ok?: unknown; delivered?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(tail.slice(brace, end + 1)) as typeof parsed;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const delivered = typeof parsed.delivered === 'string' ? parsed.delivered : '';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  if (parsed.ok === true && delivered === 'steer') return { kind: 'steer' };
  if (delivered === 'missed') return { kind: 'missed', reason: reason || 'no-running-turn' };
  if (delivered === 'failed') return { kind: 'failed', reason: reason || 'unknown' };
  return null;
}

export type SteerOutcome =
  | { phase: 'waiting' }
  | { phase: 'delivered' }
  | { phase: 'missed' }
  | { phase: 'failed'; detail: string }
  | { phase: 'unconfirmed' };

/** 窗口内拿到回执就用回执；窗口过了还没有 ⇒ 未确认（不是成功，也不是失败）。 */
export function steerOutcome(ack: SteerAck | null, timedOut: boolean): SteerOutcome {
  if (ack) {
    if (ack.kind === 'steer') return { phase: 'delivered' };
    if (ack.kind === 'missed') return { phase: 'missed' };
    return { phase: 'failed', detail: ack.reason };
  }
  return timedOut ? { phase: 'unconfirmed' } : { phase: 'waiting' };
}

/** 只有「有回合在飞」才让点「插话」；空闲时发普通消息，不把普通消息变成 steer。 */
export function canSteer(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'working' || s === 'running' || s === 'busy';
}

export interface SteerAckDeps {
  /** 发 steer（生产里是 steerInFlight）。 */
  send: () => Promise<{ ok: boolean; payload?: unknown; unsupported?: boolean; error?: string }>;
  /** 返回**当前可见**的消息文本与到达时间；调用方负责排序/去重，这里只按时间过滤。 */
  readRecent: () => Promise<Array<{ text: string; at: number }>>;
  sleep: (ms: number) => Promise<void>;
  windowMs: number;
  pollMs: number;
  now?: () => number;
}

/** 发出去 → 等节点那条 `steer {...}` 回执 → 三态。拿不到回执就是「未确认」，不假装并入。 */
export async function steerThenConfirm(deps: SteerAckDeps): Promise<{ outcome: SteerOutcome; detail?: string }> {
  const now = deps.now ?? Date.now;
  const since = now();
  const res = await deps.send();
  if (!res.ok) return { outcome: { phase: 'failed', detail: res.error ?? 'unknown' } };
  const deadline = now() + Math.max(0, deps.windowMs);
  while (now() <= deadline) {
    const seen = await deps.readRecent().catch(() => []);
    for (const row of seen) {
      if (row.at < since) continue;   // 发送之前就存在的消息不能当作这次的回执
      const ack = parseSteerAck(row.text);
      if (!ack) continue;
      if (ack.kind === 'steer') return { outcome: { phase: 'delivered' } };
      if (ack.kind === 'missed') return { outcome: { phase: 'missed' } };
      return { outcome: { phase: 'failed', detail: ack.reason } };
    }
    await deps.sleep(deps.pollMs);
  }
  return { outcome: { phase: 'unconfirmed' } };
}
