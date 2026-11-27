// #5675 PR-1 —— 聊天密钥卡片保存后自动生效逻辑单测（无自锁、空闲自动排队重启、重启后才发唤醒）。
import {
  __resetChatSecretSavedMemoryForTest,
  chatSecretApplyText,
  isChatSecretSavedLocally,
  markChatSecretSavedLocally,
  runChatSecretAutoApply,
  type ChatSecretApplyState,
} from './chat-secret-auto-apply';
import type { NodeLifecycleResult } from './api';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

async function run() {
  // 1. Copy checks
  ck('applying 文案明确自动生效', chatSecretApplyText('applying') === '保存好了，节点空闲时自动生效');
  ck('waiting_idle 文案明确空闲后自动生效', chatSecretApplyText('waiting_idle') === '节点正在干活，做完这件事后自动生效');
  ck('manual 文案包含手动命令', chatSecretApplyText('manual', '小苹果视频号鸽').includes('anet node start 小苹果视频号鸽'));

  // 2. Idle node: immediate restart, wake message fires ONLY AFTER restart completes
  {
    const states: ChatSecretApplyState[] = [];
    const order: string[] = [];
    const ctrl = new AbortController();
    const res = await runChatSecretAutoApply({
      signal: ctrl.signal,
      pollMs: 0,
      restartSettleMs: 0,
      onlinePollMs: 0,
      onState: s => { states.push(s); order.push(`state:${s}`); },
      restartNode: async () => { order.push('restart'); return { ok: true }; },
      readNodeStatus: async () => { order.push('status'); return { status: 'idle', inFlightCount: 0 }; },
      onApplied: () => { order.push('wake'); },
    });
    ck('空闲节点立即自动重启并生效', res === 'applied' && JSON.stringify(states) === JSON.stringify(['applying', 'restarting', 'applied']), states);
    ck('唤醒消息严格在 restart_node 成功后才发（杜绝自锁）', order.indexOf('restart') < order.indexOf('wake') && order.indexOf('state:applied') < order.indexOf('wake'), order);
  }

  // 3. Busy node: waits while working, retries restart automatically once idle, zero second click
  {
    const states: ChatSecretApplyState[] = [];
    let restartCalls = 0;
    let statusCalls = 0;
    let woke = 0;
    const ctrl = new AbortController();
    const res = await runChatSecretAutoApply({
      signal: ctrl.signal,
      pollMs: 0,
      restartSettleMs: 0,
      onlinePollMs: 0,
      maxBusyPolls: 10,
      onState: s => states.push(s),
      restartNode: async (): Promise<NodeLifecycleResult> => {
        restartCalls++;
        if (restartCalls === 1) return { ok: false, error: 'node_busy_in_flight', in_flight_count: 1 };
        return { ok: true };
      },
      readNodeStatus: async () => {
        statusCalls++;
        // First two polls: still working; third poll: idle!
        if (statusCalls <= 2) return { status: 'working', inFlightCount: 1 };
        return { status: 'idle', inFlightCount: 0 };
      },
      onApplied: () => { woke++; },
    });
    ck('忙节点进入 waiting_idle，空闲后自动补发重启并生效', res === 'applied' && JSON.stringify(states) === JSON.stringify(['applying', 'waiting_idle', 'restarting', 'applied']), states);
    ck('工作期间不盲目重发 restart_node，空闲后仅补发 1 次', restartCalls === 2 && statusCalls >= 3 && woke === 1, { restartCalls, statusCalls, woke });
  }

  // 4. Busy node still busy on retry (race condition), then succeeds on next cycle
  {
    let restartCalls = 0;
    let woke = 0;
    const ctrl = new AbortController();
    const res = await runChatSecretAutoApply({
      signal: ctrl.signal,
      pollMs: 0,
      restartSettleMs: 0,
      onlinePollMs: 0,
      maxBusyPolls: 10,
      onState: () => {},
      restartNode: async (): Promise<NodeLifecycleResult> => {
        restartCalls++;
        if (restartCalls <= 2) return { ok: false, error: 'node_busy_in_flight', in_flight_count: 1 };
        return { ok: true };
      },
      readNodeStatus: async () => ({ status: 'idle', inFlightCount: 0 }),
      onApplied: () => { woke++; },
    });
    ck('补发遇并发 busy 继续排队直至成功', res === 'applied' && restartCalls === 3 && woke === 1, { restartCalls, woke });
  }

  // 5. Manual/unmanaged node: falls back cleanly to manual, does NOT wake AI prematurely
  {
    const states: ChatSecretApplyState[] = [];
    let woke = 0;
    const ctrl = new AbortController();
    const res = await runChatSecretAutoApply({
      signal: ctrl.signal,
      pollMs: 0,
      onState: s => states.push(s),
      restartNode: async () => ({ ok: false, error: 'adopted_restart_requires_daemon' }),
      readNodeStatus: async () => ({ status: 'idle', inFlightCount: 0 }),
      onApplied: () => { woke++; },
    });
    ck('不支持远程重启的节点退回 manual 且不提前发唤醒消息', res === 'manual' && JSON.stringify(states) === JSON.stringify(['applying', 'manual']) && woke === 0, { res, states, woke });
  }

  // 6. Abort during waiting_idle exits cleanly without stray restart or wake
  {
    let restartCalls = 0;
    let woke = 0;
    const ctrl = new AbortController();
    const promise = runChatSecretAutoApply({
      signal: ctrl.signal,
      pollMs: 50,
      onState: s => { if (s === 'waiting_idle') ctrl.abort(); },
      restartNode: async () => { restartCalls++; return { ok: false, error: 'node_busy_in_flight' }; },
      readNodeStatus: async () => ({ status: 'working', inFlightCount: 1 }),
      onApplied: () => { woke++; },
    });
    const res = await promise;
    ck('卸载/中止时立即停止等待且不发多余调用', res === 'aborted' && restartCalls === 1 && woke === 0, { res, restartCalls, woke });
  }

  // 7. In-memory saved tracker isolates per scope/node/key
  {
    __resetChatSecretSavedMemoryForTest();
    ck('初始未标记本地已保存', !isChatSecretSavedLocally('hub|net', 'n1', 'DASHSCOPE_API_KEY'));
    markChatSecretSavedLocally('hub|net', 'n1', 'DASHSCOPE_API_KEY');
    ck('保存后同节点同键记住已保存、不同键不串台', isChatSecretSavedLocally('hub|net', 'n1', 'DASHSCOPE_API_KEY') && !isChatSecretSavedLocally('hub|net', 'n1', 'OTHER_KEY'));
    __resetChatSecretSavedMemoryForTest();
  }

  console.log(`chat-secret-auto-apply: ${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
}

void run();
