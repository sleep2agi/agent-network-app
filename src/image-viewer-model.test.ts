// ck-style (self-executing; run by scripts/run-tests.mjs). Pure model of the chat
// image preview: index/navigation, gallery building, desktop keys, zoom reducer,
// swipe/dismiss outcome, double-tap detection.
import { strict as assert } from 'node:assert';

const m = await import('./image-viewer-model');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const VP = { width: 400, height: 800 };

// ── index / navigation ─────────────────────────────────────────────────────
check(m.viewerIndexLabel(1, 5) === '2/5', 'label is 1-based: index 1 of 5 → 2/5');
check(m.viewerIndexLabel(6, 7) === '7/7', 'last of 7 → 7/7');
check(m.viewerIndexLabel(0, 1) === '', 'single image: no counter');
check(m.viewerIndexLabel(9, 3) === '3/3', 'out-of-range index is clamped in the label');
check(m.stepViewerIndex(1, 5, 'next') === 2 && m.stepViewerIndex(1, 5, 'prev') === 0, 'next/prev step by one');
check(m.stepViewerIndex(4, 5, 'next') === 4, 'next on the last image stays (no wrap, WeChat)');
check(m.stepViewerIndex(0, 5, 'prev') === 0, 'prev on the first image stays (no wrap)');
check(m.stepViewerIndex(0, 0, 'next') === 0, 'empty gallery: index 0, no NaN');
check(m.clampIndex(-3, 4) === 0 && m.clampIndex(10, 4) === 3 && m.clampIndex(1.7, 4) === 1, 'clampIndex bounds + truncation');

// ── gallery ────────────────────────────────────────────────────────────────
{
  const imgs = ['a', 'b', 'c', 'd', 'e'].map(k => ({ key: k, name: `${k}.png`, fileId: k, save: true }));
  const g = m.openGallery(imgs, 'b', 'file:///cache/b.png');
  check(g.index === 1 && g.images.length === 5, 'opens at the tapped image');
  check(g.images[1].uri === 'file:///cache/b.png', "tapped image reuses the thumbnail's resolved uri");
  check(imgs[1].uri === undefined as any, 'input gallery is not mutated');
  check(g.images[0].uri === undefined && g.images[2].fileId === 'c', 'other images keep their source for lazy resolve');
  check(m.openGallery(imgs, 'zzz').index === 0, 'unknown key falls back to the first image');
  check(m.openGallery([], 'a').images.length === 0, 'empty gallery stays empty');
}
{
  const native = { os: 'android', tauri: false };
  const tauri = { os: 'web', tauri: true };
  const browser = { os: 'web', tauri: false };
  const authed = { key: 'f1', name: 'x.png', isImage: true, uri: 'https://hub/api/files/f1', needsAuth: true, mime: 'image/png' };
  const local = { key: 'l1', name: 'y.png', isImage: true, uri: 'file:///y.png' };
  const n = m.viewerImageFor(authed, native);
  check(!!n && n.fileId === 'f1' && !n.uri && n.save === true, 'native authed image: resolve by fileId, offer 下载原图');
  const t = m.viewerImageFor(authed, tauri);
  check(!!t && t.authUri === authed.uri && !t.fileId && t.save === true, 'desktop authed image: resolve by authed url, offer 下载原图');
  check(m.viewerImageFor(authed, browser) === null, 'plain browser cannot preview authed images (no bearer on <img>)');
  const l = m.viewerImageFor(local, native);
  check(!!l && l.uri === 'file:///y.png' && !l.save, 'local echo: direct uri, nothing to download');
  check(m.viewerImageFor({ ...local, isImage: false }, native) === null, 'non-images are not in the gallery');
  check(m.viewerImageFor({ ...local, uri: undefined }, native) === null, 'no uri → not previewable');
}

// ── desktop keys ───────────────────────────────────────────────────────────
check(m.viewerKeyAction('Escape') === 'close', 'Esc closes');
check(m.viewerKeyAction('ArrowLeft') === 'prev' && m.viewerKeyAction('ArrowRight') === 'next', '←/→ navigate');
check(m.viewerKeyAction('a') === null && m.viewerKeyAction('ArrowUp') === null, 'other keys ignored');

