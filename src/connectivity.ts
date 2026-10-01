// App 自身连接状态(全局横幅的数据源)。纯模块·可单测。
//
// 背景(通信龙 App战线①,2026-08-13):所有页面都靠 usePoll 静默轮询、错误全吞——
// 界面画出来了 ≠ 数据到了,用户分不清 live 还是陈旧缓存。此模块在 api.ts 的共享读
// 路径上记录每次请求结局,派生一个诚实的横幅状态。
//
// 🔴 诚实契约(通信龙 补充要求 1):`lastSuccessAt` 只在**成功**时更新——绝不拿
// "最后一次尝试"冒充"最后一次更新",否则横幅本身就成了另一个谎。失败只更新
// lastFailureAt。断言见 connectivity.test.ts(成功后连续失败,时间戳必须不动)。
//
// 覆盖面:api.ts 的 get() 共享助手 = 全部轮询读路径(status/nodes/scheduled/tasks/
// messages)。写路径(sendTask 等)不在此横幅口径内——横幅声明的是"数据新鲜度",
// 写失败有各自的显式 UI(如聊天的「未送达·点击重试」)。SSE(事件流页)也不在口径内。
//
// 🔴 两跳阈值(2026-08-24):原实现是"最近一次完成的读失败了就报",单次抖动被播报成
// "服务器挂了"。改成连续 2 次失败才报。
//
// 🔴 按「轮」计,且要持续一段时间(2026-09-29,Vincent 折叠屏 0.2.142 截图「无法连接
// 服务器 · 显示缓存数据（截至 12:15）」,截图时刻也是 12:15):两跳阈值数的是**请求**,
// 而 app 一轮会并发发出 4–6 个读(列表/消息/任务/通知的三路/头像)。手机链路一次卡顿
// (切后台回来、基站切换、跨太平洋 260ms RTT 上丢包)会让同一轮里的几个请求一起失败 →
// 计数瞬间到 2 → 横幅在上次成功的同一分钟里就出来了。现在:
//   - 彼此相隔 < FAILURE_ROUND_MS 的失败算同一轮(一次卡顿只算一次);
//   - 有缓存时,失败已持续 ≥ OFFLINE_AFTER_MS(中间没有任何一次成功,因此至少两轮)才说
//     「无法连接」;没到 10 秒的第 2 轮起说「连接较慢 · 正在重试」,第 1 轮不出横幅。
//     (试过「≥3 轮 且 ≥10 s」:任务页只有 15 s / 30 s 两路轮询,加上退避,真断连要 74 s 才报。)
//   - 最近 SLOW_AFTER_READS 次成功都慢于 SLOW_READ_MS → 「连接较慢」(数据是到了,只是慢,
//     这和「连不上」是两件事,用户该知道是哪一件);
//   - 任何一次成功立即回到在线,并广播一次「立即重试」让其他轮询马上刷新。
// 冷启动(从未成功过)仍然一次失败就报——那时屏幕上什么都没有,沉默比误报更糟。
// 阈值只影响"何时改口径",不影响诚实契约:lastSuccessAt 依旧只在成功时动。

let lastSuccessAt: number | null = null;
let lastFailureAt: number | null = null;
let consecutiveFailures = 0;
let failureRounds = 0;
let streakStartedAt: number | null = null;
let roundStartedAt: number | null = null;
let recentReadMs: number[] = [];
/** 最近几次计入「慢」判断的读(诊断用:提示条里写出是哪个接口、多慢、多大)。 */
let recentReads: ReadSample[] = [];
/** app 每离开一次前台(切后台 / 锁屏 / 多任务切换器 / 窗口隐藏)就 +1。 */
let suspendEpoch = 0;

/** 一次读的诊断样本。 */
export interface ReadSample { path: string; ms: number; bytes?: number }

/** 距本轮第一次失败不到这么久的失败算同一轮(同一轮轮询里并发的几个读一起失败只算一次)。 */
export const FAILURE_ROUND_MS = 3_000;
/** 有缓存数据可显示时,第一次失败到最近一次失败已过去这么久(中间没有任何成功),才改口径为"连不上"。
 *  比 FAILURE_ROUND_MS 长,所以隐含「至少两轮」——一轮再多并发失败也到不了。 */
export const OFFLINE_AFTER_MS = 10_000;
/** 连续失败到第几轮开始说「连接较慢 · 正在重试」(第 1 轮不出横幅)。 */
export const RETRYING_AFTER_ROUNDS = 2;
/** 一次读(含响应体)慢于这个值算慢。 */
export const SLOW_READ_MS = 6_000;
/** 最近这么多次成功读全都慢,才说「连接较慢」(单次慢不出横幅)。 */
export const SLOW_AFTER_READS = 3;
/** 失败时轮询退避的上限。 */
export const MAX_BACKOFF_MS = 60_000;

