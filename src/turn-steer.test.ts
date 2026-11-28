// #4592 —— 回合在飞时「先打断、再发新指令」的判定。
//   run: bun src/turn-steer.test.ts
//
// 现实：OpenCode V2 2.0.22 不支持运行中无缝插话 ⇒ 客户端只能「打断 + 新轮」。
// 判据复用 turn-interrupt.ts（accepted≠截断、状态翻转算凭据），不复制一套。
import { readFileSync } from 'node:fs';
import { interruptThenConfirm, shouldInterruptBeforeSend } from './turn-steer';

let passed = 0;
let total = 0;
const ck = (name: string, cond: boolean, extra?: unknown) => {
  total += 1;
  if (cond) passed += 1;
  else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

// ── 什么时候才走打断这条路 ────────────────────────────────────────────────
ck('working goes through interrupt', shouldInterruptBeforeSend('working'));
ck('running goes through interrupt', shouldInterruptBeforeSend('running'));
ck('idle sends directly (no interrupt call)', !shouldInterruptBeforeSend('idle'));
ck('offline sends directly', !shouldInterruptBeforeSend('offline'));
ck('unknown/empty sends directly', !shouldInterruptBeforeSend('') && !shouldInterruptBeforeSend(null) && !shouldInterruptBeforeSend(undefined));

const deps = (over: Partial<Parameters<typeof interruptThenConfirm>[0]> = {}) => {
  let statusReads: Array<string | null> = [];
  return {
    seen: { statusReads },
    d: {
      interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true, control: 'interrupt' } }),
      readStatus: async () => (statusReads.length ? statusReads.shift()! : 'working'),
      sleep: async () => {},
      windowMs: 8000,
      pollMs: 1,
      ...over,
    } as Parameters<typeof interruptThenConfirm>[0],
  };
};

// ── on-the-fly: 打断后状态翻走 ⇒ confirmed，可以发新指令 ───────────────────
{
  const { d } = deps({ readStatus: (() => { const seq = ['working', 'working', 'idle']; return async () => (seq.length ? seq.shift()! : 'idle'); })() });
  const r = await interruptThenConfirm(d);
  ck('status flip proves the turn stopped', r.verdict === 'confirmed', r);
}

// ── Hub 明确回 interrupted=true ⇒ 直接 confirmed，不用等窗口 ───────────────
{
  const { d } = deps({ interrupt: async () => ({ ok: true, payload: { ok: true, interrupted: true } }) });
  const r = await interruptThenConfirm(d);
  ck('hub interrupted=true is proof', r.verdict === 'confirmed', r);
}

// ── 只有 accepted、状态一直 working ⇒ unconfirmed（不许假装成功）────────────
{
  const { d } = deps({ readStatus: async () => 'working', windowMs: 5, pollMs: 1 });
  const r = await interruptThenConfirm(d);
  ck('accepted alone stays unconfirmed', r.verdict === 'unconfirmed', r);
  ck('unconfirmed carries no fake success flag', !('confirmed' in r) || (r as { confirmed?: boolean }).confirmed !== true);
}

// ── 控制消息发不出去 ⇒ failed；老 Hub ⇒ unsupported ───────────────────────
{
  const { d } = deps({ interrupt: async () => ({ ok: false, error: 'HTTP 500' }) });
  ck('send failure is failed', (await interruptThenConfirm(d)).verdict === 'failed');
  const { d: d2 } = deps({ interrupt: async () => ({ ok: false, unsupported: true, error: 'old hub' }) });
  const r2 = await interruptThenConfirm(d2);
  ck('old hub is unsupported, not failed', r2.verdict === 'unsupported' && r2.detail === 'old hub');
}

