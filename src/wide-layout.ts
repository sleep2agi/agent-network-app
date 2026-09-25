// Which top-level layout the app renders: the Tauri desktop workspace, the
// Android wide two-pane (foldables unfolded / tablets), or the phone stack.
//
// Pure on purpose: App.tsx feeds it Platform.OS / the Tauri global / the UA /
// useWindowDimensions().width and renders whatever it returns, so the
// decision (and the promise that desktop and phone are unchanged) is testable
// without React. See wide-layout.test.ts.

/**
 * Android switches to list + detail at this window width (dp).
 *
 * Why 700 and not Material's 600 / 840:
 * - Folded cover screens are phones: MIX Fold cover 1080 px wide @ ~2.75 ≈ 390–420 dp.
 *   Portrait phones top out around 480 dp (and app.json locks portrait, so a phone
 *   never reports its ~900 dp landscape width). → stays well below 700.
 * - Unfolded MIX Fold-class inner screens (≈2200–2480 px at ~420–440 dpi,
 *   density ≈ 2.6–2.75) report ≈ 800–950 dp, and Galaxy Z Fold inner ≈ 840–900 dp.
 *   → comfortably above 700, even with a little system-bar/letterbox margin.
 * - 7–8" tablets in portrait are 600–650 dp: one 320 dp list leaves < 330 dp for the
 *   conversation, which truncates the chat header actions — so they keep the phone
 *   stack. 10–11" tablets portrait (≈ 800 dp) and every tablet in landscape
 *   (≥ 960 dp) split.
 * - At exactly 700 the split is 320 list + 380 detail: both panes are still at least
 *   phone-width (~360–412 dp), which is what the phone screens are laid out for.
 */
export const ANDROID_TWO_PANE_MIN_WIDTH = 700;

/** Existing Tauri desktop threshold (was inline in App.tsx as `width >= 860`). */
export const TAURI_DESKTOP_MIN_WIDTH = 860;

export type AppLayout = 'desktop' | 'twoPane' | 'phone';

export interface LayoutInput {
  /** Platform.OS */
  os: string;
  /** `!!globalThis.__TAURI_INTERNALS__` */
  tauri: boolean;
  /** navigator.userAgent on web ('' on native). */
  userAgent?: string;
  /** useWindowDimensions().width, in dp. */
  width: number;
}

/**
 * Android native, or the web build running in an Android browser. A Tauri
 * desktop webview never carries an Android UA, so this never claims a desktop
 * window; it lets the web export on an Android tablet (and the Playwright
 * harness that emulates one) take the same branch as the native build.
 */
export const isAndroidLike = (os: string, userAgent = ''): boolean =>
  os === 'android' || (os === 'web' && /\bAndroid\b/i.test(userAgent));

export function chooseAppLayout({ os, tauri, userAgent = '', width }: LayoutInput): AppLayout {
  if (isAndroidLike(os, userAgent)) return width >= ANDROID_TWO_PANE_MIN_WIDTH ? 'twoPane' : 'phone';
  // Unchanged from before this module existed: `tauriDesktop && width >= 860`.
  if (os === 'web' && tauri && width >= TAURI_DESKTOP_MIN_WIDTH) return 'desktop';
  return 'phone';
}

/** Left (list) pane width: a phone-width column, never more than ~40% of the window. */
export function twoPaneListWidth(width: number): number {
  return Math.round(Math.max(320, Math.min(400, width * 0.38)));
}

// ── selected-item mapping between the phone stack and the two panes ──
//
// The app keeps ONE navigation value (App.tsx `Screen`) for both layouts, so a
// fold/unfold never has to translate navigation — it only re-reads it. These two
// functions are that reading, and each is the other's inverse on the screens that
// split (tested both ways).

export type DetailKind = 'chat' | 'nodeDetail' | 'nodeInfo';
export interface PaneSelection {
  /** Highlighted row in the left list (undefined = nothing selected). */
  selectedAlias?: string;
  /** What the right pane shows; null = empty placeholder. */
  detail: DetailKind | null;
}

type ScreenLike = { name: string; alias?: string };

const DETAIL_KINDS: readonly string[] = ['chat', 'nodeDetail', 'nodeInfo'];

/**
 * Screens that render as list + detail in the two-pane layout. Every other screen
 * (tasks, 定时, 服务器, 设置, logs, picker, wizard, taskDetail…) renders full width,
 * exactly as on the phone.
 */
export const splitsInTwoPane = (screen: ScreenLike): boolean =>
  screen.name === 'agents' || (DETAIL_KINDS.includes(screen.name) && typeof screen.alias === 'string');

/** Stack screen → pane selection. Returns null for screens that do not split. */
export function paneSelectionFor(screen: ScreenLike): PaneSelection | null {
  if (!splitsInTwoPane(screen)) return null;
  if (screen.name === 'agents') return { detail: null };
  return { selectedAlias: screen.alias, detail: screen.name as DetailKind };
}

/** Pane selection → the stack screen a phone shows for it. */
export function screenForPaneSelection(sel: PaneSelection): { name: 'agents' } | { name: DetailKind; alias: string } {
  if (!sel.detail || !sel.selectedAlias) return { name: 'agents' };
  return { name: sel.detail, alias: sel.selectedAlias };
}
