import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, PanResponder, Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { Text } from './ui-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons';
import { AttachmentFile, downloadAttachment } from './AuthedThumb';
import { saveObjectUrlOriginal } from './AuthedWebThumb';
import { appFetch } from './app-fetch';
import { displayDownloadPath } from './desktop-download';
import { downloadImageObjectUrl } from './web-image-download';
import {
  dragAxis,
  isDoubleTap,
  isZoomed,
  releaseOutcome,
  stepViewerIndex,
  TAP_SLOP,
  DOUBLE_TAP_MS,
  viewerIndexLabel,
  viewerKeyAction,
  ZOOM_IDENTITY,
  zoomReducer,
  type Point,
  type Size,
  type ViewerImage,
  type ViewerState,
  type Zoom,
  type ZoomAction,
} from './image-viewer-model';

/**
 * Full-screen chat image preview (WeChat-style).
 *
 * - Android back / edge-swipe and desktop Esc both arrive as the Modal's
 *   `onRequestClose` (RN's modal dialog swallows back before any BackHandler sees it,
 *   so a Modal without `onRequestClose` simply cannot be closed with back —
 *   the 2026-09-26 owner report).
 * - Pinch / double-tap zoom, pan while zoomed, swipe ←/→ between the message's
 *   images, swipe down to dismiss, single tap closes.
 * - Built on RN's own PanResponder + Animated: no native dependency (the app has
 *   neither gesture-handler nor reanimated), so it ships in the JS bundle and
 *   behaves the same on Android, iOS and the desktop web view.
 */
