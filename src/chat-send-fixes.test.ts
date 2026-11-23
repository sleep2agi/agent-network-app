// 2026-11-23 安卓「未送达」P0 修复测试（覆盖 1 / 2 / 3 项；第 4 项对账竞态见 send-reconcile-race.test.ts）：
//   1. retry() 保留所有服务器历史消息，不再被 mergeMessagesNewestFirst(..., []) 清空；
//      ChatScreen 主 FlatList 启用 keyboardShouldPersistTaps="handled"（首点不再只收键盘）；
//   2. 失败原因说人话：超时/断网、409 target_never_consumes / node_degraded / node_not_active / node_stopped、
//      401（触发 reportProfileAuthResponse 重新登录提示）；409/401 不显示「点击重试」，outbox 持久化 failReason；
//   3. 超时/丢 ACK 后台自动退避重发（复用同一个 client_request_id），显式 HTTP 409/503 不自动重发。
import { readFileSync } from 'node:fs';
import { __setSendBoundsForTest, createDashboardRequestId, forgetSendIdentity, sendTask, type HubConfig } from './api';
import { mergeMessagesNewestFirst } from './chat-actions';
import { setLanguagePreference, t } from './i18n';
import './i18n-chat';
import { __resetOutboxForTest, initOutbox, outboxAdd, outboxEntry, outboxMarkFailed, outboxMarkPending, outboxSetFailReason } from './outbox';
import { clearProfileUnauthorized, onProfileUnauthorized, profileUnauthorizedReason } from './profile-auth-state';
import { runWithSendAutoRetry, SEND_AUTO_RETRY_DELAYS_MS } from './send-auto-retry';
import {
  isAutoRetryableSendError,
  isDefiniteSendRejection,
  isRetryableSendFailure,
  sendFailureReason,
  SendTaskError,
} from './send-failure-reason';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean, extra = '') => {
  total++;
  if (ok) {
    passed++;
    console.log(`PASS: ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    console.error(`FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
};

const chatSource = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// ── 1. retry() 保留服务器历史消息 + 主 FlatList keyboardShouldPersistTaps="handled" ──
{
  const localId = createDashboardRequestId();
  const prev = [
    { _localId: localId, content: '没发出去的消息', created_at: '2026-11-23T02:44:00.000Z', _failed: true, _failReason: 'timeout' as const },
    { task_id: 't_hist_2', content: '上一条历史', created_at: '2026-11-23T02:43:00.000Z' },
    { task_id: 't_hist_1', content: '更早历史', created_at: '2026-11-23T02:40:00.000Z' },
  ];
  const retriedAt = Date.parse('2026-11-23T02:45:00.000Z');
  const updated = prev.map(row => (row._localId === localId
    ? { ...row, created_at: new Date(retriedAt).toISOString(), _pending: true, _failed: false, _failReason: undefined, _uploadError: undefined }
    : row));
  const merged = mergeMessagesNewestFirst(updated.filter(row => row._localId), updated.filter(row => !row._localId));
  ck('retry merge keeps all server history rows alongside retried local echo',
    merged.length === 3
    && merged[0]._localId === localId
    && merged[0]._pending === true
    && merged[0]._failed === false
    && merged.some(m => m.task_id === 't_hist_2')
    && merged.some(m => m.task_id === 't_hist_1'));

  // 确认 ChatScreen.tsx 不再有 mergeMessagesNewestFirst(..., []) 的旧 bug
  const retryIdx = chatSource.indexOf('const retry = (item: ChatItem) => {');
  const retrySnippet = retryIdx >= 0 ? chatSource.slice(retryIdx, retryIdx + 1400) : '';
  ck('ChatScreen retry() splits local and remote rows instead of passing []',
    retrySnippet.includes('updated.filter(t => t._localId), updated.filter(t => !t._localId)')
    && !retrySnippet.includes('[]'));

  // 主消息列表 FlatList 必须配置 keyboardShouldPersistTaps="handled"
  const mainListIdx = chatSource.indexOf('ref={listRef}');
  const mainListSnippet = mainListIdx >= 0 ? chatSource.slice(mainListIdx, mainListIdx + 400) : '';
  ck('ChatScreen main FlatList sets keyboardShouldPersistTaps="handled"',
    mainListSnippet.includes('inverted') && mainListSnippet.includes('keyboardShouldPersistTaps="handled"'));
}

// ── 2. 失败原因分类、文案、409/401 不可重试、outbox 持久化 failReason、401 走重登 ──
{
  const e = (status: number | null, code?: string) => new SendTaskError('err', status, code);

  ck('timeout error -> timeout', sendFailureReason(new Error('Hub 12 秒内没有响应')) === 'timeout');
  ck('body deadline error -> timeout', sendFailureReason(new Error('Hub 15 秒内没有返回完整响应')) === 'timeout');
  ck('RN TypeError Network request failed -> timeout', sendFailureReason(new TypeError('Network request failed')) === 'timeout');
  ck('502/503/504 -> timeout',
    sendFailureReason(e(502)) === 'timeout'
    && sendFailureReason(e(503, 'hub restarting')) === 'timeout'
    && sendFailureReason(e(504)) === 'timeout');

  ck('409 target_never_consumes -> targetUnresponsive', sendFailureReason(e(409, 'target_never_consumes')) === 'targetUnresponsive');
  ck('409 node_degraded -> targetUnresponsive', sendFailureReason(e(409, 'node_degraded')) === 'targetUnresponsive');
  ck('409 node_not_active -> targetNotRunning', sendFailureReason(e(409, 'node_not_active')) === 'targetNotRunning');
  ck('409 node_stopped -> targetNotRunning', sendFailureReason(e(409, 'node_stopped')) === 'targetNotRunning');
  ck('401 -> unauthorized', sendFailureReason(e(401, 'token_expired')) === 'unauthorized' && sendFailureReason(e(401)) === 'unauthorized');

  ck('only unauthorized is NOT retryable (re-login first)', !isRetryableSendFailure('unauthorized'));
  ck('targetUnresponsive / targetNotRunning stay retryable (tap once the agent recovers, no retyping)',
    isRetryableSendFailure('targetUnresponsive') && isRetryableSendFailure('targetNotRunning'));
  ck('timeout / aliasNotFound / notGranted / network / attachment / undefined remain retryable',
    isRetryableSendFailure('timeout')
    && isRetryableSendFailure('aliasNotFound')
    && isRetryableSendFailure('notGranted')
    && isRetryableSendFailure('network')
    && isRetryableSendFailure('attachment')
    && isRetryableSendFailure(undefined));

  ck('4xx (except 408/429) are definite rejections; 5xx and network errors are ambiguous',
    isDefiniteSendRejection(e(409, 'target_never_consumes'))
    && isDefiniteSendRejection(e(401, 'token_expired'))
    && isDefiniteSendRejection(e(404, 'alias_not_found'))
    && !isDefiniteSendRejection(e(408))
    && !isDefiniteSendRejection(e(429, 'rate_limited'))
    && !isDefiniteSendRejection(e(503))
    && !isDefiniteSendRejection(new TypeError('Network request failed')));

  setLanguagePreference('zh');
  ck('zh copy: timeout tells user network is slow and to tap retry', t('chat.failReason.timeout').includes('重试'));
  ck('zh copy: targetUnresponsive says stuck', t('chat.failReason.targetUnresponsive').includes('卡住'));
  ck('zh copy: targetNotRunning says not running', t('chat.failReason.targetNotRunning').includes('没在运行'));
  ck('zh copy: stuck / not-running reasons tell the user when to retry',
    t('chat.failReason.targetUnresponsive').includes('恢复后再点重试') && t('chat.failReason.targetNotRunning').includes('启动后再点重试'));
  ck('auto-retry shows 「网络慢，正在重试…」 instead of a silent 发送中',
    t('chat.sendingRetry') === '网络慢，正在重试…'
    && chatSource.includes("t(item._retrying ? 'chat.sendingRetry' : 'chat.sending')")
    && /onRetry: \(\) => \{[\s\S]{0,200}?_retrying: true/.test(chatSource));
  ck('zh copy: unauthorized says sign in again', t('chat.failReason.unauthorized').includes('重新登录'));
  ck('zh copy: non-retryable header omits 点击重试', t('chat.notDeliveredNoRetry') === '未送达');

  // ChatScreen 对不可重试错误不渲染 Pressable 和「点击重试」
  ck('ChatScreen gates retry Pressable with isRetryableSendFailure(item._failReason)',
    chatSource.includes('isRetryableSendFailure(item._failReason) ? (')
    && chatSource.includes('testID="chat-not-delivered-permanent"')
    && chatSource.includes("t('chat.notDeliveredNoRetry')"));
  ck('ChatScreen retry() guards against non-retryable failure reasons',
    chatSource.includes('if (!isRetryableSendFailure(item._failReason)) return;'));

  // outbox 持久化 failReason，且 forEach(outboxMarkFailed) 不会把数组下标误存成 failReason
  __resetOutboxForTest();
  initOutbox(null, () => {});
  const idA = createDashboardRequestId();
  const idB = createDashboardRequestId();
  outboxAdd({ id: idA, alias: 'TMAI负责人', content: 'ping', createdAt: 1, state: 'pending' });
  outboxAdd({ id: idB, alias: 'TMAI负责人', content: 'orphan', createdAt: 2, state: 'pending' });
  outboxMarkFailed(idA);
  outboxSetFailReason(idA, 'targetUnresponsive');
  [idB].forEach(outboxMarkFailed);
  ck('outboxSetFailReason stores failReason and forEach(outboxMarkFailed) leaves reason clean',
    outboxEntry(idA)?.failReason === 'targetUnresponsive' && outboxEntry(idB)?.failReason === undefined);
  outboxMarkPending(idA, 3);
  ck('outboxMarkPending clears previous failReason', outboxEntry(idA)?.failReason === undefined);

  // 401 on POST /api/task triggers reportProfileAuthResponse -> onProfileUnauthorized
  const profileId = 'profile-401-send-test';
  clearProfileUnauthorized(profileId);
  let reportedProfile = '';
  let reportedReason: string | undefined;
  const off = onProfileUnauthorized((pid, reason) => { reportedProfile = pid; reportedReason = reason; });
  const originalFetch = globalThis.fetch;
  try {
    forgetSendIdentity();
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'token_expired' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_expired', networkId: 'net_1', username: 'admin', profileId };
    let caught: unknown = null;
    try { await sendTask(cfg, 'TMAI负责人', 'hi'); } catch (err) { caught = err; }
    ck('401 on sendTask triggers re-login prompt via profile-auth-state',
      caught instanceof SendTaskError
      && caught.status === 401
      && reportedProfile === profileId
      && reportedReason === 'token_expired'
      && profileUnauthorizedReason(profileId) === 'token_expired');
  } finally {
    globalThis.fetch = originalFetch;
    off();
    clearProfileUnauthorized(profileId);
  }
}

// ── 3. 超时/丢 ACK 后台自动退避重发（同一 client_request_id 幂等） ──
{
  // (a) 前 2 次超时，第 3 次成功，且每次复用同一个 client_request_id
  const originalFetch = globalThis.fetch;
  try {
    forgetSendIdentity();
    __setSendBoundsForTest({ headerMs: 120, totalMs: 240 });
    const reqIds: string[] = [];
    const sleeps: number[] = [];
    let attempt = 0;
    globalThis.fetch = (async (_input: any, init?: any) => {
      attempt++;
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      reqIds.push(parsed?.meta?.client_request_id);
      if (attempt <= 2) {
        throw new TypeError('Network request failed');
      }
      return new Response(JSON.stringify({ ok: true, task_id: 'idem_ok_after_retry', idempotent_replay: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_retry', networkId: 'net_1', username: 'admin' };
    const rid = createDashboardRequestId();
    const res = await runWithSendAutoRetry(
      () => sendTask(cfg, '示例-A', 'hello', undefined, 'normal', rid),
      { sleep: async ms => { sleeps.push(ms); } },
    );
    ck('auto-retry succeeds on 3rd attempt with same client_request_id and backoff delays',
      res.ok === true
      && res.task_id === 'idem_ok_after_retry'
      && reqIds.length === 3
      && reqIds.every(id => id === rid)
      && JSON.stringify(sleeps) === JSON.stringify([...SEND_AUTO_RETRY_DELAYS_MS]));
  } finally {
    globalThis.fetch = originalFetch;
    __setSendBoundsForTest();
  }

  // (b) 全部 3 次都超时 → 最终抛错（然后才进入标红）
  {
    let attempts = 0;
    const sleeps: number[] = [];
    let finalErr: unknown = null;
    try {
      await runWithSendAutoRetry(
        async () => { attempts++; throw new Error('Hub 12 秒内没有响应'); },
        { sleep: async ms => { sleeps.push(ms); } },
      );
    } catch (err) {
      finalErr = err;
    }
    ck('auto-retry exhausts 3 attempts (1 initial + 2 retries) then throws timeout',
      attempts === 3 && sleeps.length === 2 && sendFailureReason(finalErr) === 'timeout');
  }

  // (c) 409 target_never_consumes / 401 / 503 显式 HTTP 响应不走自动重发
  {
    let attempts409 = 0;
    try {
      await runWithSendAutoRetry(
        async () => { attempts409++; throw new SendTaskError('HTTP 409', 409, 'target_never_consumes'); },
        { sleep: async () => {} },
      );
    } catch { /* expected */ }
    let attempts503 = 0;
    try {
      await runWithSendAutoRetry(
        async () => { attempts503++; throw new SendTaskError('HTTP 503', 503, 'hub restarting'); },
        { sleep: async () => {} },
      );
    } catch { /* expected */ }
    ck('explicit HTTP errors (409 / 503) are not auto-retried',
      attempts409 === 1 && attempts503 === 1
      && !isAutoRetryableSendError(new SendTaskError('HTTP 409', 409, 'target_never_consumes'))
      && !isAutoRetryableSendError(new SendTaskError('HTTP 503', 503, 'hub restarting')));
  }

  // (d) 退避期间如果外部轮询已确认送达（shouldStop=true），立即停止重试
  {
    let attempts = 0;
    let confirmed = false;
    try {
      await runWithSendAutoRetry(
        async () => { attempts++; throw new TypeError('Network request failed'); },
        {
          sleep: async () => { confirmed = true; },
          shouldStop: () => confirmed,
        },
      );
    } catch { /* expected */ }
    ck('auto-retry stops early when shouldStop becomes true during backoff', attempts === 1);
  }

  ck('ChatScreen wraps sendTask in runWithSendAutoRetry',
    chatSource.includes('runWithSendAutoRetry(') && chatSource.includes('shouldStop: () => !outboxEntry(localId)'));
}

console.log(`\nchat-send-fixes: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
