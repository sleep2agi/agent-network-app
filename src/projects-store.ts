// 项目存在这台电脑的 localStorage。桌面端是 web；没有 localStorage 时只活在本次会话。
import { parseProjects, type ProjectItem } from './projects-model';

export const projectsStorageKey = (profileId: string) => `anet_projects_v1:${profileId || 'local'}`;

const memory = new Map<string, string>();

export function readProjects(key: string): ProjectItem[] {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const raw = ls && typeof ls.getItem === 'function' ? ls.getItem(key) : memory.get(key) ?? null;
    return parseProjects(raw);
  } catch {
    return parseProjects(memory.get(key) ?? null);
  }
}

export function writeProjects(key: string, items: readonly ProjectItem[]): void {
  const raw = JSON.stringify(items);
  memory.set(key, raw);
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.setItem === 'function') ls.setItem(key, raw);
  } catch { /* this session still has memory */ }
}
