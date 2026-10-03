// #518「发送消息一直是 发送中」(owner 2026-10-03 21:56,桌面端;同一时刻生产 hub 重启了约 5 s,那条消息没进 hub)。
//
// 一个乐观气泡只有两条出路:发起它的那次 doSend 回来改本地 state,或者 load() 按 hub 的行把它对掉。
// 下面三条路径两条都走不通,气泡就永远「发送中…」:
//   1. doSend 失败时会话已经不是它(切到别的 agent 再切回 / 桌面主窗口复用 ChatScreen / 重挂):
//      旧代码只对账、对不上就 `return` —— outbox 留在 'pending',新的会话实例从 outbox 恢复出「发送中」,
//      而没有任何人会再把它改成失败;
//   2. app 被杀 / 重开:initOutbox 保留 'pending'「等对账」,但 load() 只会删掉 hub 有的,从不把 hub 没有的
//      判成失败;
//   3. 请求本身不结束(sendTask 的响应体 / 附件上传没有上限)—— 见 api.ts / attach.ts 的硬上限。
//
// 修法:这个 JS 进程里**正在发**的 id 记在 inFlight 里。一个 'pending' 的 outbox 条目如果不在 inFlight 里,
// 就没有人会再结束它了(孤儿)⇒ 标 'failed'(可重试;重试复用同一个 client_request_id,hub 去重,不会多发)。
// 气泡的状态跟 outbox 走:outbox 变了(别的实例的 doSend 结束了)就重算一遍。绝不自动重发。
import type { OutboxEntry } from './outbox';

const inFlight = new Set<string>();

export function beginSend(id: string): void { inFlight.add(id); }
export function endSend(id: string): void { inFlight.delete(id); }
export function isSendInFlight(id: string): boolean { return inFlight.has(id); }
/** Test-only. */
export function __resetSendLifecycleForTest(): void { inFlight.clear(); }

/** 'pending' 却没有人在发的条目 —— 上一个进程留下的,或发起它的实例已经放手。 */
export function orphanedPendingIds(entries: readonly OutboxEntry[], inFlightNow: (id: string) => boolean = isSendInFlight): string[] {
  return entries.filter(e => e.state === 'pending' && !inFlightNow(e.id)).map(e => e.id);
}

export type EchoState = { _localId?: string; _pending?: boolean; _failed?: boolean };

/**
 * 让一个会话里的本地回显跟 outbox 一致(纯函数)。只改 `_pending` / `_failed`:
 *   - 在发 → 「发送中」;
 *   - outbox 里 failed 或孤儿 pending → 「未送达 · 重试」;
 *   - outbox 里已经没有、也没人在发 → 某次 doSend 确认成功删掉了它 →「已送达」(等 hub 行来顶掉,chat-echo.ts)。
 * (每个「未送达」都在 outbox 里 —— 附件上传失败的那条也是,见 ChatScreen doSend —— 所以 outbox 里没有 = 已确认。)
 */
export function settleEchoes<T extends EchoState>(
  items: readonly T[],
  entryOf: (id: string) => OutboxEntry | undefined,
  inFlightNow: (id: string) => boolean = isSendInFlight,
): T[] {
  let changed = false;
  const out = items.map(item => {
    const id = item._localId;
    if (!id || (!item._pending && !item._failed)) return item;
    const sending = inFlightNow(id);
    const entry = entryOf(id);
    let next: { _pending: boolean; _failed: boolean };
    if (sending) next = { _pending: true, _failed: false };
    else if (!entry) next = { _pending: false, _failed: false };
    else next = { _pending: false, _failed: true };
    if (!!item._pending === next._pending && !!item._failed === next._failed) return item;
    changed = true;
    return { ...item, ...next };
  });
  return changed ? out : (items as T[]);
}
