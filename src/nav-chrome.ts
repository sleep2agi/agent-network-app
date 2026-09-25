// Which navigation chrome the non-desktop app shows around a screen: the phone's
// bottom tab bar, the left vertical rail (Android wide / two-pane), or nothing.
//
// Pure on purpose (no react-native import) so the rule is checked by
// nav-chrome.test.ts; App.tsx renders whatever it returns.
//
// Vincent 0.2.100 on an unfolded foldable in landscape: 「我感觉可以改成和电脑一样的样式…
// 下面那一栏放在左边会好一点」. So when the wide two-pane layout is active the four phone
// destinations move from a full-width bottom bar into a left rail, the same place the
// desktop app keeps its rail. The phone and the Tauri desktop workspace do not change.

import type { AppLayout } from './wide-layout';

export type NavChrome = 'rail' | 'bottomTabs' | 'none';

/**
 * Screens the phone shows without the tab bar: a full-screen leaf with its own back
 * button (chat, node pages, the create-node flow, task detail, the event stream).
 * This is the set the phone stack rendered without `mobileTabBar(...)` before the rail
 * existed; login never had navigation.
 */
export const PHONE_LEAF_SCREENS: readonly string[] = [
  'login', 'chat', 'nodeInfo', 'nodeDetail', 'picker', 'wizard', 'taskDetail', 'logs',
];

/**
 * - desktop: the Tauri workspace draws its own rail (DesktopWorkspace) → nothing here.
 * - twoPane (Android ≥ 700 dp: unfolded foldable, tablet, phone in landscape): the rail,
 *   on every signed-in screen, like the desktop rail. Leaves keep it too: they now render
 *   next to it instead of hiding the navigation, and each still has its own back button.
 * - phone: bottom tabs on the tab-level screens only, exactly as before.
 */
export function navChromeFor(layout: AppLayout, screenName: string): NavChrome {
  if (layout === 'desktop' || screenName === 'login') return 'none';
  if (layout === 'twoPane') return 'rail';
  return PHONE_LEAF_SCREENS.includes(screenName) ? 'none' : 'bottomTabs';
}

/**
 * The destination a screen belongs to, i.e. which rail/tab item lights up. A chat or
 * node page (and the create-node flow opened from the agents list's "+") belong to
 * Agent; the event stream and server pages belong to 服务器. Screens with no mobile
 * destination (tasks / messages) return their own name, so nothing lights up.
 */
export function navActiveKey(screenName: string): string {
  switch (screenName) {
    case 'agents': case 'chat': case 'nodeInfo': case 'nodeDetail': case 'picker': case 'wizard':
      return 'agents';
    case 'server': case 'serverNodes': case 'serverNodeDetail': case 'logs':
      return 'server';
    case 'taskDetail':
      return 'tasks';
    default:
      return screenName;
  }
}

/**
 * What pressing a destination does. Pressing the destination you are already in is a
 * no-op (null): in the two-pane that keeps the open conversation instead of dropping
 * back to the empty placeholder. Any other destination opens its top screen.
 */
export function screenForNavPress(key: string, currentScreenName: string): { name: string } | null {
  return navActiveKey(currentScreenName) === key ? null : { name: key };
}

/** Rail width in dp (Material's compact rail is 72–80). Excludes the left safe-area inset. */
export const MOBILE_RAIL_WIDTH = 72;
/** Each rail item's hit box. Both sides must stay ≥ 44 (Apple HIG) / 48 (Material). */
export const MOBILE_RAIL_ITEM = { width: 64, height: 56 } as const;

/**
 * The brand mark and version take ~70 dp. A phone in landscape inside the two-pane has
 * ~330–360 dp of height after the status and gesture bars, so drop them there and keep
 * every destination reachable without scrolling. Unfolded foldables (≈ 780–850 dp tall)
 * keep them, like the desktop rail.
 */
export const RAIL_BRAND_MIN_HEIGHT = 480;
export const railShowsBrand = (windowHeight: number): boolean => windowHeight >= RAIL_BRAND_MIN_HEIGHT;

/**
 * Width left for the content to the right of the rail (the two panes, or a full-width
 * screen). The rail absorbs the left inset; the content is padded by the right one.
 */
export function contentWidthBesideRail(windowWidth: number, insetLeft = 0, insetRight = 0): number {
  return Math.max(0, windowWidth - MOBILE_RAIL_WIDTH - insetLeft - insetRight);
}

/** Total unread across agents for the Agent destination's badge (same counts as the list rows). */
export function railUnreadTotal(counts: Record<string, number>): number {
  let total = 0;
  for (const n of Object.values(counts)) if (typeof n === 'number' && Number.isFinite(n) && n > 0) total += n;
  return total;
}
