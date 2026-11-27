// #4591 —— 聊天页「停止」按钮的判定逻辑（纯函数，便于单测）。
//
// 事实基础（2026-11-11 在 Hub 仓核实，不靠猜）：
//   · 唯一通路是 MCP 工具 `send_message` 的 `control:"interrupt"`（server/src/tools.ts:2469-2521）。
//     **没有** `POST /api/message` 这条 REST；客户端走已有的 /mcp tools/call 桥（同 read_opencode_catalog）。
//   · Hub 回 `accepted:true` 只代表控制消息**入了 inbox**，不等于这一轮真的被截断
//     —— 与档位那套「res.ok 只是 pending」同一个道理。
//   · 节点收到后会自己做 `POST /api/session/<id>/interrupt`，然后把结果作为一条消息回给发起人，
//     文本形如 `[alias] interrupt {"ok":true,"interrupted":true}`（cli.ts:6794-6800）。
//
// 所以客户端只能：先给「已发送」，等**节点侧**的真凭据（回执文本 / 回合真的结束），
// 8 秒内没等到就照实说「已发送，节点未确认」，绝不假装成功；之后迟到的真凭据仍可升级，但有上限（见 LATE_EVIDENCE_MS）。

/** 8 秒确认窗口。到点没有真凭据 ⇒ unconfirmed（不是失败）。
 *
 *  为什么是 8 秒：聊天页的消息轮询是 5 秒一次，而节点回执要走「Hub 入队 → 节点取 → 节点打断 →
 *  回执再回来」一整圈。3 秒窗口在真机上几乎必然先判「未确认」，用户会以为没生效。
 *  8 秒覆盖一次完整轮询；即使到点成了 unconfirmed，后续真凭据（回执 / 状态翻转）仍会把它升回 interrupted。 */
export const INTERRUPT_CONFIRM_MS = 8000;

/** 迟到凭据的接受上限（从点击那一刻算）。超过就不再升级成「已停止」——
 *  否则用户点了没生效、三分钟后回合自然结束，界面也会说「已停止」，那是假消息。 */
export const LATE_EVIDENCE_MS = 30_000;

/** 点击「停止」后的快轮询间隔（毫秒）。常规在线状态轮询是 30 秒，不等它才能在 1–2 秒内确认停止。 */
export const INTERRUPT_POLL_MS = 1500;

/** 确认「已停止」后胶囊提示自动收起的时长（毫秒）。 */
export const INTERRUPT_CLEAR_MS = 2200;

export type InterruptPhase = 'idle' | 'sending' | 'waiting' | 'interrupted' | 'unconfirmed' | 'failed' | 'unsupported';

export interface StopButtonPresentation {
  tone: 'danger' | 'busy' | 'success' | 'muted';
  kind: 'stop' | 'spinner' | 'check' | 'retry';
  /** 永远是紧凑短文案 key，绝不把长段超时/错误说明塞进输入栏按钮里撑爆工具栏。 */
  labelKey: 'chat.interrupt.button' | 'chat.interrupt.stopping' | 'chat.interrupt.interrupted' | 'chat.interrupt.retryShort' | 'chat.interrupt.unsupportedShort';
}

export function stopButtonPresentation(phase: InterruptPhase): StopButtonPresentation {
  switch (phase) {
    case 'sending':
    case 'waiting':
      return { tone: 'busy', kind: 'spinner', labelKey: 'chat.interrupt.stopping' };
    case 'interrupted':
      return { tone: 'success', kind: 'check', labelKey: 'chat.interrupt.interrupted' };
    case 'unconfirmed':
    case 'failed':
      return { tone: 'danger', kind: 'retry', labelKey: 'chat.interrupt.retryShort' };
    case 'unsupported':
      return { tone: 'muted', kind: 'stop', labelKey: 'chat.interrupt.unsupportedShort' };
    default:
      return { tone: 'danger', kind: 'stop', labelKey: 'chat.interrupt.button' };
  }
}

const TERMINAL_TASK_STATUSES = new Set(['replied', 'failed', 'cancelled', 'expired']);
const ACTIVE_TASK_STATUSES = new Set(['running', 'acked', 'delivered']);

/** 捕捉点击「停止」那一刻正在执行的入站任务 ID。队列有下一条排队时，停掉上一条会秒接下一条导致
 *  sessionStatus 维持 working；记录点击时的活跃 task_id，看到它进入终态即可确认这一轮已被停下。 */
