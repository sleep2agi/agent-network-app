// #4592 —— 回合在飞时「先打断，再以新指令开新一轮」的判定（纯逻辑 + 注入依赖，便于单测）。
//
// 现实（不要按理想做）：OpenCode V2 2.0.22 **不支持运行中无缝插话**。
// 所以客户端只能：先 `send_message(control="interrupt")` → 等真凭据（复用 #4591 的判定）
// → 再把新指令作为新任务发出。用户看到的是「我说话 → 上一轮停下 → 新的一轮开始」。
//
// 判据复用 turn-interrupt.ts，不复制一套：
//   · ackProvesInterrupted —— Hub 回 accepted 不算，只有 interrupted===true 才算
//   · statusFlipProvesInterrupted —— 会话状态从 working/running 翻走也算
import { ackProvesInterrupted, statusFlipProvesInterrupted } from './turn-interrupt';

export type InterruptVerdict = 'confirmed' | 'unconfirmed' | 'failed' | 'unsupported';

export interface InterruptThenConfirmDeps {
  /** 发控制消息（生产里是 interruptTurn）。 */
  interrupt: () => Promise<{ ok: boolean; payload?: unknown; unsupported?: boolean; error?: string }>;
  /** 读这个 alias 的当前会话状态；失败返回 null。 */
  readStatus: () => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  /** 确认窗口（毫秒）。 */
  windowMs: number;
  /** 轮询间隔（毫秒）。 */
  pollMs: number;
}

/** 等「上一轮真的停下」的真凭据；拿不到就如实说 unconfirmed，不假装成功。 */
export async function interruptThenConfirm(deps: InterruptThenConfirmDeps): Promise<{ verdict: InterruptVerdict; detail?: string }> {
  const before = await deps.readStatus();
  const res = await deps.interrupt();
  if (!res.ok) {
    return res.unsupported ? { verdict: 'unsupported', detail: res.error } : { verdict: 'failed', detail: res.error };
  }
  if (ackProvesInterrupted(res.payload)) return { verdict: 'confirmed' };
  const deadline = Date.now() + Math.max(0, deps.windowMs);
  // 至少读一次：控制消息可能已经生效，而 before 是发送前那一拍。
  while (Date.now() <= deadline) {
    await deps.sleep(deps.pollMs);
    const now = await deps.readStatus();
    if (statusFlipProvesInterrupted(before, now)) return { verdict: 'confirmed' };
    if (now === null) continue;
  }
  return { verdict: 'unconfirmed' };
}

/** 发送前该不该走「打断」这条路：只有真的在飞才走；空闲/离线/未知都直接发。 */
export function shouldInterruptBeforeSend(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'working' || s === 'running' || s === 'busy';
}
