// #518 发一条消息每一段花了多久。纯模块(不 import react-native),正式包里照样工作。
//
// 为什么要它:owner 2026-10-03「为什么现在发消息都需要发那么久?」—— hub 上 POST /api/task 只要 1–40 ms,
// 而 (hub 落库时间 − dreq id 里的客户端时间) 当晚 9–12 s。这个差可能是 app 里排队/等身份查询,也可能只是
// 这台电脑的钟慢了 10 s —— 只看 hub 数据库分不出来。这里把客户端每一段的真实耗时记下来,外加一个和钟无关的
// 读数(clock_offset_ms = 服务器 Date 头 − 本机时间,按请求往返的中点算),两件事一眼分开。
//
// 读法(devtools / adb logcat / Xcode 控制台里 grep `[anet-chat] send_timing`):
//   since_dreq_ms   从点「发送」(生成 dreq id)到真正开始发这个请求(含上传附件)
//   identity_ms     发之前等身份查询(/api/auth/me)的时间;identity=cfg|cache 时恒为 0
//   headers_ms      POST 发出到响应头
//   body_ms         响应头到读完响应体
//   total_ms        sendTask 从进入到返回/抛错
//   clock_offset_ms 服务器钟 − 本机钟(±1 s,Date 头只有秒);|值| 大 ⇒ hub 上算出来的「延迟」其实是钟差
//   inflight        发送开始时这个窗口里还在路上的请求数;req_60s 最近 60 s 发出的请求数(被别的请求淹没?)
// 设置 → 通知 →「诊断」里「最近一次发送」显示同一份。

export type SendTiming = {
  at: number;
  requestId: string;
  identity: 'cfg' | 'cache' | 'lookup' | 'background';
  sinceDreqMs: number | null;
  identityMs: number;
  headersMs: number | null;
  bodyMs: number | null;
  totalMs: number;
  outcome: 'ok' | 'error' | 'timeout';
  status: number | null;
  clockOffsetMs: number | null;
  /** 发送开始时这个窗口里在路上的请求数 / 最近 60 s 发出的请求数(app-fetch.ts appFetchLoad)。 */
  inflightAtSend?: number;
  requestsLastMinute?: number;
  error?: string;
  /** ChatScreen 把气泡改成「已送达 / 未送达」时补上:从 dreq 生成到气泡变色。 */
  bubble?: { state: 'sent' | 'failed'; sinceDreqMs: number | null };
};

const LIMIT = 20;
let recent: SendTiming[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) { try { l(); } catch { /* 诊断不能打断发送 */ } } };

/** dreq_<12 hex ms><13 hex random><7 hex seq> → 生成时的本机毫秒;别的形状 → null。 */
export function dreqCreatedAt(requestId: string): number | null {
  const m = /^dreq_([a-f0-9]{12})[a-f0-9]{20}$/.exec(requestId);
  if (!m) return null;
  const ms = parseInt(m[1], 16);
  return Number.isFinite(ms) ? ms : null;
}

/** 服务器 Date 头 − 请求往返中点的本机时间。没有 Date 头 → null。 */
export function clockOffsetFrom(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): number | null {
  if (!dateHeader) return null;
  const server = Date.parse(dateHeader);
  if (!Number.isFinite(server)) return null;
  return Math.round(server - (sentAt + receivedAt) / 2);
}

export function formatSendTiming(t: SendTiming): string {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '-' : String(Math.round(v)));
  const parts = [
    `[anet-chat] send_timing req=${t.requestId}`,
    `outcome=${t.outcome}`,
    `status=${t.status ?? '-'}`,
    `identity=${t.identity}`,
    `since_dreq_ms=${n(t.sinceDreqMs)}`,
    `identity_ms=${n(t.identityMs)}`,
    `headers_ms=${n(t.headersMs)}`,
    `body_ms=${n(t.bodyMs)}`,
    `total_ms=${n(t.totalMs)}`,
    `clock_offset_ms=${n(t.clockOffsetMs)}`,
    `inflight=${n(t.inflightAtSend)}`,
    `req_60s=${n(t.requestsLastMinute)}`,
  ];
  if (t.bubble) parts.push(`bubble=${t.bubble.state}`, `bubble_since_dreq_ms=${n(t.bubble.sinceDreqMs)}`);
  if (t.error) parts.push(`error=${JSON.stringify(t.error.slice(0, 160))}`);
  return parts.join(' ');
}

export function recordSendTiming(t: SendTiming): void {
  recent = [t, ...recent.filter(r => r.requestId !== t.requestId || r.at !== t.at)].slice(0, LIMIT);
  try { console.info(formatSendTiming(t)); } catch { /* 没有 console */ }
  emit();
}

/** 气泡状态落定(已送达 / 未送达)时调用;同一 requestId 最近那条补上 bubble 字段并再打一行。 */
export function recordSendBubble(requestId: string, state: 'sent' | 'failed', now = Date.now()): void {
  const created = dreqCreatedAt(requestId);
  const bubble = { state, sinceDreqMs: created === null ? null : now - created };
  const i = recent.findIndex(r => r.requestId === requestId);
  if (i >= 0) {
    recent = recent.map((r, j) => (j === i ? { ...r, bubble } : r));
    try { console.info(formatSendTiming(recent[i])); } catch { /* 没有 console */ }
  } else {
    try { console.info(`[anet-chat] send_bubble req=${requestId} bubble=${state} bubble_since_dreq_ms=${bubble.sinceDreqMs ?? '-'}`); } catch { /* 没有 console */ }
  }
  emit();
}

export function recentSendTimings(): SendTiming[] { return recent; }
export function subscribeSendTimings(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
/** Test-only. */
export function __resetSendTimingsForTest(): void { recent = []; }

/** 诊断面板的一行(标签, 值, 是否告警)。 */
export function sendTimingRow(t: SendTiming | undefined): { label: string; value: string; warn: boolean } | null {
  if (!t) return null;
  const s = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
  const head = t.outcome === 'ok' ? `成功 HTTP ${t.status ?? '?'}` : t.outcome === 'timeout' ? '超时' : `失败${t.status ? ` HTTP ${t.status}` : ''}`;
  const skew = t.clockOffsetMs !== null && Math.abs(t.clockOffsetMs) >= 2000 ? ` · ⚠ 本机时钟与服务器差 ${s(Math.abs(t.clockOffsetMs))}` : '';
  const bubble = t.bubble ? ` · 气泡${t.bubble.state === 'sent' ? '已送达' : '未送达'}于 ${s(t.bubble.sinceDreqMs)}` : '';
  const load = t.inflightAtSend === undefined ? '' : ` · 当时在途请求 ${t.inflightAtSend} 个 / 近 1 分钟 ${t.requestsLastMinute ?? '?'} 个`;
  const value = `${head} · 点发送→开始发 ${s(t.sinceDreqMs)} · 身份(${t.identity}) ${s(t.identityMs)} · 响应头 ${s(t.headersMs)} · 响应体 ${s(t.bodyMs)} · 合计 ${s(t.totalMs)}${bubble}${load}${skew}`;
  return { label: '最近一次发送', value, warn: t.outcome !== 'ok' || t.totalMs > 3000 || !!skew };
}
