// Hub #3711 —— 机器别名的客户端缓存。
//
// 列表里同一台机器可能有多个节点：按 hostname 去重后各查一次，结果放进程内缓存，
// 组件用 useSyncExternalStore 订阅（与仓里其它 store 一致）。失败静默 —— 显示回落 hostname。
import { fetchMachineAlias, type HubConfig } from './api';

type Entry = { alias: string | null; at: number; pending?: boolean };
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

const keyOf = (cfg: HubConfig, hostname: string) => `${cfg.serverUrl}|${cfg.profileId ?? ''}|${hostname}`;
const emit = () => { for (const l of listeners) l(); };

export function subscribeMachineAliases(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 当前已知的别名；未加载 / 加载失败都返回 undefined（调用方回落 hostname）。 */
export function machineAliasFor(cfg: HubConfig, hostname: string | null | undefined): string | undefined {
  const host = String(hostname ?? '').trim();
  if (!host) return undefined;
  return cache.get(keyOf(cfg, host))?.alias ?? undefined;
}

/** 让这些 hostname 都有一次新鲜数据（TTL 内不重复请求）。 */
export function ensureMachineAliases(cfg: HubConfig, hostnames: ReadonlyArray<string | null | undefined>): void {
  const now = Date.now();
  const todo: string[] = [];
  for (const raw of hostnames) {
    const host = String(raw ?? '').trim();
    if (!host) continue;
    const key = keyOf(cfg, host);
    const hit = cache.get(key);
    if (hit && (hit.pending || now - hit.at < TTL_MS)) continue;
    cache.set(key, { alias: hit?.alias ?? null, at: hit?.at ?? 0, pending: true });
    todo.push(host);
  }
  for (const host of todo) {
    void fetchMachineAlias(cfg, host).then(res => {
      cache.set(keyOf(cfg, host), { alias: res?.alias ?? null, at: Date.now() });
      emit();
    }).catch(() => {
      const key = keyOf(cfg, host);
      const prev = cache.get(key);
      cache.set(key, { alias: prev?.alias ?? null, at: Date.now() });
      emit();
    });
  }
}

/** 写入成功后直接更新缓存（不额外拉一次）。 */
export function setMachineAliasCache(cfg: HubConfig, hostname: string, alias: string | null): void {
  const host = String(hostname ?? '').trim();
  if (!host) return;
  cache.set(keyOf(cfg, host), { alias: alias && alias.trim() ? alias.trim() : null, at: Date.now() });
  emit();
}

/** 测试用：清空缓存。 */
export function __resetMachineAliasCache(): void {
  cache.clear();
  emit();
}
