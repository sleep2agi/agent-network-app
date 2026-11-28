// #4591 —— 聊天页「停止」按钮的四态（运行中 / 空闲 / 超时未确认 / 失败）+ 真凭据判据。
//   run: bun src/turn-interrupt.test.ts
//
// 判据说清楚：Hub 回 accepted 只代表控制消息进 inbox，不是「这一轮被截断」；
// 真凭据只有两种 —— 节点回执里 interrupted=true，或会话状态真的从「在飞」翻走。
import { readFileSync } from 'node:fs';
import {
  INTERRUPT_CLEAR_MS,
  INTERRUPT_CONFIRM_MS,
  INTERRUPT_EXIT_GRACE_MS,
  INTERRUPT_POLL_MS,
  LATE_EVIDENCE_MS,
  POST_STOP_SUPPRESS_MS,
  ackProvesInterrupted,
  activeInterruptTaskId,
  effectiveTurnStatus,
  hasActiveInboundTurn,
  hasFreshInterruptReply,
  idleInterrupt,
  interruptAfterSend,
  interruptable,
  isStopSuppressed,
  replyProvesInterrupted,
  statusFlipProvesInterrupted,
  stopButtonPresentation,
  taskSettledProvesInterrupted,
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
  ck('composer wires the stop button with the effective turn status gate',
    screen.includes('enabled={interruptable(turnStatus)}') && screen.includes('<ComposerStopButton') && screen.includes('effectiveTurnStatus('));
  ck('composer waits for node proof instead of trusting accepted',
    screen.includes('ackProvesInterrupted(res.payload)') && screen.includes('hasFreshInterruptReply('));
  // 「未确认」不是终局：unconfirmed 之后仍要听迟到真凭据（回执 / 状态翻转）。
  // 这两条守的是 UI 层的 effect 条件 —— 把条件收回成 `!== 'waiting'` 时行为会退化，但纯函数测试仍全绿。
  ck('still listens for node proof after unconfirmed',
    screen.includes("interrupt.phase !== 'waiting' && interrupt.phase !== 'unconfirmed'"));
  ck('status flip also counts while unconfirmed (bounded by LATE_EVIDENCE_MS)',
    /interrupt\.phase === 'unconfirmed' && lateEvidenceAllowed\(\)/.test(screen));
  // 真机 chuqi 报的「明明停了却显示未确认」：状态在工具回执回来前就翻 idle，
  // 如果拿「上一拍」比，这一拍会被吃掉；必须跟点击那一刻的 baseline 比。
  ck('status flip is compared against the click-time baseline, not the previous tick',
    screen.includes('interruptBaselineRef') && !screen.includes('prevSessionStatusRef.current = sessionStatus'));
  ck('baseline is captured at click time', /interruptBaselineRef\.current = sessionStatus/.test(screen));
  // 切节点必须清掉上一次的「未确认」提示与会话级状态。
  ck('switching conversations resets interrupt state, post-stop suppression, and notice',
    /setPostStopSuppress\(null\)[\s\S]{0,250}setInterrupt\(idleInterrupt\(\)\)[\s\S]{0,120}setComposerNotice\(null\)[\s\S]{0,300}\[cfg, alias\]\)/.test(screen));
  ck('late evidence has an upper bound so a natural turn end cannot be misread as a stop',
    screen.includes('lateEvidenceAllowed') && screen.includes('LATE_EVIDENCE_MS'));
  ck('fast confirmation poll runs on INTERRUPT_POLL_MS instead of waiting 30s',
    INTERRUPT_POLL_MS === 1500 && screen.includes('INTERRUPT_POLL_MS'));
  ck('confirmed stop auto-clears back to idle after INTERRUPT_CLEAR_MS',
    INTERRUPT_CLEAR_MS > 0 && screen.includes('INTERRUPT_CLEAR_MS'));
  ck('active running task settlement counts as proof even if a queued next task keeps status=working',
    screen.includes('activeInterruptTaskId(messages, alias)') && screen.includes('taskSettledProvesInterrupted('));
  ck('active turn task transitions trigger immediate light status sync without waiting 30s',
    screen.includes('hasActiveInboundTurn(messages, alias)') && screen.includes('refreshSessionStatus'));
  ck('post-stop stale working status is suppressed and synced to prevent button rebound',
    screen.includes('isStopSuppressed(postStopSuppress') && screen.includes('POST_STOP_SUPPRESS_MS'));
  ck('mobile turn controls render in their own composer-turn-row without squashing the model pill',
    screen.includes('testID="composer-turn-row"') && !screen.slice(screen.indexOf('testID="composer-model-row"'), screen.indexOf('testID="composer-turn-row"')).includes('ComposerStopButton'));
  ck('unconfirmed/failed detail moves into composerNotice instead of bloating the stop button',
    screen.includes("setComposerNotice(t('chat.interrupt.unconfirmed'))"));
  const btn = readFileSync(new URL('./ComposerStopButton.tsx', import.meta.url), 'utf8');
  ck('stop button renders a compact pill via stopButtonPresentation (never verbose unconfirmed text in label)',
    btn.includes('stopButtonPresentation(state.phase)') && btn.includes('borderRadius: radius.pill'));
}

