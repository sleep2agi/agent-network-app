// 服务器页的延迟测量:对 hub 的 `/health` 打一次 GET,量往返时间。
//
// 故意不走 api.ts 的 get():那条路径会把结果上报给 connectivity 横幅,而一次延迟探测
// 失败不该让全局横幅改口径(横幅只管「数据到没到」)。也不读响应体以外的东西 ——
// 量的是 hub 能多快回一个最轻的请求。

import { appFetch } from './app-fetch';
import type { HubConfig } from './api';

const PING_TIMEOUT_MS = 8000;

/** 成功返回毫秒数;超时 / 网络错 / 非 2xx 返回 null(界面写「—」)。 */
export async function pingHealth(cfg: HubConfig, now: () => number = defaultNow): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  const started = now();
  try {
    const res = await appFetch(`${cfg.serverUrl.replace(/\/$/, '')}/health`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: ctrl.signal,
    });
    await res.text();
    if (!res.ok) return null;
    return Math.max(0, now() - started);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function defaultNow(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}
