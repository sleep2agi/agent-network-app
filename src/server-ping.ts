// 服务器页的延迟测量:对 hub 的 `/health` 打一次 GET,量往返时间。
//
// 故意不走 api.ts 的 get():那条路径会把结果上报给 connectivity 横幅,而一次延迟探测
// 失败不该让全局横幅改口径(横幅只管「数据到没到」)。也不读响应体以外的东西 ——
// 量的是 hub 能多快回一个最轻的请求。

import { appFetch } from './app-fetch';
import type { HubConfig } from './api';

const PING_TIMEOUT_MS = 8000;

/** 一次 `/health` 同时给出延迟和 Hub 版本(0.2.618 #5429:「版本」以前读 `/api/version` 里的
 *  「CommHub MCP Server v…」文字,现在的 Hub 没有这个路由 ⇒ 版本恒为「—」;`/health` 本来就带 `version`)。 */
export async function probeHealth(cfg: HubConfig, now: () => number = defaultNow): Promise<{ ms: number | null; version: string | undefined }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  const started = now();
  try {
    const res = await appFetch(`${cfg.serverUrl.replace(/\/$/, '')}/health`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Math.max(0, now() - started);
    if (!res.ok) return { ms: null, version: undefined };
    return { ms, version: healthVersion(text) };
  } catch {
    return { ms: null, version: undefined };
  } finally {
    clearTimeout(timer);
  }
}

/** `/health` 正文里的 `version`;不是 JSON / 没有这个字段 ⇒ undefined。纯函数,单测用。 */
export function healthVersion(body: string): string | undefined {
  try {
    const v = (JSON.parse(body) as { version?: unknown })?.version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : undefined;
  } catch { return undefined; }
}

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
