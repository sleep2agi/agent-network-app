import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { appFetch } from './app-fetch';
import { loadConfig, loadHubProfile } from './storage';
import { saveObjectUrlOriginal } from './AuthedWebThumb';
import { displayDownloadPath } from './desktop-download';
import { downloadImageObjectUrl } from './web-image-download';
import { openExternal } from './open-external';
import { copyImageBlob } from './image-clipboard';
import { stepViewerIndex, viewerIndexLabel } from './image-viewer-model';
import {
  IMAGE_WINDOW_TOOLBAR,
  authorizedFileUrl,
  canOpenInBrowser,
  fitView,
  imageWindowTitle,
  isNewerPayload,
  panView,
  parseImageWindowPayload,
  sameServer,
  toggleFitActual,
  wheelZoom,
  windowKeyAction,
  zoomAt,
  zoomPercent,
  type ImageWindowPayload,
  type Size,
  type View as ZoomView,
  type WindowImage,
} from './image-window-model';
import { closeCurrentWindow, setCurrentWindowTitle, subscribeImageWindow, trackWindowBounds } from './image-window';

/**
 * The 「图片预览」 window's page (`/?imageViewer=1`, desktop Tauri only — see image-window-model.ts
 * for why it exists and how it gets its images without a token in the URL).
 *
 * Mouse wheel zooms towards the cursor, drag pans, double-click toggles fit / 100%, ←/→ walk the
 * conversation's images, Ctrl/⌘+C copies the image, Esc closes the window.
 */
type Loaded = { objectUrl: string; natural: Size | null };

const BG = '#111113';

