// Pure model for the desktop 「图片预览」 window (ImageViewerWindow.tsx + image-window.ts).
// No RN / Tauri imports so image-window-model.test.ts can run it directly.
//
// Owner request 2026-09-27: on desktop, clicking an image in chat opened a preview that took over
// the whole main window; he wants it in a separate native window. Phone keeps the full-screen
// ImageViewer (#408), plain web keeps it too (no second native window there).
//
// How the window gets its images without a token in any URL:
//   - the window URL is fixed (`/?imageViewer=1`) — nothing about the images or the account in it;
//   - the opener sends an ImageWindowPayload over a Tauri event (image-window.ts): the image list,
//     the index, and WHICH account (profileId + serverUrl) — never the token;
//   - the window loads that account's token itself from the Rust credential store
//     (loadHubProfile(profileId), the same call a detached chat window makes), and only sends it to
//     `${serverUrl}/api/files/…` of that same account (authorizedFileUrl below).

import { clampIndex, type ViewerImage } from './image-viewer-model';

/** One reusable window: clicking another image navigates it instead of opening more. */
export const IMAGE_WINDOW_LABEL = 'image-viewer';
export const IMAGE_WINDOW_URL = '/?imageViewer=1';
export const IMAGE_WINDOW_TITLE = '图片预览';

/** Opener → window: 「show this」. Window → openers: 「I'm up, send me the latest」. Opener → window: 「close」. */
export const IMAGE_WINDOW_SHOW_EVENT = 'image-viewer:show';
export const IMAGE_WINDOW_READY_EVENT = 'image-viewer:ready';
export const IMAGE_WINDOW_CLOSE_EVENT = 'image-viewer:close';

/** Last size/position of the window (logical px). Per-device convenience, localStorage. */
export const IMAGE_WINDOW_BOUNDS_KEY = 'image_viewer_window_bounds_v1';

export function readImageWindowRoute(search: string): boolean {
  try { return new URLSearchParams(search).get('imageViewer') === '1'; } catch { return false; }
}

// ── which surface ──────────────────────────────────────────────────────────

export type PreviewSurface = 'window' | 'in-app';

/** Desktop (Tauri shell) → separate window; phone and plain web → the in-app ImageViewer. */
export function imagePreviewSurface(env: { os: string; tauri: boolean }): PreviewSurface {
  return env.os === 'web' && env.tauri ? 'window' : 'in-app';
}

// ── payload ────────────────────────────────────────────────────────────────

/** What the window can load on its own: an authed hub file url, or a plain http(s)/data: url.
 *  `blob:` / `file:` uris belong to the opener's document (a draft, a fresh local echo) — the new
 *  window cannot read them, so those images are left out (or, if the tapped one is such an image,
 *  the in-app viewer is used). */
export type WindowImage = { key: string; name: string; uri?: string; authUri?: string; mime?: string; save?: boolean };

export type ImageWindowPayload = {
  v: 1;
  /** Which account's token the window loads for `authUri`s. Never the token itself. */
  profileId?: string;
  serverUrl: string;
  /** Conversation the images came from, shown in the window title. */
  title?: string;
  images: WindowImage[];
  index: number;
  /** Opener clock when sent: the window keeps the newest one if two openers answer. */
  at: number;
};

const isPortableUri = (uri: string) => /^(https?:|data:image\/)/i.test(uri);

export function windowImageFor(image: ViewerImage): WindowImage | null {
  if (image.authUri) return { key: image.key, name: image.name, authUri: image.authUri, mime: image.mime, save: image.save };
  if (image.uri && isPortableUri(image.uri)) return { key: image.key, name: image.name, uri: image.uri, mime: image.mime, save: image.save };
  return null;
}

/** All images of a conversation, oldest first, each once. `groups` = each message's images in
 *  display order (sent bubble, then reply bubble), messages oldest → newest. */
export function conversationGallery(groups: ViewerImage[][]): ViewerImage[] {
  const seen = new Set<string>();
  const out: ViewerImage[] = [];
  for (const group of groups) for (const image of group) {
    if (seen.has(image.key)) continue;
    seen.add(image.key);
    out.push(image);
  }
  return out;
}

/** Build what the window is sent, or null → use the in-app viewer. ←/→ walk the whole conversation;
 *  if the tapped image is not in it (a composer draft), the message's own gallery is used. */
export function imageWindowPayload(input: {
  conversation: ViewerImage[];
  message: ViewerImage[];
  tappedKey: string;
  profileId?: string;
  serverUrl: string;
  title?: string;
  now: number;
}): ImageWindowPayload | null {
  const source = input.conversation.some(i => i.key === input.tappedKey) ? input.conversation : input.message;
  const images: WindowImage[] = [];
  for (const image of source) {
    const w = windowImageFor(image);
    if (w) images.push(w);
  }
  const index = images.findIndex(i => i.key === input.tappedKey);
  if (index < 0) return null;
  return { v: 1, profileId: input.profileId, serverUrl: input.serverUrl, title: input.title, images, index, at: input.now };
}

