// Pure model for the chat image preview (ImageViewer.tsx). No RN imports so the
// ck-style test (image-viewer-model.test.ts) can run it directly.
//
// Owner report 2026-09-26: 「打开一个图片之后，之前那个返回手势是没有」 — the preview
// Modal had no onRequestClose, so Android's back gesture was swallowed by the
// Modal's dialog and nothing closed. The back wiring itself lives in the
// component; what is testable here is everything the gestures decide.

/** One image of the message the preview was opened from. */
export type ViewerImage = {
  key: string;
  name: string;
  /** Already-displayable uri (local file:, blob:, or an unauthenticated http url). */
  uri?: string;
  /** Hub file id: native resolves it with the authenticated download into cache. */
  fileId?: string;
  /** Authenticated hub url: the desktop (Tauri web) resolves it to an object URL. */
  authUri?: string;
  mime?: string;
  /** Offer 下载原图 for this image. */
  save?: boolean;
};

export type ViewerState = { images: ViewerImage[]; index: number };

export const clampIndex = (index: number, count: number): number =>
  count <= 0 ? 0 : Math.max(0, Math.min(count - 1, Math.trunc(index)));

/** WeChat does not wrap: swiping past the last image springs back. */
export const stepViewerIndex = (index: number, count: number, dir: 'prev' | 'next'): number =>
  clampIndex(index + (dir === 'next' ? 1 : -1), count);

/** 「2/7」; empty for a single image (nothing to count). */
export const viewerIndexLabel = (index: number, count: number): string =>
  count > 1 ? `${clampIndex(index, count) + 1}/${count}` : '';

/** Build the gallery for one message and point at the tapped image. The tapped
 *  image's already-resolved uri (object URL / cached file) replaces its source so
 *  the preview opens without a second download. */
export function openGallery(images: ViewerImage[], tappedKey: string, resolvedUri?: string): ViewerState {
  const found = images.findIndex(image => image.key === tappedKey);
  const index = found >= 0 ? found : 0;
  const list = images.length ? images.slice() : [];
  if (resolvedUri && list[index]) list[index] = { ...list[index], uri: resolvedUri };
  return { images: list, index: clampIndex(index, list.length) };
}

/** The subset of ChatScreen's AttachmentView the preview cares about. */
export type ViewableAttachment = { key: string; name: string; isImage: boolean; uri?: string; needsAuth?: boolean; mime?: string };

/** Which attachments the preview can page through, and how each one is resolved.
 *  Mirrors the thumbnail branches in ChatScreen.renderAttachment: plain web (no
 *  Tauri) cannot send the bearer header from an <img>, so authed images are not
 *  previewable there. */
export function viewerImageFor(a: ViewableAttachment, env: { os: string; tauri: boolean }): ViewerImage | null {
  if (!a.isImage || !a.uri) return null;
  if (!a.needsAuth) return { key: a.key, name: a.name, uri: a.uri };
  if (env.os === 'web') return env.tauri ? { key: a.key, name: a.name, authUri: a.uri, mime: a.mime, save: true } : null;
  return { key: a.key, name: a.name, fileId: a.key, mime: a.mime, save: true };
}

/** Desktop keyboard: Esc closes, ←/→ step. Anything else is left alone. */
export function viewerKeyAction(key: string): 'close' | 'prev' | 'next' | null {
  if (key === 'Escape' || key === 'Esc') return 'close';
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  return null;
}

// ── zoom ───────────────────────────────────────────────────────────────────
// Transform order in the component: translateX, translateY, scale — all about the
// viewport centre. x/y are therefore pixel offsets of the (scaled) image centre.

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
/** While pinching the user may overshoot a little either way; settle clamps it. */
const PINCH_UNDERSHOOT = 0.7;
const PINCH_OVERSHOOT = MAX_SCALE * 1.25;

export type Zoom = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const ZOOM_IDENTITY: Zoom = { scale: 1, x: 0, y: 0 };

export const isZoomed = (z: Zoom): boolean => z.scale > 1.01;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Largest |x| / |y| that keeps the scaled image covering the viewport edge. */
export function panBounds(scale: number, viewport: Size): Point {
  return {
    x: Math.max(0, (viewport.width * scale - viewport.width) / 2),
    y: Math.max(0, (viewport.height * scale - viewport.height) / 2),
  };
}