export function activeInterruptTaskId(
  messages: ReadonlyArray<{ task_id?: string | null; status?: string | null }>,
): string {
  const running = messages.find(m => m.task_id && (m.status ?? '').trim().toLowerCase() === 'running');
  if (running?.task_id) return running.task_id;
  const open = messages.find(m => m.task_id && ACTIVE_TASK_STATUSES.has((m.status ?? '').trim().toLowerCase()));
  return open?.task_id ?? '';
}

/** 点击停止时记录的活跃任务进入终态 ⇒ 证明该轮确实已停止（即使队列下一条立刻接棒）。 */
export function taskSettledProvesInterrupted(
  baselineTaskId: string | null | undefined,
  messages: ReadonlyArray<{ task_id?: string | null; status?: string | null }>,
): boolean {
  if (!baselineTaskId) return false;
  const row = messages.find(m => m.task_id === baselineTaskId);
  if (!row) return false;
  return TERMINAL_TASK_STATUSES.has((row.status ?? '').trim().toLowerCase());
}

export interface InterruptState {
  phase: InterruptPhase;
  /** 失败原因（已翻译前的原文）；其它状态为 null。 */
  detail: string | null;
}

export const idleInterrupt = (): InterruptState => ({ phase: 'idle', detail: null });

/** 只有「这一轮真的在飞」才让点。空 / offline / idle / 未知 都不行 —— 不猜。 */
export function interruptable(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'working' || s === 'running' || s === 'busy';
}

/** 发给 Hub 的控制消息正文。Hub 在 control=interrupt 时忽略正文，但 schema 要求非空。 */
export const INTERRUPT_MESSAGE = '停止当前回合（客户端控制消息）';

/** Hub 工具回执 → 是否已明确被截断。
 *  只认 `interrupted === true`；`accepted` 只是「进了 inbox」，不算。 */
export function ackProvesInterrupted(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.interrupted === true;
}

/** 节点回执文本里有没有「真的截断」的真凭据。
 *  节点发的是 `[alias] interrupt {"ok":true,"interrupted":true}`；这里只认 interrupted=true，
 *  interrupted=false / http_error / no_session 一律不当成功。 */
export function replyProvesInterrupted(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text) return false;
  const i = text.indexOf('interrupt');
  if (i < 0) return false;
  const tail = text.slice(i + 'interrupt'.length).trim();
  const brace = tail.indexOf('{');
  if (brace < 0) return false;
  // 只解析第一个 JSON 对象，别把后面的用户文本一起塞进 JSON.parse。
  const end = tail.indexOf('}', brace);
  if (end < 0) return false;
  try {
    const parsed = JSON.parse(tail.slice(brace, end + 1)) as { ok?: unknown; interrupted?: unknown };
    return parsed?.ok === true && parsed?.interrupted === true;
  } catch {
    return false;
  }
}

/** 发出后每一帧该怎么显示。信号优先级：明确截断 > 超时未确认 > 仍在等。 */
export function interruptAfterSend(input: {
  /** 工具调用本身的结果。 */
  sent: 'ok' | 'failed' | 'unsupported';
  /** 回执 / 节点消息 / 状态翻转是否已证明截断。 */
  confirmed: boolean;
  /** 从现在起是否已经过了确认窗口（INTERRUPT_CONFIRM_MS）。 */
  timedOut: boolean;
  /** 失败原因原文（sent=failed 时）。 */
  detail?: string | null;
}): InterruptState {
  if (input.sent === 'unsupported') return { phase: 'unsupported', detail: input.detail ?? null };
  if (input.sent === 'failed') return { phase: 'failed', detail: input.detail ?? null };
  if (input.confirmed) return { phase: 'interrupted', detail: null };
  if (input.timedOut) return { phase: 'unconfirmed', detail: null };
  return { phase: 'waiting', detail: null };
}

/** 会话状态从「在飞」翻走后算不算截断证据。只在**我们自己刚发过停止**时用，
 *  否则「回合自然结束」也会被当成停止成功。 */
export function statusFlipProvesInterrupted(previous: string | null | undefined, next: string | null | undefined): boolean {
  return interruptable(previous) && !interruptable(next) && (next ?? '').trim() !== '';
}