// ── 慢退出 runtime（如 antigravity-acp）：+3s 回执 interrupted:true，+12s 才翻 idle ──
{
  let clock = 1000;
  let ackNotices = 0;
  const r = await interruptThenConfirm({
    interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true, control: 'interrupt' } }),
    readStatus: async () => (clock >= 13_000 ? 'idle' : 'working'),
    readTaskSettled: async () => false,
    readReplyProof: async () => clock >= 4000,
    onReplyAcked: () => { ackNotices += 1; },
    sleep: async ms => { clock += ms; },
    now: () => clock,
    windowMs: 8000,
    graceWindowMs: 20_000,
    pollMs: 1000,
  });
  ck('slow runtime (+3s reply ack, +12s idle flip) confirms instead of timing out at 8s', r.verdict === 'confirmed', { r, clock });
  ck('waits for idle teardown after +3s ack instead of sending prematurely', clock === 13_000, { clock });
  ck('notifies onReplyAcked exactly once when reply proof arrives', ackNotices === 1, { ackNotices });
}

// ── 收到节点 interrupted:true 后即使宽限期结束仍未见 idle（如队列秒接下一条），不丢发送 ──
{
  let clock = 0;
  const r = await interruptThenConfirm({
    interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true } }),
    readStatus: async () => 'working',
    readTaskSettled: async () => false,
    readReplyProof: async () => clock >= 3000,
    sleep: async ms => { clock += ms; },
    now: () => clock,
    windowMs: 8000,
    graceWindowMs: 20_000,
    pollMs: 1000,
  });
  ck('explicit node interrupted:true still confirms after grace window instead of dropping draft', r.verdict === 'confirmed' && clock >= 23_000, { r, clock });
}

// ── 队列下一条秒接导致 status 一直 working，但基线任务已落终态 ⇒ 立即 confirmed ──
{
  let clock = 0;
  const r = await interruptThenConfirm({
    interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true } }),
    readStatus: async () => 'working',
    readTaskSettled: async () => clock >= 2000,
    readReplyProof: async () => false,
    sleep: async ms => { clock += ms; },
    now: () => clock,
    windowMs: 8000,
    graceWindowMs: 20_000,
    pollMs: 1000,
  });
  ck('baseline task settlement confirms interrupt-and-send immediately even while status stays working', r.verdict === 'confirmed' && clock === 2000, { r, clock });
}

// ── 没有任何回执且一直 working ⇒ 8s 窗口到点即停，不空等 20s 宽限期 ──────────
{
  let clock = 0;
  const r = await interruptThenConfirm({
    interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true } }),
    readStatus: async () => 'working',
    readTaskSettled: async () => false,
    readReplyProof: async () => false,
    sleep: async ms => { clock += ms; },
    now: () => clock,
    windowMs: 8000,
    graceWindowMs: 20_000,
    pollMs: 1000,
  });
  ck('no proof at all stays unconfirmed promptly at windowMs (never burns grace window)', r.verdict === 'unconfirmed' && clock === 9000, { r, clock });
}

// ── 点击时 status 仍滞后在 idle：先观察到 working 再翻 idle，或拿到回执且已 idle ⇒ confirmed ──
{
  let clock = 0;
  const r1 = await interruptThenConfirm({
    interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true } }),
    readStatus: async () => (clock === 0 ? 'idle' : clock < 3000 ? 'working' : 'idle'),
    sleep: async ms => { clock += ms; },
    now: () => clock,
    windowMs: 8000,
    pollMs: 1000,
  });
  ck('stale pre-click idle upgrades baseline when working is seen and confirms on flip back to idle', r1.verdict === 'confirmed' && clock === 3000, { r1, clock });

  clock = 0;
  const r2 = await interruptThenConfirm({
    interrupt: async () => ({ ok: true, payload: { ok: true, accepted: true } }),
    readStatus: async () => 'idle',
    readReplyProof: async () => clock >= 2000,
    sleep: async ms => { clock += ms; },
    now: () => clock,
    windowMs: 8000,
    graceWindowMs: 20_000,
    pollMs: 1000,
  });
  ck('node reply proof while status is already idle confirms immediately without burning grace window', r2.verdict === 'confirmed' && clock === 2000, { r2, clock });
}