/** Validate what arrived over the event bus (it is another window's data, not ours). */
export function parseImageWindowPayload(raw: unknown): ImageWindowPayload | null {
  const p = raw as Partial<ImageWindowPayload> | null;
  if (!p || p.v !== 1 || typeof p.serverUrl !== 'string' || !Array.isArray(p.images) || typeof p.index !== 'number') return null;
  const images = p.images.filter((i): i is WindowImage =>
    !!i && typeof i.key === 'string' && typeof i.name === 'string'
    && (typeof i.authUri === 'string' || (typeof i.uri === 'string' && isPortableUri(i.uri))));
  if (!images.length) return null;
  return {
    v: 1,
    profileId: typeof p.profileId === 'string' && p.profileId ? p.profileId : undefined,
    serverUrl: p.serverUrl,
    title: typeof p.title === 'string' ? p.title : undefined,
    images,
    index: clampIndex(p.index, images.length),
    at: typeof p.at === 'number' ? p.at : 0,
  };
}

/** Two openers may answer one 「ready」; the newer click wins, a stale answer is ignored. */
export const isNewerPayload = (current: ImageWindowPayload | null, next: ImageWindowPayload): boolean =>
  !current || next.at >= current.at;

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** The bearer token only goes to the account's own `/api/files/…`. A payload pointing an authUri at
 *  any other host/path is refused, so a forged or mismatched payload cannot make the window send the
 *  token somewhere else. */
export function authorizedFileUrl(authUri: string, account: { serverUrl: string }): boolean {
  const base = trimSlash(account.serverUrl);
  if (!base || !authUri.startsWith(`${base}/api/files/`)) return false;
  return !authUri.slice(base.length).includes('..');
}

export const sameServer = (a: string, b: string): boolean => trimSlash(a) === trimSlash(b);

/** 「在浏览器打开」 only for plain remote urls — an authed hub file needs the bearer header the
 *  browser will not have (it would just show 401). */
export const canOpenInBrowser = (image: WindowImage | undefined): boolean =>
  !!image && !image.authUri && !!image.uri && /^https?:\/\//i.test(image.uri);

export const imageWindowTitle = (image: WindowImage | undefined, conversation?: string): string =>
  [image?.name, conversation, IMAGE_WINDOW_TITLE].filter(Boolean).join(' · ');

// ── window geometry (logical px) ───────────────────────────────────────────

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Toolbar strip under the image, in the window. */
export const IMAGE_WINDOW_TOOLBAR = 52;
export const IMAGE_WINDOW_MIN: Size = { width: 480, height: 360 };
/** 「fits the image within about 80% of the screen」. */
export const IMAGE_WINDOW_SCREEN_RATIO = 0.8;

/** Where a new window goes. A remembered rect wins if its centre is on the opener's screen (the
 *  user put it there); otherwise: image fitted into 80% of that screen, centred on it. Unknown image
 *  size → the whole 80% box. */
export function initialWindowRect(input: { screen: Rect; image?: Size | null; remembered?: Rect | null }): Rect {
  const { screen, remembered } = input;
  const maxW = Math.max(IMAGE_WINDOW_MIN.width, Math.floor(screen.width * IMAGE_WINDOW_SCREEN_RATIO));
  const maxH = Math.max(IMAGE_WINDOW_MIN.height, Math.floor(screen.height * IMAGE_WINDOW_SCREEN_RATIO));
  if (remembered && remembered.width > 0 && remembered.height > 0) {
    const cx = remembered.x + remembered.width / 2, cy = remembered.y + remembered.height / 2;
    const onScreen = cx >= screen.x && cx < screen.x + screen.width && cy >= screen.y && cy < screen.y + screen.height;
    if (onScreen) {
      const width = Math.round(Math.max(IMAGE_WINDOW_MIN.width, Math.min(screen.width, remembered.width)));
      const height = Math.round(Math.max(IMAGE_WINDOW_MIN.height, Math.min(screen.height, remembered.height)));
      // Screen got smaller since (or the rect was half off it): pull the window back onto it.
      const x = Math.round(Math.max(screen.x, Math.min(screen.x + screen.width - width, remembered.x)));
      const y = Math.round(Math.max(screen.y, Math.min(screen.y + screen.height - height, remembered.y)));
      return { x, y, width, height };
    }
  }
  let width = maxW, height = maxH;
  const img = input.image;
  if (img && img.width > 0 && img.height > 0) {
    const room = { width: maxW, height: maxH - IMAGE_WINDOW_TOOLBAR };
    const s = Math.min(1, room.width / img.width, room.height / img.height);
    width = Math.max(IMAGE_WINDOW_MIN.width, Math.round(img.width * s));
    height = Math.max(IMAGE_WINDOW_MIN.height, Math.round(img.height * s) + IMAGE_WINDOW_TOOLBAR);
  }
  return {
    x: Math.round(screen.x + (screen.width - width) / 2),
    y: Math.round(screen.y + (screen.height - height) / 2),
    width, height,
  };
}

