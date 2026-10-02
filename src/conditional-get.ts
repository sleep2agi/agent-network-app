// 条件 GET(board #467,#431 的 app 那一半):hub 回了 ETag 的读,下次带 If-None-Match;hub 回 304 就用上次的正文。
//
// 哪些读会带 ETag:GET /api/requirements(任务页,hub ≥ .75)和 GET /api/status(全部投影,hub ≥ .88,#2247)。
// 其余接口不发 ETag —— 这里对它们什么都不记、从不带 If-None-Match,行为与原来逐字相同;旧 hub 同理。
// 实测(抛弃 hub、306 个合成节点、按生产的读写比,#2247):全量状态读线上 34.7 KB → 11.2 KB/次(2/3 是 304)。
//
// 记的是**原文**(不是解析好的对象):304 时重新 JSON.parse 一份,调用方拿到的和 200 时一样是新对象,
// 谁改了自己手里那份都不会改到下一次的结果。
//
// 🔴 按「账号 + hub + 令牌 + 路径」分开记,换账号 / 换 hub 永远拿不到别人的正文;退出登录、切换账号、
//    重新登录、删除本机数据时整个清空(App.tsx 那几处调用 clearConditionalReads)。只在内存里,重启清空。

export interface ConditionalCfg { serverUrl: string; token: string; profileId?: string }

const MAX_ENTRIES = 32;
const store = new Map<string, { etag: string; text: string }>();
const keyOf = (cfg: ConditionalCfg, path: string) => `${cfg.profileId ?? ''}\u0000${cfg.serverUrl}\u0000${cfg.token}\u0000${path}`;

/** 要带的请求头:记着这个读的 ETag 就带 If-None-Match,没有就是空对象。 */
export function conditionalHeaders(cfg: ConditionalCfg, path: string): Record<string, string> {
  const hit = store.get(keyOf(cfg, path));
  return hit ? { 'If-None-Match': hit.etag } : {};
}

type ResLike = { status: number; ok: boolean; headers?: { get?: (k: string) => string | null }; text: () => Promise<string> };

/**
 * 读完一个 2xx / 304 响应,返回正文原文;记下 / 更新 / 丢掉 ETag。
 * - 304 且记着 → 上次的原文(304 本身是空体:plugin:http、pooled_fetch、浏览器 fetch 都给 null body);
 * - 304 却没记着(请求发出后被清空了:中途退出登录)→ null,调用方当失败处理;
 * - 200 带 ETag → 记下;200 不带(旧 hub / 降级)→ 丢掉以前记的,不再带 If-None-Match。
 */
export async function readConditionalText(cfg: ConditionalCfg, path: string, res: ResLike): Promise<string | null> {
  const key = keyOf(cfg, path);
  if (res.status === 304) {
    const hit = store.get(key);
    if (!hit) return null;
    store.delete(key);
    store.set(key, hit); // LRU
    return hit.text;
  }
  const text = await res.text();
  const etag = res.headers?.get?.('etag') ?? null;
  if (etag) {
    store.delete(key);
    store.set(key, { etag, text });
    while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
  } else {
    store.delete(key);
  }
  return text;
}

/** 退出登录 / 切换账号 / 重新登录 / 删除本机数据:一律清空。 */
export function clearConditionalReads(): void {
  store.clear();
}

/** Test-only. */
export function __conditionalReadsSize(): number { return store.size; }
