// Desktop 「图片预览」 window: the Tauri half. The pure half (payload, geometry, zoom) is
// image-window-model.ts; the page itself is ImageViewerWindow.tsx.
//
// Opener side (any chat window): openImageWindow(payload) → true when the window shows it, false
// when it could not (the caller then falls back to the in-app ImageViewer and nothing is lost).
// One label (IMAGE_WINDOW_LABEL): if the window is already open it is sent the new payload and
// focused; otherwise it is created at /?imageViewer=1 and, once its page is up, it asks for the
// payload (READY) and the opener answers (SHOW). The payload never carries a token.

import {
  IMAGE_WINDOW_BOUNDS_KEY,
  IMAGE_WINDOW_CLOSE_EVENT,
  IMAGE_WINDOW_LABEL,
  IMAGE_WINDOW_MIN,
  IMAGE_WINDOW_READY_EVENT,
  IMAGE_WINDOW_SHOW_EVENT,
  IMAGE_WINDOW_TITLE,
  IMAGE_WINDOW_URL,
  initialWindowRect,
  parseRememberedRect,
  type ImageWindowPayload,
  type Rect,
  type Size,
} from './image-window-model';

/** A payload stays answerable for this long after the click (the new window's page boot). */
const PENDING_TTL_MS = 20_000;
let pending: ImageWindowPayload | null = null;
let readyListener: Promise<void> | null = null;

const tauri = () => !!(globalThis as any).__TAURI_INTERNALS__;

/** Every opener window answers READY with its own latest click; the window keeps the newest. */
function ensureReadyListener(): Promise<void> {
  readyListener ??= (async () => {
    const { listen, emitTo } = await import('@tauri-apps/api/event');
    await listen(IMAGE_WINDOW_READY_EVENT, () => {
      if (!pending || Date.now() - pending.at > PENDING_TTL_MS) return;
      void emitTo(IMAGE_WINDOW_LABEL, IMAGE_WINDOW_SHOW_EVENT, pending).catch(error => console.warn('[image-window] answer ready failed', error));
    });
  })().catch(error => { readyListener = null; throw error; });
  return readyListener;
}

function rememberedRect(): Rect | null {
  try { return typeof localStorage === 'undefined' ? null : parseRememberedRect(localStorage.getItem(IMAGE_WINDOW_BOUNDS_KEY)); } catch { return null; }
}

/** Natural size of an image the opener can already read (the thumbnail's object URL); null if it
 *  does not load quickly — the window then opens at the 80% box. */
function measureImage(uri: string | undefined, timeoutMs = 400): Promise<Size | null> {
  const Img = (globalThis as any).Image;
  if (!uri || typeof Img !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Img();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = uri;
  });
}

/** The opener's screen in logical px (work area when the platform reports one). */
async function openerScreen(): Promise<Rect | null> {
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const monitor = await currentMonitor();
    if (!monitor) return null;
    const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
    const f = monitor.scaleFactor || 1;
    return { x: area.position.x / f, y: area.position.y / f, width: area.size.width / f, height: area.size.height / f };
  } catch {
    return null;
  }
}

/**
 * Show `payload` in the 「图片预览」 window. Resolves false (after logging why) when the window
 * could not be reached or created — the caller shows the in-app viewer instead.
 */
export async function openImageWindow(payload: ImageWindowPayload, opts: { measureUri?: string } = {}): Promise<boolean> {
  if (!tauri()) return false;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { emitTo } = await import('@tauri-apps/api/event');
    pending = payload;
    await ensureReadyListener();
    const existing = await WebviewWindow.getByLabel(IMAGE_WINDOW_LABEL);
    if (existing) {
      // Page already up → it gets this directly; still booting → it will send READY and get `pending`.
      await emitTo(IMAGE_WINDOW_LABEL, IMAGE_WINDOW_SHOW_EVENT, payload);
      await existing.unminimize().catch(() => {});
      await existing.show();
      await existing.setFocus();
      return true;
    }
    const [screen, image] = await Promise.all([openerScreen(), measureImage(opts.measureUri)]);
    const rect = screen ? initialWindowRect({ screen, image, remembered: rememberedRect() }) : null;
    const win = new WebviewWindow(IMAGE_WINDOW_LABEL, {
      url: IMAGE_WINDOW_URL,
      title: IMAGE_WINDOW_TITLE,
      ...(rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : { width: 1000, height: 760, center: true }),
      minWidth: IMAGE_WINDOW_MIN.width,
      minHeight: IMAGE_WINDOW_MIN.height,
      resizable: true,
      maximizable: true,
      focus: true,
      backgroundColor: '#111113',
      // Native title bar on both platforms (move / maximize / close are the system's) — the viewer
      // page draws no title bar of its own.
      dragDropEnabled: false,
    });
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      void win.once('tauri://created', () => done(true));
      void win.once('tauri://error', event => {
        console.warn('[image-window] create failed, using the in-app viewer', event?.payload ?? event);
        done(false);
      });
    });
  } catch (error) {
    console.warn('[image-window] unavailable, using the in-app viewer', error);
    return false;
  }
}

/** Account/credential scope changed in an opener: the window must not keep showing bytes it fetched
 *  for that account (same boundary as the in-app viewer's reset in ChatScreen). */
export async function closeImageWindowFor(account: { profileId?: string; serverUrl: string }): Promise<void> {
  if (!tauri()) return;
  try {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(IMAGE_WINDOW_LABEL, IMAGE_WINDOW_CLOSE_EVENT, { profileId: account.profileId ?? null, serverUrl: account.serverUrl });
  } catch { /* window not open */ }
}

// ── window side ────────────────────────────────────────────────────────────

/** Subscribe to SHOW / CLOSE, then announce READY. Returns the unsubscribe. */
export async function subscribeImageWindow(handlers: {
  onShow: (raw: unknown) => void;
  onRevoke: (raw: unknown) => void;
}): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const { emit } = await import('@tauri-apps/api/event');
  const self = getCurrentWebviewWindow();
  const offShow = await self.listen(IMAGE_WINDOW_SHOW_EVENT, event => handlers.onShow(event.payload));
  const offClose = await self.listen(IMAGE_WINDOW_CLOSE_EVENT, event => handlers.onRevoke(event.payload));
  await emit(IMAGE_WINDOW_READY_EVENT, { label: self.label });
  return () => { offShow(); offClose(); };
}

export async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

export async function setCurrentWindowTitle(title: string): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

/** Save this window's size and position (logical px) after the user moves/resizes it; skipped
 *  while maximized/minimized so 「restore」 is what is remembered. */
export async function trackWindowBounds(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        if (await win.isMaximized() || await win.isMinimized()) return;
        const f = await win.scaleFactor();
        const pos = (await win.outerPosition()).toLogical(f);
        const size = (await win.innerSize()).toLogical(f);
        localStorage.setItem(IMAGE_WINDOW_BOUNDS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y), width: Math.round(size.width), height: Math.round(size.height) }));
      } catch { /* storage or window API unavailable: nothing to remember */ }
    }, 400);
  };
  const offMoved = await win.onMoved(save);
  const offResized = await win.onResized(save);
  return () => { if (timer) clearTimeout(timer); offMoved(); offResized(); };
}