export function parseRememberedRect(raw: string | null): Rect | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return [r?.x, r?.y, r?.width, r?.height].every(v => typeof v === 'number' && Number.isFinite(v)) && r.width > 0 && r.height > 0
      ? { x: r.x, y: r.y, width: r.width, height: r.height }
      : null;
  } catch { return null; }
}

// ── zoom / pan (inside the window) ─────────────────────────────────────────
// The image is drawn at natural * scale, its centre at viewport centre + (x, y).

export type View = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

export const WINDOW_MAX_SCALE = 8;
/** One wheel notch (deltaY ≈ 100) ≈ ×1.16. */
const WHEEL_SENSITIVITY = 0.0015;

/** Fit = whole image visible, never upscaled past 100%. */
export function fitScale(natural: Size, viewport: Size): number {
  if (!(natural.width > 0 && natural.height > 0 && viewport.width > 0 && viewport.height > 0)) return 1;
  return Math.min(1, viewport.width / natural.width, viewport.height / natural.height);
}

export const fitView = (natural: Size, viewport: Size): View => ({ scale: fitScale(natural, viewport), x: 0, y: 0 });

const minScale = (natural: Size, viewport: Size) => Math.min(fitScale(natural, viewport), 1) / 4;

/** Keep the image from being dragged away: along an axis where it is smaller than the viewport it
 *  stays centred; where it is larger its edge may not come inside the viewport edge. */
export function clampView(v: View, natural: Size, viewport: Size): View {
  const scale = Math.max(minScale(natural, viewport), Math.min(WINDOW_MAX_SCALE, v.scale));
  const bx = Math.max(0, (natural.width * scale - viewport.width) / 2);
  const by = Math.max(0, (natural.height * scale - viewport.height) / 2);
  return { scale, x: Math.max(-bx, Math.min(bx, v.x)), y: Math.max(-by, Math.min(by, v.y)) };
}

/** Zoom by `factor` keeping the image point under `at` (relative to the viewport centre) under it. */
export function zoomAt(v: View, factor: number, at: Point, natural: Size, viewport: Size): View {
  if (!(factor > 0) || !Number.isFinite(factor)) return v;
  const target = clampView({ ...v, scale: v.scale * factor }, natural, viewport).scale;
  const k = target / v.scale;
  return clampView({ scale: target, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, natural, viewport);
}

/** Mouse wheel: up (deltaY < 0) zooms in, towards the cursor. */
export const wheelZoom = (v: View, deltaY: number, at: Point, natural: Size, viewport: Size): View =>
  zoomAt(v, Math.exp(-deltaY * WHEEL_SENSITIVITY), at, natural, viewport);

export const panView = (base: View, dx: number, dy: number, natural: Size, viewport: Size): View =>
  clampView({ scale: base.scale, x: base.x + dx, y: base.y + dy }, natural, viewport);

/** Double-click: at fit → 100% around the cursor; anything else → fit. (An image that already fits at
 *  100% has nothing to toggle.) */
export function toggleFitActual(v: View, at: Point, natural: Size, viewport: Size): View {
  const fit = fitScale(natural, viewport);
  const atFit = Math.abs(v.scale - fit) < 1e-3 && Math.abs(v.x) < 0.5 && Math.abs(v.y) < 0.5;
  if (!atFit) return fitView(natural, viewport);
  if (Math.abs(fit - 1) < 1e-3) return fitView(natural, viewport);
  return zoomAt(v, 1 / v.scale, at, natural, viewport);
}

export const zoomPercent = (v: View): string => `${Math.round(v.scale * 100)}%`;

// ── keys ───────────────────────────────────────────────────────────────────

export type WindowKeyAction = 'close' | 'prev' | 'next' | 'copy' | 'fit' | 'actual' | 'zoomIn' | 'zoomOut' | null;

/** Esc closes the window, ←/→ step, Ctrl/⌘+C copies, 0 fit, 1 100%, +/- zoom. */
export function windowKeyAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): WindowKeyAction {
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod && (e.key === 'c' || e.key === 'C')) return 'copy';
  if (mod || e.altKey) return null;
  if (e.key === 'Escape' || e.key === 'Esc') return 'close';
  if (e.key === 'ArrowLeft') return 'prev';
  if (e.key === 'ArrowRight') return 'next';
  if (e.key === '0') return 'fit';
  if (e.key === '1') return 'actual';
  if (e.key === '+' || e.key === '=') return 'zoomIn';
  if (e.key === '-' || e.key === '_') return 'zoomOut';
  return null;
}