// ── 按钮紧凑展示 + 活跃任务终态凭据 ────────────────────────────────────────
{
  ck('idle stop button shows compact danger stop pill', stopButtonPresentation('idle').labelKey === 'chat.interrupt.button' && stopButtonPresentation('idle').tone === 'danger');
  ck('sending/waiting show compact spinner pill', stopButtonPresentation('sending').kind === 'spinner' && stopButtonPresentation('waiting').labelKey === 'chat.interrupt.stopping');
  ck('unconfirmed/failed stay compact retry pill (not verbose essay)', stopButtonPresentation('unconfirmed').labelKey === 'chat.interrupt.retryShort' && stopButtonPresentation('failed').labelKey === 'chat.interrupt.retryShort');
  ck('interrupted shows compact success check pill', stopButtonPresentation('interrupted').tone === 'success' && stopButtonPresentation('interrupted').kind === 'check');

  const queued = [
    { task_id: 't_next', status: 'delivered' },
    { task_id: 't_curr', status: 'running' },
    { task_id: 't_old', status: 'replied' },
  ];
  ck('activeInterruptTaskId prefers the currently running task over queued ones', activeInterruptTaskId(queued) === 't_curr');
  ck('activeInterruptTaskId falls back to newest open task when none marked running yet', activeInterruptTaskId([{ task_id: 't_d', status: 'delivered' }]) === 't_d');
  ck('activeInterruptTaskId ignores outgoing tasks sent by this alias to others',
    activeInterruptTaskId([{ task_id: 't_out', status: 'running', from_name: 'A', to_name: 'B' }], 'A') === '');
  ck('taskSettledProvesInterrupted stays false while baseline task is still running', !taskSettledProvesInterrupted('t_curr', queued));
  ck('taskSettledProvesInterrupted turns true when baseline task settles even if next task starts running',
    taskSettledProvesInterrupted('t_curr', [{ task_id: 't_next', status: 'running' }, { task_id: 't_curr', status: 'replied' }]));
  ck('empty baseline task id proves nothing', !taskSettledProvesInterrupted('', [{ task_id: 't_curr', status: 'replied' }]));
}

