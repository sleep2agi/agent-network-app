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

let lastSuccessAt: number | null = null;
let lastFailureAt: number | null = null;

export interface ConnectivityState {
  /** true = 最近一次完成的读请求失败了(界面上是缓存/陈旧数据) */
  offline: boolean;
  /** 最后一次**成功**拿到数据的时刻;null = 本次启动还没成功过 */
  lastSuccessAt: number | null;
}

export function connectivityState(): ConnectivityState {
  return {
    offline: lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt),
    lastSuccessAt,
  };
}

// ── 订阅(只在 offline 翻转时通知——在线时每次轮询成功都 emit 会白刷 UI) ────────
const LISTENERS = new Set<() => void>();
let version = 0;
function maybeEmit(prevOffline: boolean): void {
  if (connectivityState().offline !== prevOffline) {
    version++;
    LISTENERS.forEach((l) => l());
  }
}

export function reportReadSuccess(at: number = Date.now()): void {
  const prev = connectivityState().offline;
  lastSuccessAt = at;
  maybeEmit(prev);
}

export function reportReadFailure(at: number = Date.now()): void {
  const prev = connectivityState().offline;
  lastFailureAt = at;
  maybeEmit(prev);
}

export function subscribeConnectivity(cb: () => void): () => void {
  LISTENERS.add(cb);
  return () => { LISTENERS.delete(cb); };
}
export function connectivityVersion(): number { return version; }

/** 横幅文案(纯函数便于测试)。在线 → null(不显示)。 */
export function bannerText(s: ConnectivityState): string | null {
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
  version = 0;
}