/** 横幅口径:在线(不显示)/ 连接较慢 / 无法连接。 */
export type ConnectivityLevel = 'online' | 'slow' | 'offline';

export interface ConnectivityState {
  level: ConnectivityLevel;
  /** true = 已判定连不上(冷启动 1 次失败,或有缓存时失败已持续 OFFLINE_AFTER_MS) */
  offline: boolean;
  /** true = 正在失败但还没到"连不上"——屏上仍是刚拿到的数据,只是在重试 */
  reconnecting: boolean;
  /** true = 最近几次读都成功但都很慢 */
  slowReads: boolean;
  /** 最后一次**成功**拿到数据的时刻;null = 本次启动还没成功过 */
  lastSuccessAt: number | null;
  /** 自上次成功以来的连续失败请求数(成功即归零) */
  consecutiveFailures: number;
  /** 自上次成功以来的失败轮数(同一轮并发失败只算一次) */
  failureRounds: number;
}

export function connectivityState(): ConnectivityState {
  const cold = lastSuccessAt === null;
  const streakMs = streakStartedAt !== null && lastFailureAt !== null ? lastFailureAt - streakStartedAt : 0;
  // 冷启动(从未成功过)不设宽限:屏幕上没有任何数据,沉默会被读成"卡住了"。
  const offline = cold
    ? failureRounds >= 1
    : streakMs >= OFFLINE_AFTER_MS;
  const reconnecting = !offline && failureRounds > 0;
  const slowReads = failureRounds === 0
    && recentReadMs.length >= SLOW_AFTER_READS
    && recentReadMs.every(ms => ms >= SLOW_READ_MS);
  const level: ConnectivityLevel = offline ? 'offline'
    : (reconnecting && failureRounds >= RETRYING_AFTER_ROUNDS) || slowReads ? 'slow'
      : 'online';
  return { level, offline, reconnecting, slowReads, lastSuccessAt, consecutiveFailures, failureRounds };
}

// ── 订阅(只在横幅口径翻转时通知——在线时每次轮询成功都 emit 会白刷 UI) ────────
const LISTENERS = new Set<() => void>();
let version = 0;
function snapshot(): string {
  const s = connectivityState();
  return `${s.level}|${s.reconnecting}`;
}
function maybeEmit(prev: string): void {
  if (snapshot() !== prev) {
    version++;
    LISTENERS.forEach((l) => l());
  }
}

/**
 * app 离开前台时调用(connectivity-lifecycle.ts 接 AppState)。
 * 2026-10-01(Vincent iPad「连接较慢」,#431):读的耗时是墙钟时间。iOS 把后台的 app 挂起,挂起前发出的读
 * 回到前台才算读完 —— 耗时把整段后台时间都算进去,一次切走就能凑出「连续 3 次 ≥6 秒」。跨过挂起的读不计入判慢。
 */
export function noteAppSuspended(): void { suspendEpoch += 1; }
/** 读开始时取一次;读完时原样交回 reportReadSuccess,期间离开过前台就不计耗时。 */
export function readEpoch(): number { return suspendEpoch; }

/**
 * 一次读拿到并解析出了数据。`durationMs` = 这次读从发出到读完响应体的耗时(用于判慢)。
 * `sample.epoch` 是读开始时的 readEpoch():中间离开过前台 ⇒ 耗时不可信,不计入判慢(成功本身照常算)。
 */
export function reportReadSuccess(at: number = Date.now(), durationMs?: number, sample?: { path?: string; bytes?: number; epoch?: number }): void {
  const prev = snapshot();
  const wasFailing = failureRounds > 0;
  lastSuccessAt = at;
  consecutiveFailures = 0;
  failureRounds = 0;
  streakStartedAt = null;
  roundStartedAt = null;
  const spannedSuspend = sample?.epoch !== undefined && sample.epoch !== suspendEpoch;
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && !spannedSuspend) {
    recentReadMs = [...recentReadMs, durationMs].slice(-SLOW_AFTER_READS);
    recentReads = [...recentReads, { path: sample?.path ?? '', ms: durationMs, ...(sample?.bytes !== undefined ? { bytes: sample.bytes } : {}) }].slice(-SLOW_AFTER_READS);
  }
  maybeEmit(prev);
  // 链路回来了:让还在退避里的其他轮询立刻刷新,而不是各自再等最长一分钟。
  if (wasFailing) requestReconnect();
}