// ── zoom reducer ───────────────────────────────────────────────────────────
{
  const I = m.ZOOM_IDENTITY;
  // pinch about the centre doubles the scale, no translation
  const p = m.zoomReducer(I, { type: 'pinch', base: I, ratio: 2, startFocal: { x: 0, y: 0 }, focal: { x: 0, y: 0 } });
  check(near(p.scale, 2) && near(p.x, 0) && near(p.y, 0), 'pinch ×2 at centre');
  // pinch about an off-centre point keeps that point under the fingers
  const off = m.zoomReducer(I, { type: 'pinch', base: I, ratio: 2, startFocal: { x: 100, y: 50 }, focal: { x: 100, y: 50 } });
  check(near(off.x, -100) && near(off.y, -50), 'focal point stays fixed: x = f - f*2');
  // image point under focal: (f - x)/scale must equal the original (f - 0)/1
  check(near((100 - off.x) / off.scale, 100), 'content point under the fingers is invariant');
  // moving fingers while pinching drags too
  const mv = m.zoomReducer(I, { type: 'pinch', base: I, ratio: 1, startFocal: { x: 0, y: 0 }, focal: { x: 30, y: -20 } });
  check(near(mv.x, 30) && near(mv.y, -20), 'two-finger drag translates');
  check(m.zoomReducer(p, { type: 'pinch', base: I, ratio: 0, startFocal: { x: 0, y: 0 }, focal: { x: 0, y: 0 } }) === p, 'ratio 0 is ignored');
  check(m.zoomReducer(p, { type: 'pinch', base: I, ratio: NaN, startFocal: { x: 0, y: 0 }, focal: { x: 0, y: 0 } }) === p, 'NaN ratio is ignored');
  const huge = m.zoomReducer(I, { type: 'pinch', base: I, ratio: 50, startFocal: { x: 0, y: 0 }, focal: { x: 0, y: 0 } });
  check(huge.scale <= m.MAX_SCALE * 1.25 + 1e-9, 'pinch overshoot is bounded while fingers are down');

  // settle clamps
  const s1 = m.zoomReducer(huge, { type: 'settle', viewport: VP });
  check(near(s1.scale, m.MAX_SCALE), 'settle clamps scale to MAX_SCALE');
  const small = m.zoomReducer(I, { type: 'pinch', base: I, ratio: 0.5, startFocal: { x: 0, y: 0 }, focal: { x: 40, y: 0 } });
  check(small.scale < 1, 'pinch-in may go below 1 while fingers are down');
  const s2 = m.zoomReducer(small, { type: 'settle', viewport: VP });
  check(s2.scale === 1 && s2.x === 0 && s2.y === 0, 'settle below 1 snaps back to fit, centred');
  const barely = m.zoomReducer({ scale: 1.005, x: 3, y: 3 }, { type: 'settle', viewport: VP });
  check(barely.scale === 1 && barely.x === 0 && barely.y === 0, 'settle just above 1 (not isZoomed) snaps to exact fit, so the next drag pages instead of panning');
  const far = { scale: 2, x: 5000, y: -5000 };
  const s3 = m.zoomReducer(far, { type: 'settle', viewport: VP });
  // bounds at scale 2 on 400x800: x ±200, y ±400
  check(near(s3.x, 200) && near(s3.y, -400), 'settle clamps translation to the image edge');

  // pan only while zoomed, clamped
  check(m.zoomReducer(I, { type: 'pan', base: I, dx: 50, dy: 50, viewport: VP }) === I, 'pan at fit is a no-op (that drag pages/dismisses instead)');
  const z2 = { scale: 2, x: 0, y: 0 };
  const pan = m.zoomReducer(z2, { type: 'pan', base: z2, dx: 150, dy: -60, viewport: VP });
  check(near(pan.x, 150) && near(pan.y, -60) && near(pan.scale, 2), 'pan moves the zoomed image');
  const panFar = m.zoomReducer(z2, { type: 'pan', base: z2, dx: 999, dy: 999, viewport: VP });
  check(near(panFar.x, 200) && near(panFar.y, 400), 'pan cannot drag the image edge past the viewport');

  // double tap
  const dt = m.zoomReducer(I, { type: 'doubleTap', point: { x: 100, y: 0 }, viewport: VP });
  check(near(dt.scale, m.DOUBLE_TAP_SCALE), 'double tap at fit zooms to DOUBLE_TAP_SCALE');
  check(dt.x < 0, 'double tap right of centre shifts the image left (tapped point moves towards centre)');
  check(near(dt.x, -100 * (m.DOUBLE_TAP_SCALE - 1)), 'double tap: tapped point ends at the centre');
  const dtCorner = m.zoomReducer(I, { type: 'doubleTap', point: { x: 5000, y: 5000 }, viewport: VP });
  const b = m.panBounds(m.DOUBLE_TAP_SCALE, VP);
  check(near(dtCorner.x, -b.x) && near(dtCorner.y, -b.y), 'double tap near an edge stays within bounds');
  const back = m.zoomReducer(dt, { type: 'doubleTap', point: { x: 0, y: 0 }, viewport: VP });
  check(back.scale === 1 && back.x === 0 && back.y === 0, 'double tap while zoomed returns to fit');
  check(m.zoomReducer(dt, { type: 'reset' }) === m.ZOOM_IDENTITY, 'reset → identity');
  check(!m.isZoomed(I) && m.isZoomed(dt), 'isZoomed');
}

