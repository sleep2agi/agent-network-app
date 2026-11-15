// 桌面左侧一级栏哪些显示(管理员 2026-11-15「设置里面可以设置一级是否显示和展示」)。
// 存在本机 localStorage(设置窗口和主窗口同源,改了靠 storage 事件同步到主窗口);只存「隐藏了哪些」,
// 这样以后新加的一级入口默认是显示的。Agent 和设置不能隐藏(一个是首页,一个是改回来的地方)。
import { useEffect, useState } from 'react';

export const RAIL_HIDEABLE = ['tasks', 'scheduled', 'messages', 'server', 'org'] as const;
export type RailHideable = typeof RAIL_HIDEABLE[number];
const KEY = 'anet.desktopRailHidden';
const EVENT = 'anet-rail-hidden';

const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function parseRailHidden(raw: string | null | undefined): RailHideable[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? RAIL_HIDEABLE.filter(k => v.includes(k)) : [];
  } catch { return []; }
}

export const loadRailHidden = (): RailHideable[] => parseRailHidden(storage()?.getItem(KEY));

export function saveRailHidden(hidden: readonly string[]): void {
  const clean = RAIL_HIDEABLE.filter(k => hidden.includes(k));
  try { storage()?.setItem(KEY, JSON.stringify(clean)); } catch { /* 存不了就只在这次生效 */ }
  try { globalThis.dispatchEvent?.(new Event(EVENT)); } catch { /* 非浏览器环境 */ }
}

export function setRailVisible(key: RailHideable, visible: boolean): void {
  const cur = loadRailHidden();
  saveRailHidden(visible ? cur.filter(k => k !== key) : [...cur, key]);
}

/** 只留没被隐藏的一级入口;不可隐藏的(agents / settings)原样保留。 */
export function visibleRailTabs<T extends { key: string }>(tabs: readonly T[], hidden: readonly string[]): T[] {
  return tabs.filter(t => !(RAIL_HIDEABLE as readonly string[]).includes(t.key) || !hidden.includes(t.key));
}

/** 当前隐藏列表;本窗口改(自定义事件)和设置窗口改(storage 事件)都会刷新。 */
export function useRailHidden(): RailHideable[] {
  const [hidden, setHidden] = useState<RailHideable[]>(() => loadRailHidden());
  useEffect(() => {
    const g = globalThis as unknown as { addEventListener?: (n: string, f: (e?: { key?: string | null }) => void) => void; removeEventListener?: (n: string, f: (e?: { key?: string | null }) => void) => void };
    if (!g.addEventListener) return;
    const refresh = (e?: { key?: string | null }) => { if (!e || e.key === undefined || e.key === null || e.key === KEY) setHidden(loadRailHidden()); };
    const local = () => setHidden(loadRailHidden());
    g.addEventListener('storage', refresh);
    g.addEventListener(EVENT, local);
    return () => { g.removeEventListener?.('storage', refresh); g.removeEventListener?.(EVENT, local); };
  }, []);
  return hidden;
}
