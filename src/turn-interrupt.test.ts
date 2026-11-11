// #4591 —— 聊天页「停止」按钮的四态（运行中 / 空闲 / 超时未确认 / 失败）+ 真凭据判据。
//   run: bun src/turn-interrupt.test.ts
//
// 判据说清楚：Hub 回 accepted 只代表控制消息进 inbox，不是「这一轮被截断」；
// 真凭据只有两种 —— 节点回执里 interrupted=true，或会话状态真的从「在飞」翻走。
import { readFileSync } from 'node:fs';
import {
  INTERRUPT_CONFIRM_MS,
  LATE_EVIDENCE_MS,
  ackProvesInterrupted,
  idleInterrupt,
  interruptAfterSend,
  interruptable,
  replyProvesInterrupted,
  statusFlipProvesInterrupted,
} from './turn-interrupt';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean, extra?: unknown) => {
  total += 1;
  if (condition) passed += 1;
  else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

// ── 1) 运行中：只有「真的有回合在飞」才让点 ────────────────────────────────
ck('working allows stop', interruptable('working'));
ck('running allows stop', interruptable('running'));
ck('idle forbids stop', !interruptable('idle'));
ck('offline forbids stop', !interruptable('offline'));
ck('empty / unknown forbids stop', !interruptable('') && !interruptable(null) && !interruptable(undefined));

// ── 2) 空闲：禁用态是 idle，且不是任何「成功」态 ───────────────────────────
ck('idle state is not a success', idleInterrupt().phase === 'idle' && idleInterrupt().detail === null);

// ── 3) 超时：3 秒没真凭据 ⇒ unconfirmed（不是失败、更不是成功）─────────────
{
  const sent = interruptAfterSend({ sent: 'ok', confirmed: false, timedOut: false });
  ck('right after send we are waiting, not done', sent.phase === 'waiting');
  const late = interruptAfterSend({ sent: 'ok', confirmed: false, timedOut: true });
  ck('no proof within the window ⇒ unconfirmed', late.phase === 'unconfirmed');
  ck('unconfirmed is not reported as interrupted', late.phase !== 'interrupted');
  ck('confirm window covers one 5s message poll', INTERRUPT_CONFIRM_MS === 8000);
ck('late evidence (status flip) is bounded', LATE_EVIDENCE_MS === 30000);
  const confirmed = interruptAfterSend({ sent: 'ok', confirmed: true, timedOut: true });
  ck('proof wins over the timeout', confirmed.phase === 'interrupted');
}

// ── 4) 失败 / 不支持：原样带原因，不冒充成功 ──────────────────────────────
{
  const failed = interruptAfterSend({ sent: 'failed', confirmed: false, timedOut: false, detail: 'HTTP 500' });
  ck('tool error ⇒ failed with detail', failed.phase === 'failed' && failed.detail === 'HTTP 500');
  const unsupported = interruptAfterSend({ sent: 'unsupported', confirmed: false, timedOut: false, detail: 'old hub' });
  ck('old hub ⇒ unsupported, not failed', unsupported.phase === 'unsupported' && unsupported.detail === 'old hub');
  ck('failure is never shown as interrupted', failed.phase !== 'interrupted' && unsupported.phase !== 'interrupted');
}

// ── 真凭据判据（Hub 与节点两侧）────────────────────────────────────────────
ck('hub accepted alone is NOT proof', !ackProvesInterrupted({ ok: true, accepted: true, control: 'interrupt' }));
ck('hub interrupted=true IS proof', ackProvesInterrupted({ ok: true, interrupted: true }));
ck('node reply interrupted=true IS proof', replyProvesInterrupted('[通信欧] interrupt {"ok":true,"interrupted":true}'));
ck('node reply interrupted=false is NOT proof', !replyProvesInterrupted('[通信欧] interrupt {"ok":true,"interrupted":false}'));
ck('node reply error is NOT proof', !replyProvesInterrupted('[通信欧] interrupt {"ok":false,"reason":"no_session"}'));
ck('unrelated chat text is NOT proof', !replyProvesInterrupted('interrupt 这个词只是普通聊天'));
ck('status flip from working proves interruption', statusFlipProvesInterrupted('working', 'idle'));
ck('status that was already idle proves nothing', !statusFlipProvesInterrupted('idle', 'idle'));
ck('empty status is not a flip', !statusFlipProvesInterrupted('working', ''));

// ── 协议与接线守卫（防止有人把不存在的 REST 通道接回来）───────────────────
{
  const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  ck('interrupt goes through the MCP bridge (send_message + control)',
    api.includes("callHubTool(cfg, 'send_message'") && api.includes("control: 'interrupt'"));
  ck('no invented REST route for interrupt', !/\$\{cfg\.serverUrl\}\/api\/message(\?|`|'|")/.test(api));
  ck('support is probed before sending (old hub would deliver our control text as chat)',
    api.includes('hubSupportsInterrupt') && api.includes("'control' in tool.inputSchema.properties"));
  ck('composer wires the stop button with the session status gate',
    screen.includes('enabled={interruptable(sessionStatus)}') && screen.includes('<ComposerStopButton'));
  ck('composer waits for node proof instead of trusting accepted',
    screen.includes('ackProvesInterrupted(res.payload)') && screen.includes('replyProvesInterrupted('));
}

console.log(`turn-interrupt: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