// ── one-finger release outcome at fit ──────────────────────────────────────
{
  const base = { dx: 0, dy: 0, vx: 0, vy: 0, width: 400, index: 1, count: 3 };
  check(m.dragAxis(3, 4) === null, 'within tap slop: no axis yet');
  check(m.dragAxis(-40, 10) === 'horizontal' && m.dragAxis(5, 40) === 'vertical', 'axis locks to the dominant direction');
  check(m.releaseOutcome({ ...base, axis: 'horizontal', dx: -120 }) === 'next', 'swipe left past 22% → next');
  check(m.releaseOutcome({ ...base, axis: 'horizontal', dx: 120 }) === 'prev', 'swipe right past 22% → prev');
  check(m.releaseOutcome({ ...base, axis: 'horizontal', dx: -30 }) === 'snap', 'short slow swipe snaps back');
  check(m.releaseOutcome({ ...base, axis: 'horizontal', dx: -30, vx: -1.2 }) === 'next', 'short fast flick pages');
  check(m.releaseOutcome({ ...base, axis: 'horizontal', dx: -300, index: 2 }) === 'snap', 'no next on the last image');
  check(m.releaseOutcome({ ...base, axis: 'horizontal', dx: 300, index: 0 }) === 'snap', 'no prev on the first image');
  check(m.releaseOutcome({ ...base, axis: 'vertical', dy: 200 }) === 'dismiss', 'swipe down far → dismiss');
  check(m.releaseOutcome({ ...base, axis: 'vertical', dy: 40, vy: 1.5 }) === 'dismiss', 'fast downward flick → dismiss');
  check(m.releaseOutcome({ ...base, axis: 'vertical', dy: -300, vy: -2 }) === 'snap', 'swipe up never dismisses');
  check(m.releaseOutcome({ ...base, axis: 'vertical', dy: 60 }) === 'snap', 'short slow drag down snaps back');
  check(m.releaseOutcome({ ...base, axis: null, dx: -300 }) === 'snap', 'no axis → snap');
}

// ── double tap detection ───────────────────────────────────────────────────
check(!m.isDoubleTap(null, { at: 1000, x: 0, y: 0 }), 'first tap is not a double');
check(m.isDoubleTap({ at: 1000, x: 10, y: 10 }, { at: 1200, x: 20, y: 15 }), 'second tap close in time and space → double');
check(!m.isDoubleTap({ at: 1000, x: 10, y: 10 }, { at: 1000 + m.DOUBLE_TAP_MS + 1, x: 10, y: 10 }), 'too slow → two singles');
check(!m.isDoubleTap({ at: 1000, x: 10, y: 10 }, { at: 1100, x: 200, y: 10 }), 'too far apart → two singles');

console.log(`image viewer model: ${ck}/${ck} checks passed`);
