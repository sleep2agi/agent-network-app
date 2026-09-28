import { parseRequirements, type Requirement } from './requirements-model';
export const requirementsKey = (profileId: string) => `anet_requirements_v1:${profileId || 'local'}`;
const memory = new Map<string, string>();
export function readRequirements(key: string): Requirement[] {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const raw = ls && typeof ls.getItem === 'function' ? ls.getItem(key) : memory.get(key) ?? null;
    return parseRequirements(raw);
  } catch {
    return parseRequirements(memory.get(key) ?? null);
  }
}
export function writeRequirements(key: string, items: readonly Requirement[]): void {
  const raw = JSON.stringify(items);
  memory.set(key, raw);
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.setItem === 'function') ls.setItem(key, raw);
  } catch { /* session copy remains */ }
}
