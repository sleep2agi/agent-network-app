// #4592 —— 回合在飞时「先打断，再以新指令开新一轮」的判定（纯逻辑 + 注入依赖，便于单测）。
//
// 现实（不要按理想做）：OpenCode V2 2.0.22 **不支持运行中无缝插话**。
// 所以客户端只能：先 `send_message(control="interrupt")` → 等真凭据（复用 #4591 的判定）
// → 再把新指令作为新任务发出。用户看到的是「我说话 → 上一轮停下 → 新的一轮开始」。
//
// 判据复用 turn-interrupt.ts，不复制一套：
//   · ackProvesInterrupted —— Hub 回 accepted 不算，只有 interrupted===true 才算
//   · statusFlipProvesInterrupted —— 会话状态从 working/running 翻走也算
//   · 节点控制回执（replyProvesInterrupted）+ 基线任务终态（taskSettledProvesInterrupted）：
//     antigravity-acp 等慢退出 runtime 在 +3s 就回 `{"ok":true,"interrupted":true}`，但退出翻 idle
//     需 9–16s；收到回执后扩展宽限窗口等待 idle / 任务落终态，避免 8s 误判超时放弃发送。
import {
  INTERRUPT_EXIT_GRACE_MS,
  ackProvesInterrupted,
  interruptable,
  statusFlipProvesInterrupted,
} from './turn-interrupt';

export { INTERRUPT_EXIT_GRACE_MS };

export type InterruptVerdict = 'confirmed' | 'unconfirmed' | 'failed' | 'unsupported';

export interface InterruptThenConfirmDeps {
  /** 发控制消息（生产里是 interruptTurn）。 */
  interrupt: () => Promise<{ ok: boolean; payload?: unknown; unsupported?: boolean; error?: string }>;
  /** 读这个 alias 的当前会话状态；失败返回 null。 */
  readStatus: () => Promise<string | null>;
  /** 可选：检查点击时记录的基线活跃任务是否已进入终态。 */
  readTaskSettled?: () => Promise<boolean>;
  /** 可选：检查节点是否已回传 `interrupt {"ok":true,"interrupted":true}` 控制回执。 */
  readReplyProof?: () => Promise<boolean>;
  /** 可选：首次拿到节点 `interrupted:true` 回执但 runtime 尚未退出翻态时回调（便于更新 UI 提示）。 */
  onReplyAcked?: () => void;
  sleep: (ms: number) => Promise<void>;
  /** 未收到任何凭据时的初始确认窗口（毫秒）。 */
  windowMs: number;
  /** 收到节点 `interrupted:true` 回执后，等待 runtime 退出翻 idle / 任务落终态的宽限窗口（毫秒）。 */
  graceWindowMs?: number;
  /** 轮询间隔（毫秒）。 */
  pollMs: number;
  /** 可选时钟注入（便于单测）。 */
  now?: () => number;
}

/** 等「上一轮真的停下」的真凭据；拿不到就如实说 unconfirmed，不假装成功。 */
export async function interruptThenConfirm(deps: InterruptThenConfirmDeps): Promise<{ verdict: InterruptVerdict; detail?: string }> {
  let baseline = await deps.readStatus();
  const res = await deps.interrupt();
  if (!res.ok) {
    return res.unsupported ? { verdict: 'unsupported', detail: res.error } : { verdict: 'failed', detail: res.error };
  }
  if (ackProvesInterrupted(res.payload)) return { verdict: 'confirmed' };
  const nowFn = deps.now ?? Date.now;
  let deadline = nowFn() + Math.max(0, deps.windowMs);
  const graceMs = Math.max(0, deps.graceWindowMs ?? INTERRUPT_EXIT_GRACE_MS);
  let replyAcked = false;
  // 至少读一次：控制消息可能已经生效，而 baseline 是发送前那一拍。
  while (nowFn() <= deadline) {
    await deps.sleep(deps.pollMs);
    const nowStatus = await deps.readStatus().catch(() => null);
    if (statusFlipProvesInterrupted(baseline, nowStatus)) return { verdict: 'confirmed' };
    if (!interruptable(baseline) && interruptable(nowStatus)) baseline = nowStatus;
    if (replyAcked && nowStatus && !interruptable(nowStatus)) return { verdict: 'confirmed' };
    if (deps.readTaskSettled && (await deps.readTaskSettled().catch(() => false))) {
      return { verdict: 'confirmed' };
    }
    if (!replyAcked && deps.readReplyProof) {
      const gotReply = await deps.readReplyProof().catch(() => false);
      if (gotReply) {
        replyAcked = true;
        deps.onReplyAcked?.();
        if (nowStatus && !interruptable(nowStatus)) return { verdict: 'confirmed' };
        deadline = Math.max(deadline, nowFn() + graceMs);
      }
    }
  }
  return replyAcked ? { verdict: 'confirmed' } : { verdict: 'unconfirmed' };
}

/** 发送前该不该走「打断」这条路：只有真的在飞才走；空闲/离线/未知都直接发。 */
export function shouldInterruptBeforeSend(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'working' || s === 'running' || s === 'busy';
}