// ── 接线守卫：发送路径必须「先打断再发」，且复用同一套判据 ─────────────────
{
  const screen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  const steer = readFileSync(new URL('./turn-steer.ts', import.meta.url), 'utf8');
  ck('composer only interrupts when the explicit action asked for it',
    screen.includes("opts?.interruptFirst === true && shouldInterruptBeforeSend(turnStatus)") && screen.includes('interruptThenConfirm({'));
  ck('plain send never calls interruptThenConfirm on its own',
    /if \(shouldInterruptBeforeSend\((?:sessionStatus|turnStatus)\)\) \{/.test(screen) === false);
  ck('the explicit action exists next to send (both layouts)',
    (screen.match(/testID="composer-interrupt-send"/g) ?? []).length === 2 && screen.includes("submit({ interruptFirst: true })"));
  // 契约守护（#518）：普通发送永远是 1 个请求、不打断 —— 与 idle 与否无关。
  ck('plain send keeps the one-request contract (interrupt needs the explicit opt-in)',
    screen.includes("opts?.interruptFirst === true && shouldInterruptBeforeSend(turnStatus)")
    && /if \(shouldInterruptBeforeSend\((?:sessionStatus|turnStatus)\)\) \{/.test(screen) === false);
  // 空闲时两条路都不打断：按钮只在在飞时渲染，submit 的打断分支也要在飞才成立。
  ck('idle shows no interrupt action and never interrupts',
    (screen.match(/\{turnCaps\.interrupt && interruptable\(turnStatus\) \? \(/g) ?? []).length === 2
    && !shouldInterruptBeforeSend('idle'));
  ck('no send when the interrupt is unconfirmed',
    /verdict !== 'confirmed'[\s\S]{0,400}return;/.test(screen));
  ck('interrupt-and-send wires reply proof, task settlement, grace window, and double-tap guard',
    screen.includes('readReplyProof:') && screen.includes('readTaskSettled:')
    && screen.includes('graceWindowMs: INTERRUPT_EXIT_GRACE_MS')
    && screen.includes('interruptSendBusyRef.current'));
  // #4592 自审：确认停下后不要本地乐观把会话状态写成 idle —— 新指令马上又会是 working，会闪。
  ck('confirm does not optimistically rewrite session status', !/setSessionStatus\('idle'\)/.test(screen));
  ck('reuses the #4591 proof helpers instead of a second copy',
    steer.includes("from './turn-interrupt'") && steer.includes('ackProvesInterrupted') && steer.includes('statusFlipProvesInterrupted'));
  // #4685 自审：插话回执可能落在两种形状（节点另发一条 / 挂在我们那条的 result 上），
  // 少认一种就会表现为「永远未确认」——这是比「假成功」更难发现的失败。
  ck('inject ack watcher accepts a node-sent row', /row\.from_name === alias/.test(screen));
  ck('inject ack watcher accepts an ack carried in result (with [alias] prefix)',
    /\/steer\\s\*\\\{\/\.test\(row\.result/.test(screen));
  // #4685：点「插话」时如果回合已结束，不能悄悄落成普通发送 —— 那和「说了没反应」一样糟。
  // #4685：插话要等回执，连点会真的发两条 steer；用同步 ref 挡住。
  ck('inject is guarded against double taps',
    /injectBusyRef\.current\) return;/.test(screen) && /finally \{[\s\S]{0,80}injectBusyRef\.current = false/.test(screen));
  ck('inject never silently degrades to a normal send',
    /opts\?\.inject === true && \(!turnCaps\.steer \|\| !canSteer\(turnStatus\)\)[\s\S]{0,200}return;/.test(screen));
  ck('inject ack watcher does not treat user content as an ack', !/row\.content/.test(screen.split('readRecent')[1]?.slice(0, 400) ?? ''));
  ck('user-facing copy avoids the word steer', !/插话|steer/i.test(readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8').split('chat.steer.')[1]?.slice(0, 400) ?? ''));
}

console.log(`turn-steer: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