export default function ImageViewerWindow() {
  const [payload, setPayload] = useState<ImageWindowPayload | null>(null);
  const payloadRef = useRef<ImageWindowPayload | null>(null);
  const [index, setIndex] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const loadedRef = useRef<Record<string, Loaded>>({});
  loadedRef.current = loaded;
  const [loadError, setLoadError] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<ZoomView>({ scale: 1, x: 0, y: 0 });
  const [note, setNote] = useState<string | null>(null);

  const images = payload?.images ?? [];
  const current: WindowImage | undefined = images[index];
  const currentLoaded = current ? loaded[current.key] : undefined;
  const natural = currentLoaded?.natural ?? null;

  // ── receive payloads ──
  useEffect(() => {
    let off: (() => void) | undefined;
    let offBounds: (() => void) | undefined;
    let alive = true;
    void subscribeImageWindow({
      onShow: raw => {
        const next = parseImageWindowPayload(raw);
        if (!next || !isNewerPayload(payloadRef.current, next)) return;
        payloadRef.current = next;
        setPayload(next);
        setIndex(next.index);
      },
      onRevoke: raw => {
        const r = raw as { profileId?: string | null; serverUrl?: string } | null;
        const p = payloadRef.current;
        if (p && r && (r.profileId ?? undefined) === p.profileId && typeof r.serverUrl === 'string' && sameServer(r.serverUrl, p.serverUrl)) void closeCurrentWindow();
      },
    }).then(u => { if (alive) off = u; else u(); }).catch(error => console.warn('[image-window] subscribe failed', error));
    void trackWindowBounds().then(u => { if (alive) offBounds = u; else u(); }).catch(() => {});
    return () => { alive = false; off?.(); offBounds?.(); };
  }, []);

  // ── the account's token, loaded here from the credential store (never sent over the bus) ──
  const accountKey = payload ? `${payload.profileId ?? ''}\0${payload.serverUrl}` : '';
  useEffect(() => {
    setToken(null);
    setAccountError(null);
    if (!payload || !payload.images.some(i => i.authUri)) return;
    let alive = true;
    (payload.profileId ? loadHubProfile(payload.profileId) : loadConfig())
      .then(cfg => {
        if (!alive) return;
        if (!cfg || !sameServer(cfg.serverUrl, payload.serverUrl)) { setAccountError('账号已切换或已退出，无法加载图片'); return; }
        setToken(cfg.token);
      })
      .catch(error => { if (alive) setAccountError(`无法读取账号(${error instanceof Error ? error.message : String(error)})`); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  // Object URLs belong to this account's bytes: drop them all when the account changes / on close.
  useEffect(() => () => {
    for (const l of Object.values(loadedRef.current)) URL.revokeObjectURL(l.objectUrl);
    setLoaded({});
    setLoadError({});
  }, [accountKey]);

  // ── resolve the current image (and warm its neighbours) ──
  useEffect(() => {
    if (!payload) return;
    const wanted = [index, index + 1, index - 1].map(i => payload.images[i]).filter((i): i is WindowImage => !!i);
    let alive = true;
    for (const image of wanted) {
      if (loadedRef.current[image.key]) continue;
      let job: Promise<string>;
      if (image.authUri) {
        if (!token) continue;
        if (!authorizedFileUrl(image.authUri, payload)) { setLoadError(e => ({ ...e, [image.key]: '不是本账号的文件地址' })); continue; }
        job = downloadImageObjectUrl(appFetch, image.authUri, token, image.name, undefined, image.mime);
      } else if (image.uri) {
        // Plain url: no Authorization header goes to a third party (fetcher drops `init`).
        const plain = image.uri.startsWith('data:') ? (u: RequestInfo | URL) => fetch(u) : (u: RequestInfo | URL) => appFetch(u);
        job = downloadImageObjectUrl(plain, image.uri, '', image.name, undefined, image.mime);
      } else continue;
      job.then(async objectUrl => {
        if (!alive) { URL.revokeObjectURL(objectUrl); return; }
        const size = await naturalSize(objectUrl);
        setLoaded(prev => {
          if (prev[image.key]) { URL.revokeObjectURL(objectUrl); return prev; }
          return { ...prev, [image.key]: { objectUrl, natural: size } };
        });
      }).catch(error => { if (alive) setLoadError(e => ({ ...e, [image.key]: error instanceof Error ? error.message : String(error) })); });
    }
    return () => { alive = false; };
  }, [payload, index, token, attempt]);

  // Title follows the image.
  useEffect(() => {
    if (current) void setCurrentWindowTitle(imageWindowTitle(current, payload?.title)).catch(() => {});
  }, [current?.key, payload?.title]);

  // A new image (or a resize while at fit) starts / stays at fit.
  useLayoutEffect(() => {
    setNote(null);
    if (natural) setView(fitView(natural, viewport));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, natural?.width, natural?.height]);
  const prevViewport = useRef(viewport);
  useEffect(() => {
    const before = prevViewport.current;
    prevViewport.current = viewport;
    if (!natural) return;
    setView(v => {
      const wasFit = Math.abs(v.scale - fitView(natural, before).scale) < 1e-3 && !v.x && !v.y;
      return wasFit ? fitView(natural, viewport) : v;
    });
  }, [viewport.width, viewport.height]);

  // ── actions ──
  const live = useRef({ natural, viewport, view, count: images.length, index, current, currentLoaded });
  live.current = { natural, viewport, view, count: images.length, index, current, currentLoaded };

  const step = (dir: 'prev' | 'next') => {
    const { index: i, count } = live.current;
    const next = stepViewerIndex(i, count, dir);
    if (next !== i) setIndex(next);
  };
  const zoomBy = (factor: number) => {
    const { natural: n, viewport: vp } = live.current;
    if (n) setView(v => zoomAt(v, factor, { x: 0, y: 0 }, n, vp));
  };
  const fit = () => { const { natural: n, viewport: vp } = live.current; if (n) setView(fitView(n, vp)); };
  const actual = () => { const { natural: n, viewport: vp } = live.current; if (n) setView(v => zoomAt(v, 1 / v.scale, { x: 0, y: 0 }, n, vp)); };

  const copy = useCallback(async () => {
    const l = live.current.currentLoaded;
    if (!l) return;
    try {
      const blob = await (await fetch(l.objectUrl)).blob();
      await copyImageBlob(blob);
      setNote('✓ 已复制图片');
    } catch (error) {
      console.warn('[image-window] copy failed', error);
      setNote(`复制失败(${error instanceof Error ? error.message : String(error)})`);
    }
  }, []);
  const saveAs = async () => {
    const { current: c, currentLoaded: l } = live.current;
    if (!c || !l) return;
    try {
      const path = await saveObjectUrlOriginal(l.objectUrl, c.name);
      if (path) setNote(`✓ 已保存到 ${displayDownloadPath(path)}`);
    } catch (error) {
      setNote(`保存失败(${error instanceof Error ? error.message : String(error)})`);
    }
  };
  const openInBrowser = () => {
    const c = live.current.current;
    if (c?.uri && canOpenInBrowser(c)) void openExternal(c.uri).catch(error => setNote(`打开失败(${error instanceof Error ? error.message : String(error)})`));
  };

  // ── keyboard ──
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = windowKeyAction(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'close') void closeCurrentWindow();
      else if (action === 'prev' || action === 'next') step(action);
      else if (action === 'copy') void copy();
      else if (action === 'fit') fit();
      else if (action === 'actual') actual();
      else if (action === 'zoomIn') zoomBy(1.25);
      else if (action === 'zoomOut') zoomBy(0.8);
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── mouse: wheel zoom towards the cursor, drag to pan, double-click fit ↔ 100% ──
  const stageRef = useRef<any>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const el: HTMLElement | null = stageRef.current;
    if (!el?.addEventListener) return;
    const centred = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
    };
    const onWheel = (e: WheelEvent) => {
      const { natural: n, viewport: vp } = live.current;
      if (!n) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const at = centred(e);
      setView(v => wheelZoom(v, dy, at, n, vp));
    };
    let drag: { x: number; y: number; base: ZoomView } | null = null;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !live.current.natural) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, base: live.current.view };
      setDragging(true);
    };
    const onMove = (e: MouseEvent) => {
      const { natural: n, viewport: vp } = live.current;
      if (!drag || !n) return;
      setView(panView(drag.base, e.clientX - drag.x, e.clientY - drag.y, n, vp));
    };
    const onUp = () => { if (drag) { drag = null; setDragging(false); } };
    const onDbl = (e: MouseEvent) => {
      const { natural: n, viewport: vp } = live.current;
      if (!n) return;
      e.preventDefault();
      const at = centred(e);
      setView(v => toggleFitActual(v, at, n, vp));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onDown);
    el.addEventListener('dblclick', onDbl);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('dblclick', onDbl);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const label = viewerIndexLabel(index, images.length);
  const error = accountError ?? (current ? loadError[current.key] : undefined);
  const w = natural ? natural.width * view.scale : 0;
  const h = natural ? natural.height * view.scale : 0;
  const canPan = !!natural && (w > viewport.width + 0.5 || h > viewport.height + 0.5);

  return (
    <View style={styles.root} testID="image-window">
      <View
        ref={stageRef}
        style={[styles.stage, { cursor: canPan ? (dragging ? 'grabbing' : 'grab') : 'default' } as any]}
        testID="image-window-stage"
        onLayout={e => setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {currentLoaded && natural && viewport.width > 0 ? (
          <Image
            source={{ uri: currentLoaded.objectUrl }}
            accessibilityLabel={current?.name}
            testID="image-window-image"
            resizeMode="stretch"
            style={{
              position: 'absolute',
              width: w,
              height: h,
              left: viewport.width / 2 + view.x - w / 2,
              top: viewport.height / 2 + view.y - h / 2,
            }}
          />
        ) : error ? (
          <Pressable accessibilityRole="button" onPress={() => { setLoadError({}); setAttempt(a => a + 1); }} style={styles.center}>
            <Text style={styles.message}>{accountError ?? `图片加载失败(${error}) · 点击重试`}</Text>
          </Pressable>
        ) : (
          <View style={styles.center}>{payload ? <ActivityIndicator color="#fff" /> : <Text style={styles.message}>等待图片…</Text>}</View>
        )}
        {note ? <Text style={styles.note} testID="image-window-note">{note}</Text> : null}
      </View>

      <View style={styles.toolbar} testID="image-window-toolbar">
        <View style={styles.group}>
          <ToolButton icon="chevron-back" label="上一张 (←)" testID="image-window-prev" disabled={index <= 0} onPress={() => step('prev')} />
          <Text style={styles.index} testID="image-window-index">{label || '1/1'}</Text>
          <ToolButton icon="chevron-forward" label="下一张 (→)" testID="image-window-next" disabled={index >= images.length - 1} onPress={() => step('next')} />
        </View>
        <Text style={styles.name} numberOfLines={1} testID="image-window-name">{current?.name ?? ''}</Text>
        <View style={styles.group}>
          <ToolButton icon="remove" label="缩小" testID="image-window-zoom-out" disabled={!natural} onPress={() => zoomBy(0.8)} />
          <Pressable accessibilityRole="button" accessibilityLabel="适应窗口 / 100%" testID="image-window-zoom" onPress={() => (natural && Math.abs(view.scale - fitView(natural, viewport).scale) < 1e-3 ? actual() : fit())} style={styles.zoomPill}>
            <Text style={styles.zoomText}>{natural ? zoomPercent(view) : '—'}</Text>
          </Pressable>
          <ToolButton icon="add" label="放大" testID="image-window-zoom-in" disabled={!natural} onPress={() => zoomBy(1.25)} />
          <View style={styles.divider} />
          <ToolButton icon="copy-outline" label="复制图片 (Ctrl/⌘+C)" testID="image-window-copy" disabled={!currentLoaded} onPress={() => void copy()} />
          <TextButton label="另存为…" testID="image-window-save" disabled={!currentLoaded} onPress={() => void saveAs()} />
          {canOpenInBrowser(current) ? <TextButton label="在浏览器打开" testID="image-window-open-browser" onPress={openInBrowser} /> : null}
        </View>
      </View>
    </View>
  );
}

function naturalSize(uri: string): Promise<Size | null> {
  return new Promise(resolve => {
    Image.getSize(uri, (width, height) => resolve(width > 0 && height > 0 ? { width, height } : null), () => resolve(null));
  });
}

function ToolButton({ icon, label, testID, disabled, onPress }: { icon: string; label: string; testID: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={disabled} onPress={onPress}
      style={({ hovered }: any) => [styles.button, hovered && !disabled && styles.buttonHover, disabled && styles.disabled]}>
      <Ionicons name={icon as any} size={18} color="#e8e8ea" />
    </Pressable>
  );
}

function TextButton({ label, testID, disabled, onPress }: { label: string; testID: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={disabled} onPress={onPress}
      style={({ hovered }: any) => [styles.textButton, hovered && !disabled && styles.buttonHover, disabled && styles.disabled]}>
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const CONTROL = 32;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  stage: { flex: 1, overflow: 'hidden', backgroundColor: BG, userSelect: 'none' } as any,
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { color: '#c8c8cc', fontSize: 13 },
  note: { position: 'absolute', bottom: 12, alignSelf: 'center', color: '#fff', fontSize: 13, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', overflow: 'hidden' },
  toolbar: {
    height: IMAGE_WINDOW_TOOLBAR, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12,
    backgroundColor: '#1b1b1e', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2c2c30',
  },
  group: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  button: { width: CONTROL, height: CONTROL, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  buttonHover: { backgroundColor: 'rgba(255,255,255,0.1)' },
  disabled: { opacity: 0.35 },
  index: { minWidth: 48, height: CONTROL, lineHeight: CONTROL, textAlign: 'center', color: '#e8e8ea', fontSize: 13, fontVariant: ['tabular-nums'] },
  name: { flex: 1, minWidth: 0, height: CONTROL, lineHeight: CONTROL, color: '#a8a8ae', fontSize: 13, textAlign: 'center' },
  zoomPill: { minWidth: 56, height: CONTROL, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: '#e8e8ea', fontSize: 13, fontVariant: ['tabular-nums'] },
  divider: { width: StyleSheet.hairlineWidth, height: 18, marginHorizontal: 4, backgroundColor: '#3a3a40' },
  textButton: { height: CONTROL, paddingHorizontal: 10, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3a3a40' },
  textButtonLabel: { color: '#e8e8ea', fontSize: 13 },
});