export default function ImageViewer({ state, onClose, serverUrl, token }: {
  state: ViewerState | null;
  onClose: () => void;
  serverUrl: string;
  token: string;
}) {
  const images = state?.images ?? [];
  const count = images.length;
  const [index, setIndex] = useState(state?.index ?? 0);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    setIndex(state?.index ?? 0);
    setResolved({});
  }, [state]);

  // ── animated values ──
  const trackX = useRef(new Animated.Value(0)).current;
  const dismissY = useRef(new Animated.Value(0)).current;
  const zs = useRef(new Animated.Value(1)).current;
  const zx = useRef(new Animated.Value(0)).current;
  const zy = useRef(new Animated.Value(0)).current;
  const zoomRef = useRef<Zoom>(ZOOM_IDENTITY);
  const applyZoom = (z: Zoom, animate: boolean) => {
    zoomRef.current = z;
    if (!animate) { zs.setValue(z.scale); zx.setValue(z.x); zy.setValue(z.y); return; }
    Animated.parallel([
      Animated.spring(zs, { toValue: z.scale, useNativeDriver: false, bounciness: 0 }),
      Animated.spring(zx, { toValue: z.x, useNativeDriver: false, bounciness: 0 }),
      Animated.spring(zy, { toValue: z.y, useNativeDriver: false, bounciness: 0 }),
    ]).start();
  };
  const dispatchZoom = (action: ZoomAction, animate: boolean) =>
    applyZoom(zoomReducer(zoomRef.current, action), animate);

  // A new page (or a new open) always starts at fit, centred, fully opaque.
  useLayoutEffect(() => {
    trackX.setValue(0);
    dismissY.setValue(0);
    applyZoom(ZOOM_IDENTITY, false);
    setSaveNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, state]);

  // Latest values for the (once-created) responder.
  const live = useRef({ index, count, viewport, onClose });
  live.current = { index, count, viewport, onClose };

  const GAP = 16;
  const go = (dir: 'prev' | 'next', animate = true) => {
    const { index: i, count: n, viewport: vp } = live.current;
    const next = stepViewerIndex(i, n, dir);
    if (next === i) {
      Animated.spring(trackX, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      return;
    }
    if (!animate || !vp.width) { setIndex(next); return; }
    const to = (dir === 'next' ? -1 : 1) * (vp.width + GAP);
    Animated.timing(trackX, { toValue: to, duration: 180, useNativeDriver: false }).start(() => setIndex(next));
  };
  const dismiss = () => {
    const h = live.current.viewport.height || 800;
    Animated.timing(dismissY, { toValue: h, duration: 160, useNativeDriver: false }).start(() => live.current.onClose());
  };

  // ── gestures ──
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);
  const g = useRef({
    mode: 'single' as 'single' | 'pinch' | 'pan',
    axis: null as 'horizontal' | 'vertical' | null,
    base: ZOOM_IDENTITY,
    startDist: 1,
    startFocal: { x: 0, y: 0 } as Point,
    origin: { dx: 0, dy: 0 },
    startedAt: 0,
    moved: false,
    multi: false,
  });
  const centred = (px: number, py: number): Point => ({
    x: px - live.current.viewport.width / 2,
    y: py - live.current.viewport.height / 2,
  });
  const touchesOf = (evt: GestureResponderEvent) => ((evt.nativeEvent as any).touches ?? []) as { pageX: number; pageY: number }[];

  const onTap = (px: number, py: number) => {
    const now = { at: Date.now(), x: px, y: py };
    if (isDoubleTap(lastTap.current, now)) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = null;
      dispatchZoom({ type: 'doubleTap', point: centred(px, py), viewport: live.current.viewport }, true);
      return;
    }
    lastTap.current = now;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapTimer.current = null; live.current.onClose(); }, DOUBLE_TAP_MS);
  };

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      Object.assign(g.current, {
        mode: 'single', axis: null, base: zoomRef.current, origin: { dx: 0, dy: 0 },
        startedAt: Date.now(), moved: false, multi: false,
      });
    },
    onPanResponderMove: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
      const s = g.current;
      const touches = touchesOf(evt);
      const vp = live.current.viewport;
      if (Math.abs(gs.dx) > TAP_SLOP || Math.abs(gs.dy) > TAP_SLOP) s.moved = true;
      if (touches.length >= 2) {
        const [a, b] = touches;
        const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
        const focal = centred((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2);
        if (s.mode !== 'pinch') {
          // Second finger landed: whatever the first finger was doing is undone.
          s.mode = 'pinch';
          s.multi = true;
          s.moved = true;
          s.base = zoomRef.current;
          s.startDist = dist;
          s.startFocal = focal;
          trackX.setValue(0);
          dismissY.setValue(0);
          return;
        }
        applyZoom(zoomReducer(zoomRef.current, { type: 'pinch', base: s.base, ratio: dist / s.startDist, startFocal: s.startFocal, focal }), false);
        return;
      }
      if (s.mode === 'pinch') {
        // One finger lifted: continue as a pan from here.
        s.mode = 'pan';
        s.base = zoomRef.current;
        s.origin = { dx: gs.dx, dy: gs.dy };
        return;
      }
      if (s.mode === 'pan' || isZoomed(s.base)) {
        s.mode = 'pan';
        applyZoom(zoomReducer(zoomRef.current, { type: 'pan', base: s.base, dx: gs.dx - s.origin.dx, dy: gs.dy - s.origin.dy, viewport: vp }), false);
        return;
      }
      if (s.multi) return; // a pinch that went back to fit: never turn into a swipe
      s.axis = s.axis ?? dragAxis(gs.dx, gs.dy);
      if (s.axis === 'horizontal') {
        const { index: i, count: n } = live.current;
        const atEdge = (gs.dx > 0 && i === 0) || (gs.dx < 0 && i === n - 1);
        trackX.setValue(atEdge ? gs.dx * 0.3 : gs.dx);
      } else if (s.axis === 'vertical') {
        dismissY.setValue(Math.max(0, gs.dy));
      }
    },
    onPanResponderRelease: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
      const s = g.current;
      const vp = live.current.viewport;
      if (!s.moved && Date.now() - s.startedAt < 350) {
        const ne = evt.nativeEvent as any;
        onTap(ne.pageX ?? gs.x0, ne.pageY ?? gs.y0);
        return;
      }
      if (s.mode !== 'single' || isZoomed(zoomRef.current)) {
        dispatchZoom({ type: 'settle', viewport: vp }, true);
        return;
      }
      const outcome = releaseOutcome({
        axis: s.axis, dx: gs.dx, dy: gs.dy, vx: gs.vx, vy: gs.vy,
        width: vp.width, index: live.current.index, count: live.current.count,
      });
      if (outcome === 'next' || outcome === 'prev') go(outcome);
      else if (outcome === 'dismiss') dismiss();
      else {
        Animated.spring(trackX, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        Animated.spring(dismissY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      }
    },
    onPanResponderTerminate: () => {
      dispatchZoom({ type: 'settle', viewport: live.current.viewport }, true);
      Animated.spring(trackX, { toValue: 0, useNativeDriver: false }).start();
      Animated.spring(dismissY, { toValue: 0, useNativeDriver: false }).start();
    },
  })).current;

  // Desktop: ←/→ step between images. Esc is the Modal's onRequestClose
  // (react-native-web routes Escape there), so it is not handled twice here.
  const visible = !!state && count > 0;
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!visible || Platform.OS !== 'web' || !doc?.addEventListener) return;
    const onKeyDown = (event: any) => {
      const action = viewerKeyAction(event.key);
      if (action === 'prev' || action === 'next') { event.preventDefault?.(); go(action, false); }
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const current = images[index];
  const currentUri = current ? (current.uri ?? resolved[current.key]) : undefined;
  const label = viewerIndexLabel(index, count);
  const backdropOpacity = dismissY.interpolate({ inputRange: [0, Math.max(1, viewport.height)], outputRange: [1, 0.15], extrapolate: 'clamp' });
  const pages = [index - 1, index, index + 1].filter(i => i >= 0 && i < count);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={styles.root}
        testID="image-viewer"
        onLayout={e => setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
        <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: trackX }] }]}>
            {viewport.width > 0 ? pages.map(i => {
              const image = images[i];
              const isCurrent = i === index;
              return (
                <Animated.View
                  key={image.key}
                  style={[
                    styles.page,
                    { left: (i - index) * (viewport.width + GAP), width: viewport.width, height: viewport.height },
                    isCurrent ? { transform: [{ translateX: zx }, { translateY: Animated.add(zy, dismissY) }, { scale: zs }] } : null,
                  ]}
                >
                  <ViewerPage
                    image={image}
                    serverUrl={serverUrl}
                    token={token}
                    onResolved={uri => setResolved(prev => (prev[image.key] === uri ? prev : { ...prev, [image.key]: uri }))}
                  />
                </Animated.View>
              );
            }) : null}
          </Animated.View>
        </View>

        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          {label ? <Text style={styles.index} testID="image-viewer-index" accessibilityLiveRegion="polite">{label}</Text> : <View />}
          <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" hitSlop={10} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>

        {Platform.OS === 'web' && count > 1 ? (
          <>
            {index > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="上一张" style={[styles.arrow, styles.arrowLeft]} onPress={() => go('prev', false)}>
                <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            ) : null}
            {index < count - 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="下一张" style={[styles.arrow, styles.arrowRight]} onPress={() => go('next', false)}>
                <Ionicons name="chevron-forward" size={26} color="#fff" />
              </Pressable>
            ) : null}
          </>
        ) : null}

        {current?.save ? (
          <View style={[styles.bottomBar, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
            {Platform.OS === 'web' ? (
              currentUri ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`下载 ${current.name}`}
                  hitSlop={8}
                  onPress={(e: any) => {
                    saveObjectUrlOriginal(currentUri, current.name, !!(e?.nativeEvent?.altKey ?? e?.altKey))
                      .then(path => setSaveNote(path ? `✓ 已保存到 ${displayDownloadPath(path)}` : null))
                      .catch(reason => setSaveNote(`保存失败(${reason instanceof Error ? reason.message : String(reason)})`));
                  }}
                >
                  <Text style={styles.save}>{saveNote ?? '↓ 下载原图'}</Text>
                </Pressable>
              ) : null
            ) : current.fileId ? (
              <View style={styles.savePill}>
                <AttachmentFile fileId={current.fileId} name={current.name} mime={current.mime} serverUrl={serverUrl} token={token} label="下载原图" />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** One page: shows `image.uri` if it has one, else resolves it (native: authed
 *  download into the cache; desktop web: authed fetch → object URL, revoked on unmount). */
function ViewerPage({ image, serverUrl, token, onResolved }: {
  image: ViewerImage;
  serverUrl: string;
  token: string;
  onResolved: (uri: string) => void;
}) {
  const [uri, setUri] = useState<string | null>(image.uri ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (image.uri) { setUri(image.uri); return; }
    let alive = true;
    let allocated: string | null = null;
    setUri(null);
    setError(null);
    const job = Platform.OS === 'web'
      ? (image.authUri ? downloadImageObjectUrl(appFetch, image.authUri, token, image.name, undefined, image.mime) : Promise.reject(new Error('no source')))
      : (image.fileId ? downloadAttachment(serverUrl, token, image.fileId, image.name, image.mime) : Promise.reject(new Error('no source')));
    job.then(u => {
      if (Platform.OS === 'web') allocated = u;
      if (!alive) { if (allocated) URL.revokeObjectURL(allocated); return; }
      setUri(u);
      onResolved(u);
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => {
      alive = false;
      if (allocated) URL.revokeObjectURL(allocated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.key, image.uri, serverUrl, token, attempt]);

  if (uri) return <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityLabel={image.name} />;
  if (error) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${image.name} 加载失败，点击重试`} onPress={() => setAttempt(a => a + 1)} style={styles.center}>
        <Text style={styles.errorText}>图片加载失败 · 点击重试</Text>
      </Pressable>
    );
  }
  return <View style={styles.center}><ActivityIndicator color="#fff" /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  page: { position: 'absolute', top: 0, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  center: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#fff', fontSize: 13 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  index: { color: '#fff', fontSize: 15, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', overflow: 'hidden' },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  arrow: { position: 'absolute', top: '50%', marginTop: -24, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  arrowLeft: { left: 16 },
  arrowRight: { right: 16 },
  bottomBar: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  save: { color: '#fff', fontSize: 13, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(0,0,0,0.45)', overflow: 'hidden' },
  savePill: { paddingVertical: 2, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(0,0,0,0.45)' },
});