/** 一次读失败了(网络错 / 超时 / 网关 5xx / 解析错)——数据没到,屏上是陈旧的。 */
export function reportReadFailure(at: number = Date.now()): void {
  const prev = snapshot();
  // 按本轮起点算,不按上一次失败:否则一串相隔 2 秒的失败会被链成永远的「一轮」。
  const newRound = roundStartedAt === null || failureRounds === 0 || at - roundStartedAt >= FAILURE_ROUND_MS;
  if (streakStartedAt === null) streakStartedAt = at;
  if (newRound) { failureRounds += 1; roundStartedAt = at; }
  lastFailureAt = at;
  consecutiveFailures += 1;
  maybeEmit(prev);
}

/**
 * 非 2xx 响应算不算"连不上"。502/503/504 是入口层(Caddy/frp/代理)在说"后面的 hub 够不着";
 * 其余(401/403/404/500…)是 hub 自己答的——链路是通的,只是这一个接口有问题,不该让全局横幅
 * 说"无法连接服务器"(否则一个旧 hub 上 404 的接口就能和一次超时凑成"连续两次失败")。
 */
export function readStatusCountsAsFailure(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export function subscribeConnectivity(cb: () => void): () => void {
  LISTENERS.add(cb);
  return () => { LISTENERS.delete(cb); };
}
export function connectivityVersion(): number { return version; }

// ── 立即重试(横幅点按 / 链路恢复时广播;usePoll 收到就马上跑一轮) ──────────────
const RECONNECT_LISTENERS = new Set<() => void>();
export function requestReconnect(): void {
  RECONNECT_LISTENERS.forEach((l) => l());
}
export function subscribeReconnect(cb: () => void): () => void {
  RECONNECT_LISTENERS.add(cb);
  return () => { RECONNECT_LISTENERS.delete(cb); };
}

/**
 * 失败时的轮询间隔:指数退避。在线 → intervalMs;失败 n 轮 → intervalMs × 2^n,封顶 MAX_BACKOFF_MS
 * (本来就比上限长的间隔不缩短)。连不上的时候每 5 秒打一次只会把慢链路再堵一遍、白耗电。
 */
export function pollBackoffMs(intervalMs: number, rounds: number = failureRounds): number {
  if (rounds <= 0) return intervalMs;
  return Math.max(intervalMs, Math.min(intervalMs * 2 ** rounds, MAX_BACKOFF_MS));
}

function hhmm(at: number, now: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  // 跨天还只写 HH:MM,「截至 12:15」会被读成今天的 12:15。
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** 最近计入判慢的几次读(旧 → 新)。 */
export function recentReadSamples(): ReadSample[] { return [...recentReads]; }

/** 接口路径的短名:去掉查询串和 /api/ 前缀(「requirements/stats」),诊断行里不放 token / 网络 id。 */
export function shortReadPath(path: string): string {
  return (path.split('?')[0] || '').replace(/^\/api\//, '') || path;
}

/**
 * 「连接较慢」时提示条的第二行:最近几次读各是哪个接口、多久、多大 —— 下次截图就能看出是链路卡(小接口也慢)
 * 还是某个接口太大。不是慢的口径 → null。
 */
export function slowReadDetail(s: ConnectivityState, samples: readonly ReadSample[] = recentReads): string | null {
  if (!s.slowReads || !samples.length) return null;
  return samples.map(r => `${shortReadPath(r.path)} ${(r.ms / 1000).toFixed(1)}s${r.bytes !== undefined ? ` ${r.bytes < 1024 ? `${r.bytes}B` : `${Math.round(r.bytes / 1024)}KB`}` : ''}`).join(' · ');
}

/** 横幅文案(纯函数便于测试)。在线 → null(不显示)。 */
export function bannerText(s: ConnectivityState, now: number = Date.now()): string | null {
  if (s.level === 'online') return null;
  if (s.level === 'slow') return s.reconnecting ? '连接较慢 · 正在重试' : '连接较慢 · 数据可能稍有延迟';
  if (s.lastSuccessAt === null) return '无法连接服务器 · 尚未获取到数据';
  return `无法连接服务器 · 显示缓存数据（截至 ${hhmm(s.lastSuccessAt, now)}）`;
}

/** Test-only: reset between cases. */
export function __resetConnectivityForTest(): void {
  lastSuccessAt = null;
  lastFailureAt = null;
  consecutiveFailures = 0;
  failureRounds = 0;
  streakStartedAt = null;
  roundStartedAt = null;
  recentReadMs = [];
  recentReads = [];
  suspendEpoch = 0;
  version = 0;
  RECONNECT_LISTENERS.clear();
}