export function clampZoom(z: Zoom, viewport: Size): Zoom {
  const scale = clamp(z.scale, MIN_SCALE, MAX_SCALE);
  if (scale <= 1.01) return ZOOM_IDENTITY;
  const b = panBounds(scale, viewport);
  return { scale, x: clamp(z.x, -b.x, b.x), y: clamp(z.y, -b.y, b.y) };
}

export type ZoomAction =
  /** Two fingers: `base` = zoom when the pinch began; `startFocal`/`focal` are the
   *  finger midpoints (relative to the viewport centre) then and now. */
  | { type: 'pinch'; base: Zoom; ratio: number; startFocal: Point; focal: Point }
  /** One finger while zoomed. */
  | { type: 'pan'; base: Zoom; dx: number; dy: number; viewport: Size }
  /** Zoomed → back to fit; fit → DOUBLE_TAP_SCALE centred on the tapped point. */
  | { type: 'doubleTap'; point: Point; viewport: Size }
  /** Finger up: clamp scale into [1, MAX] and translation into bounds. */
  | { type: 'settle'; viewport: Size }
  | { type: 'reset' };

export function zoomReducer(state: Zoom, action: ZoomAction): Zoom {
  switch (action.type) {
    case 'pinch': {
      const { base, ratio, startFocal, focal } = action;
      if (!(ratio > 0) || !Number.isFinite(ratio)) return state;
      const scale = clamp(base.scale * ratio, PINCH_UNDERSHOOT, PINCH_OVERSHOOT);
      const k = scale / base.scale;
      // The image point under the fingers when the pinch began stays under them.
      return {
        scale,
        x: focal.x - (startFocal.x - base.x) * k,
        y: focal.y - (startFocal.y - base.y) * k,
      };
    }
    case 'pan': {
      const { base, dx, dy, viewport } = action;
      if (!isZoomed(base)) return state;
      const b = panBounds(base.scale, viewport);
      return { scale: base.scale, x: clamp(base.x + dx, -b.x, b.x), y: clamp(base.y + dy, -b.y, b.y) };
    }
    case 'doubleTap': {
      if (isZoomed(state)) return ZOOM_IDENTITY;
      const s = DOUBLE_TAP_SCALE;
      return clampZoom({ scale: s, x: -action.point.x * (s - 1), y: -action.point.y * (s - 1) }, action.viewport);
    }
    case 'settle':
      return clampZoom(state, action.viewport);
    case 'reset':
      return ZOOM_IDENTITY;
  }
}

// ── one-finger gesture outcome at fit scale ────────────────────────────────

export const SWIPE_DISTANCE_RATIO = 0.22;
export const SWIPE_VELOCITY = 0.5;
export const DISMISS_DISTANCE = 120;
export const DISMISS_VELOCITY = 0.8;
export const TAP_SLOP = 10;

/** Decide once, on the first real movement, whether this drag pages or dismisses. */
export function dragAxis(dx: number, dy: number): 'horizontal' | 'vertical' | null {
  if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return null;
  return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

export type ReleaseInput = {
  axis: 'horizontal' | 'vertical' | null;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  width: number;
  index: number;
  count: number;
};

export function releaseOutcome(r: ReleaseInput): 'next' | 'prev' | 'dismiss' | 'snap' {
  if (r.axis === 'horizontal') {
    const far = Math.abs(r.dx) > r.width * SWIPE_DISTANCE_RATIO || Math.abs(r.vx) > SWIPE_VELOCITY;
    if (!far) return 'snap';
    if (r.dx < 0 && r.index < r.count - 1) return 'next';
    if (r.dx > 0 && r.index > 0) return 'prev';
    return 'snap';
  }
  if (r.axis === 'vertical') {
    // Down only: an upward flick is not a dismiss (WeChat).
    if (r.dy > DISMISS_DISTANCE || (r.dy > TAP_SLOP && r.vy > DISMISS_VELOCITY)) return 'dismiss';
    return 'snap';
  }
  return 'snap';
}

// ── taps ───────────────────────────────────────────────────────────────────

export const DOUBLE_TAP_MS = 280;

/** A second tap within DOUBLE_TAP_MS and ~30px of the first is a double tap. */
export function isDoubleTap(prev: { at: number; x: number; y: number } | null, now: { at: number; x: number; y: number }): boolean {
  if (!prev) return false;
  return now.at - prev.at <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= 30;
}
