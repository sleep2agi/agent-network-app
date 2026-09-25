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
 *   Portrait phones top out around 480 dp. → stays well below 700.
 * - 0.2.100: app.json `orientation` is "default" (was "portrait"). A portrait lock made
 *   Android letterbox the app on an unfolded foldable held landscape — a phone-shaped
 *   column between blurred bars — so this branch never saw the wide width. A phone
 *   rotated to landscape (~800–930 dp × ~360–410 dp) now also splits; checked usable
 *   in the web-export harness at 844×390 (list 320 + chat 524).
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

// ── list pane width (0.2.106: fixed default + draggable divider) ──
//
// 0.2.98–0.2.105 sized the list as 38% of the area beside the rail, clamped 320–400. On an
// unfolded foldable held landscape that is the 400 dp end — Vincent on 0.2.104:
// 「左边这个 agent 的列表是不是占的区间也太大了」. A conversation list does not get more
// useful as the window grows (WeChat / Telegram keep it fixed), so it is now a fixed
// 320 dp that the user can drag between 260 and 420; the chat takes the rest.

/** Default list pane width (dp) before the user drags the divider. */
export const LIST_PANE_DEFAULT_WIDTH = 320;
/** Narrowest list: 44 dp avatar + a readable name + the time column. */
export const LIST_PANE_MIN_WIDTH = 260;
export const LIST_PANE_MAX_WIDTH = 420;
/** The chat never gets narrower than this because of the list (a phone-width column). */
export const CHAT_PANE_MIN_WIDTH = 320;

/**
 * Left (list) pane width for an area `areaWidth` dp wide (the width beside the rail).
 * `preferred` is the user's dragged width (or the default). Always within
 * [LIST_PANE_MIN_WIDTH, LIST_PANE_MAX_WIDTH]; below that, also leaves the chat at least
 * CHAT_PANE_MIN_WIDTH — except that the list never drops under its own minimum.
 */
export function twoPaneListWidth(areaWidth: number, preferred: number = LIST_PANE_DEFAULT_WIDTH): number {
  const want = Number.isFinite(preferred) && preferred > 0 ? preferred : LIST_PANE_DEFAULT_WIDTH;
  const roomy = Number.isFinite(areaWidth) ? areaWidth - CHAT_PANE_MIN_WIDTH : LIST_PANE_MAX_WIDTH;
  const hi = Math.max(LIST_PANE_MIN_WIDTH, Math.min(LIST_PANE_MAX_WIDTH, roomy));
  return Math.round(Math.max(LIST_PANE_MIN_WIDTH, Math.min(hi, want)));
}

/** Divider drag: finger moved `dx` dp since the press (right = wider list). */
export function listWidthFromDrag(startWidth: number, dx: number, areaWidth: number): number {
  // Floor at the minimum *before* the clamp: a drag far past the left edge gives a negative
  // raw width, which twoPaneListWidth would read as "no preference" and snap back to 320.
  return twoPaneListWidth(areaWidth, Math.max(LIST_PANE_MIN_WIDTH, startWidth + (Number.isFinite(dx) ? dx : 0)));
}

/** A persisted width: anything that is not a positive finite number reads as "never saved". */
export function parseStoredListWidth(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.max(LIST_PANE_MIN_WIDTH, Math.min(LIST_PANE_MAX_WIDTH, n)));
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