// ── 状态同步（不等 30s 轮询）+ 停止确认后防回弹 + 新鲜回执校验 ─────────────
{
  const now = Date.parse('2026-11-28T12:00:00Z');
  const recent = '2026-11-28 11:59:30';
  const stale = '2026-11-28 11:40:00';
  ck('hasActiveInboundTurn detects running task (even before consumed_at, e.g. antigravity-acp)',
    hasActiveInboundTurn([{ task_id: 't1', status: 'running', runtime_submitted_at: recent, created_at: recent, to_name: 'A' }], 'A', now));
  ck('hasActiveInboundTurn detects consumed task',
    hasActiveInboundTurn([{ task_id: 't2', status: 'acked', consumed_at: recent, created_at: recent, to_name: 'A' }], 'A', now));
  ck('hasActiveInboundTurn ignores plain delivered task without runtime evidence',
    !hasActiveInboundTurn([{ task_id: 't3', status: 'delivered', created_at: recent, to_name: 'A' }], 'A', now));
  ck('hasActiveInboundTurn ignores terminal or answered tasks',
    !hasActiveInboundTurn([{ task_id: 't4', status: 'running', result: 'done', created_at: recent, to_name: 'A' }], 'A', now)
    && !hasActiveInboundTurn([{ task_id: 't5', status: 'cancelled', runtime_submitted_at: recent, created_at: recent, to_name: 'A' }], 'A', now));
  ck('hasActiveInboundTurn ignores stale tasks beyond 10min guard',
    !hasActiveInboundTurn([{ task_id: 't6', status: 'running', created_at: stale, to_name: 'A' }], 'A', now));
  ck('hasActiveInboundTurn ignores outgoing tasks from this alias to another agent',
    !hasActiveInboundTurn([{ task_id: 't7', status: 'running', created_at: recent, from_name: 'A', to_name: 'B' }], 'A', now));
  ck('hasActiveInboundTurn ignores local optimistic echo',
    !hasActiveInboundTurn([{ _localId: 'dreq_1', status: 'running', created_at: recent }], 'A', now));

  ck('effectiveTurnStatus elevates stale idle to working when active inbound task is running',
    effectiveTurnStatus({ sessionStatus: 'idle', hasActiveTurnTask: true, suppressedAfterStop: false }) === 'working');
  ck('effectiveTurnStatus never elevates offline node',
    effectiveTurnStatus({ sessionStatus: 'offline', hasActiveTurnTask: true, suppressedAfterStop: false }) === 'offline');
  ck('effectiveTurnStatus suppresses stale working after confirmed stop',
    effectiveTurnStatus({ sessionStatus: 'working', hasActiveTurnTask: false, suppressedAfterStop: true }) === 'idle');

  const sup = { at: now, baselineTaskId: 't_curr' };
  ck('isStopSuppressed holds while stale working persists and baseline task cleared',
    isStopSuppressed(sup, { sessionStatus: 'working', activeTaskId: '', now: now + 2200 }));
  ck('isStopSuppressed holds while same baseline task has not refreshed out of messages yet',
    isStopSuppressed(sup, { sessionStatus: 'working', activeTaskId: 't_curr', now: now + 2200 }));
  ck('isStopSuppressed lifts immediately when a new task starts running',
    !isStopSuppressed(sup, { sessionStatus: 'working', activeTaskId: 't_next', now: now + 2200 }));
  ck('isStopSuppressed lifts once sessionStatus flips to idle',
    !isStopSuppressed(sup, { sessionStatus: 'idle', activeTaskId: '', now: now + 2200 }));
  ck('isStopSuppressed expires after POST_STOP_SUPPRESS_MS',
    POST_STOP_SUPPRESS_MS >= 10_000 && !isStopSuppressed(sup, { sessionStatus: 'working', activeTaskId: '', now: now + POST_STOP_SUPPRESS_MS + 1 }));
  ck('exit grace window covers slow antigravity-acp teardown (9-16s)', INTERRUPT_EXIT_GRACE_MS >= 20_000);

  const idOf = (m: { task_id?: string | null; created_at?: string | null; content?: string | null }) => `${m.task_id ?? ''}|${m.created_at ?? ''}|${m.content ?? ''}`;
  const seen = new Set<string>(['dm_old|2026-11-28 11:59:59|']);
  ck('hasFreshInterruptReply accepts unseen post-click interrupt ack',
    hasFreshInterruptReply([{ task_id: 'dm_new', created_at: '2026-11-28 12:00:03', result: '[主苹果测试鸽] interrupt {"ok":true,"interrupted":true}' }], seen, idOf, now));
  ck('hasFreshInterruptReply ignores already-seen ack',
    !hasFreshInterruptReply([{ task_id: 'dm_old', created_at: '2026-11-28 11:59:59', result: '[主苹果测试鸽] interrupt {"ok":true,"interrupted":true}' }], seen, idOf, now));
  ck('hasFreshInterruptReply rejects old historical interrupt ack even if unseen',
    !hasFreshInterruptReply([{ task_id: 'dm_ancient', created_at: '2026-11-28 11:00:00', result: '[主苹果测试鸽] interrupt {"ok":true,"interrupted":true}' }], seen, idOf, now));
}

console.log(`turn-interrupt: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
