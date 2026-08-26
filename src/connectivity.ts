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
// 写失败有各自的显式 UI(如聊天的「未送达·点击重试」)。
//
// 🔴 两跳阈值(2026-08-24):原实现是"最近一次完成的读失败了就报"。实测下来这条规则
// 把**单次抖动**播报成了"服务器挂了":app 每轮拉 ~620KB(其中 /api/status 一个就
// 388KB),超时是 12s,而隧道在最轻的 /health 上都量到过 5.6s 尖峰。一次越线 → 横幅
// → 用户报"commhub 挂了"(一天五次),下一次轮询成功横幅又自己消失,所以事后去量
// 必然全绿、零分辨力。
// 现在:**有缓存数据在屏上时**才容忍一次失败(第一次记为 reconnecting,第二次才
// offline);**冷启动从未成功过时**仍然一次失败就报——那时屏幕上什么都没有,沉默比
// 误报更糟。阈值只影响"何时改口径",不影响诚实契约:lastSuccessAt 依旧只在成功时动。

let lastSuccessAt: number | null = null;
let lastFailureAt: number | null = null;
let consecutiveFailures = 0;

/** 有缓存数据可显示时,连续失败达到这个数才改口径为"连不上"。 */
export const OFFLINE_AFTER_FAILURES = 2;

export interface ConnectivityState {
  /** true = 已判定连不上(冷启动 1 次失败,或有缓存时连续 2 次) */
  offline: boolean;
  /** true = 刚失败一次但屏上还有数据——不喊"挂了",只说在重试 */
  reconnecting: boolean;
  /** 最后一次**成功**拿到数据的时刻;null = 本次启动还没成功过 */
  lastSuccessAt: number | null;
  /** 自上次成功以来的连续失败次数(成功即归零) */
  consecutiveFailures: number;
}

export function connectivityState(): ConnectivityState {
  // 冷启动(从未成功过)不设宽限:屏幕上没有任何数据,沉默会被读成"卡住了"。
  const threshold = lastSuccessAt === null ? 1 : OFFLINE_AFTER_FAILURES;
  const offline = consecutiveFailures >= threshold;
  return {
    offline,
    reconnecting: !offline && consecutiveFailures > 0,
    lastSuccessAt,
    consecutiveFailures,
  };
}

// ── 订阅(只在 offline 翻转时通知——在线时每次轮询成功都 emit 会白刷 UI) ────────
const LISTENERS = new Set<() => void>();
let version = 0;
function snapshot(): string {
  const s = connectivityState();
  return `${s.offline}|${s.reconnecting}`;
}
function maybeEmit(prev: string): void {
  if (snapshot() !== prev) {
    version++;
    LISTENERS.forEach((l) => l());
  }
}

export function reportReadSuccess(at: number = Date.now()): void {
  const prev = snapshot();
  lastSuccessAt = at;
  consecutiveFailures = 0;
  maybeEmit(prev);
}

export function reportReadFailure(at: number = Date.now()): void {
  const prev = snapshot();
  lastFailureAt = at;
  consecutiveFailures += 1;
  maybeEmit(prev);
}

export function subscribeConnectivity(cb: () => void): () => void {
  LISTENERS.add(cb);
  return () => { LISTENERS.delete(cb); };
}
export function connectivityVersion(): number { return version; }

/** 横幅文案(纯函数便于测试)。在线 → null(不显示)。 */
export function bannerText(s: ConnectivityState): string | null {
  // 抖动档:屏上仍是刚拿到的数据,不要说"连不上"——那正是误报的来源。
  if (s.reconnecting) return '网络不稳定 · 正在重试';
  if (!s.offline) return null;
  if (s.lastSuccessAt === null) return '无法连接服务器 · 尚未获取到数据';
  const d = new Date(s.lastSuccessAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `无法连接服务器 · 显示缓存数据（截至 ${hh}:${mm}）`;
}

/** Test-only: reset between cases. */
export function __resetConnectivityForTest(): void {
  lastSuccessAt = null;
  lastFailureAt = null;
  consecutiveFailures = 0;
  version = 0;
}
