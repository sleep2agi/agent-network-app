// admin 2026-11-19「这些现在感觉都好慢啊」：技能面板每次打开都要经节点枚举目录再轮询结果，几秒钟一直转圈。
// 按「哪个 Hub 账号 × 哪个节点」记住上一次的清单：再打开时先秒出旧清单，后台再向节点刷新。
// 纯内存（不落盘），只在本次运行内有效；纯函数模块，便于测试。
import type { SkillSummary } from './node-skills';

export type CachedSkills = { skills: SkillSummary[]; roots: string[] | null; warnings: string[]; at: number };

const MAX = 64;
const cache = new Map<string, CachedSkills>();

export function skillsCacheKey(cfg: { serverUrl: string; profileId?: string; networkId?: string }, nodeKey: string): string {
  return `${cfg.serverUrl}|${cfg.profileId ?? ''}|${cfg.networkId ?? ''}|${nodeKey}`;
}

export function getCachedSkills(key: string): CachedSkills | null {
  return cache.get(key) ?? null;
}

export function putCachedSkills(key: string, v: Omit<CachedSkills, 'at'>, now = Date.now()): void {
  cache.delete(key);
  cache.set(key, { ...v, at: now });
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
}

export function clearSkillsCache(): void { cache.clear(); }
