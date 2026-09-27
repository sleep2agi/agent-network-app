// ck-style (self-executing; run by scripts/run-tests.mjs). The desktop 「图片预览」 window:
// which surface a click opens, the payload (and that it never carries a token), the conversation
// gallery + navigation index, window geometry, zoom/pan, keys, and the opener's window reuse
// (openImageWindow against a stubbed Tauri bridge).
import * as m from './image-window-model';
import { stepViewerIndex, viewerIndexLabel, type ViewerImage } from './image-viewer-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, detail = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ── platform branch ────────────────────────────────────────────────────────
ck('desktop (Tauri web view) → separate window', m.imagePreviewSurface({ os: 'web', tauri: true }) === 'window');
ck('phone (android) → in-app viewer', m.imagePreviewSurface({ os: 'android', tauri: false }) === 'in-app');
ck('phone (ios) → in-app viewer', m.imagePreviewSurface({ os: 'ios', tauri: false }) === 'in-app');
ck('plain web build → in-app viewer', m.imagePreviewSurface({ os: 'web', tauri: false }) === 'in-app');
ck('route: ?imageViewer=1 only', m.readImageWindowRoute('?imageViewer=1') && !m.readImageWindowRoute('?imageViewer=0') && !m.readImageWindowRoute('?chat=x') && !m.readImageWindowRoute(''));
ck('window URL carries nothing but the route flag', m.IMAGE_WINDOW_URL === '/?imageViewer=1');

// ── conversation gallery + payload ─────────────────────────────────────────
const HUB = 'http://hub.example.invalid:9300';
const authed = (k: string): ViewerImage => ({ key: k, name: `${k}.png`, authUri: `${HUB}/api/files/${k}`, mime: 'image/png', save: true });
const plain = (k: string): ViewerImage => ({ key: k, name: `${k}.jpg`, uri: `https://img.example.invalid/${k}.jpg` });
const draft = (k: string): ViewerImage => ({ key: k, name: `${k}.png`, uri: `blob:tauri://localhost/${k}` });
{
  // messages oldest → newest; a file referenced twice (meta + text) appears once
  const conv = m.conversationGallery([[authed('a'), authed('b')], [], [plain('c'), authed('a')], [authed('d')]]);
  ck('conversation gallery: oldest first, each image once', conv.map(i => i.key).join(',') === 'a,b,c,d', conv.map(i => i.key).join(','));

  const payload = m.imageWindowPayload({ conversation: conv, message: [plain('c')], tappedKey: 'c', profileId: 'p-1', serverUrl: HUB, title: '示例-A', now: 1000 });
  ck('tapped image in the conversation → ←/→ walk the whole conversation', !!payload && payload.images.length === 4 && payload.index === 2, JSON.stringify(payload));
  ck('index label for the tapped image is 3/4', !!payload && viewerIndexLabel(payload.index, payload.images.length) === '3/4');
  ck('→ from 3/4 → 4/4, → again stays (no wrap)', !!payload && stepViewerIndex(payload.index, 4, 'next') === 3 && stepViewerIndex(3, 4, 'next') === 3);
  ck('← from 1/4 stays', stepViewerIndex(0, 4, 'prev') === 0);
  ck('payload names the account (profileId + serverUrl)', !!payload && payload.profileId === 'p-1' && payload.serverUrl === HUB);
  const json = JSON.stringify(payload);
  ck('payload never carries a token / Authorization', !/token|bearer|authorization/i.test(json), json);
  ck('authed images keep their hub url, not a blob of the opener', !!payload && payload.images[0].authUri === `${HUB}/api/files/a` && !payload.images[0].uri);

  const withDraft = m.imageWindowPayload({ conversation: conv, message: [draft('x'), draft('y')], tappedKey: 'x', serverUrl: HUB, now: 1 });
  ck('tapped a composer draft (blob:, opener-only) → null → in-app viewer', withDraft === null);
  const mixed = m.imageWindowPayload({ conversation: [authed('a'), draft('z'), authed('b')], message: [], tappedKey: 'b', serverUrl: HUB, now: 1 });
  ck('opener-only images are left out of the window gallery; index follows', !!mixed && mixed.images.map(i => i.key).join(',') === 'a,b' && mixed.index === 1, JSON.stringify(mixed));
  const notInConv = m.imageWindowPayload({ conversation: conv, message: [plain('q'), plain('r')], tappedKey: 'r', serverUrl: HUB, now: 1 });
  ck('tapped image not in the conversation list → the message gallery is used', !!notInConv && notInConv.images.length === 2 && notInConv.index === 1);
  ck('data:image uris are portable', m.windowImageFor({ key: 'd', name: 'd.png', uri: 'data:image/png;base64,AAAA' }) !== null);
  ck('file: uris are not', m.windowImageFor({ key: 'f', name: 'f.png', uri: 'file:///tmp/f.png' }) === null);

  // what arrives over the bus is validated
  ck('parse: round-trips a real payload', JSON.stringify(m.parseImageWindowPayload(JSON.parse(json))) === json);
  ck('parse: rejects junk / wrong version / empty', m.parseImageWindowPayload(null) === null && m.parseImageWindowPayload({ ...payload, v: 2 }) === null && m.parseImageWindowPayload({ ...payload, images: [] }) === null);
  ck('parse: drops blob:/file: entries and clamps the index', (() => {
    const r = m.parseImageWindowPayload({ v: 1, serverUrl: HUB, index: 9, at: 1, images: [authed('a'), { key: 'z', name: 'z', uri: 'blob:x' }, plain('c')] });
    return !!r && r.images.length === 2 && r.index === 1;
  })());
  ck('newest click wins; a stale answer is ignored', m.isNewerPayload(null, payload!) && m.isNewerPayload({ ...payload!, at: 5 }, { ...payload!, at: 6 }) && !m.isNewerPayload({ ...payload!, at: 6 }, { ...payload!, at: 5 }));
}

// ── token only to the account's own /api/files ─────────────────────────────
ck('authorizedFileUrl: own hub file', m.authorizedFileUrl(`${HUB}/api/files/f_1`, { serverUrl: HUB }));
ck('authorizedFileUrl: trailing slash on serverUrl is fine', m.authorizedFileUrl(`${HUB}/api/files/f_1`, { serverUrl: `${HUB}/` }));
ck('authorizedFileUrl: another host is refused', !m.authorizedFileUrl('http://evil.example.invalid/api/files/f_1', { serverUrl: HUB }));
ck('authorizedFileUrl: a host that merely starts with ours is refused', !m.authorizedFileUrl(`${HUB}0/api/files/f_1`, { serverUrl: HUB }) && !m.authorizedFileUrl(`${HUB}.evil.invalid/api/files/f`, { serverUrl: HUB }));
ck('authorizedFileUrl: other hub paths / traversal refused', !m.authorizedFileUrl(`${HUB}/api/tasks`, { serverUrl: HUB }) && !m.authorizedFileUrl(`${HUB}/api/files/../auth/me`, { serverUrl: HUB }));
ck('在浏览器打开 only for plain remote urls', m.canOpenInBrowser({ key: 'c', name: 'c', uri: 'https://x.invalid/c.jpg' }) && !m.canOpenInBrowser({ key: 'a', name: 'a', authUri: `${HUB}/api/files/a` }) && !m.canOpenInBrowser({ key: 'd', name: 'd', uri: 'data:image/png;base64,AA' }) && !m.canOpenInBrowser(undefined));
ck('title: name · conversation · 图片预览', m.imageWindowTitle({ key: 'a', name: 'a.png' }, '示例-A') === 'a.png · 示例-A · 图片预览');

// ── window geometry ────────────────────────────────────────────────────────
{
  const screen = { x: 0, y: 25, width: 1440, height: 875 };
  const big = m.initialWindowRect({ screen, image: { width: 4000, height: 3000 } });
  ck('big image: window within 80% of the screen', big.width <= 1440 * 0.8 && big.height <= 875 * 0.8, JSON.stringify(big));
  ck('big image: image area keeps the aspect ratio', near((big.width) / (big.height - m.IMAGE_WINDOW_TOOLBAR), 4000 / 3000, 0.01), JSON.stringify(big));
  ck('centred on the opener\'s screen', Math.abs(big.x + big.width / 2 - 720) <= 1 && Math.abs(big.y + big.height / 2 - (25 + 437.5)) <= 1, JSON.stringify(big));
  const small = m.initialWindowRect({ screen, image: { width: 200, height: 100 } });
  ck('small image: not upscaled, window at the minimum size', small.width === m.IMAGE_WINDOW_MIN.width && small.height === m.IMAGE_WINDOW_MIN.height, JSON.stringify(small));
  const unknown = m.initialWindowRect({ screen, image: null });
  ck('unknown size: the 80% box', unknown.width === 1152 && unknown.height === 700, JSON.stringify(unknown));
  const second = { x: 1440, y: 0, width: 1920, height: 1080 };
  const onSecond = m.initialWindowRect({ screen: second, image: { width: 800, height: 600 } });
  ck('opener on a second screen → centred on that screen', onSecond.x >= 1440 && Math.abs(onSecond.x + onSecond.width / 2 - (1440 + 960)) <= 1);
  const remembered = { x: 100, y: 120, width: 900, height: 640 };
  ck('remembered rect on this screen wins', JSON.stringify(m.initialWindowRect({ screen, image: { width: 4000, height: 3000 }, remembered })) === JSON.stringify(remembered));
  const elsewhere = m.initialWindowRect({ screen, image: null, remembered: { x: 3000, y: 100, width: 900, height: 640 } });
  ck('remembered rect on another screen is ignored (centre on the opener\'s)', elsewhere.width === 1152 && Math.abs(elsewhere.x + elsewhere.width / 2 - 720) <= 1);
  const huge = m.initialWindowRect({ screen, remembered: { x: -1780, y: -1975, width: 5000, height: 5000 } });
  ck('remembered rect bigger than the screen is clamped onto it', JSON.stringify(huge) === JSON.stringify(screen), JSON.stringify(huge));
  const halfOff = m.initialWindowRect({ screen, remembered: { x: 1000, y: 100, width: 800, height: 600 } });
  ck('remembered rect hanging off the right edge is pulled back', halfOff.x + halfOff.width <= 1440 && halfOff.width === 800, JSON.stringify(halfOff));
  ck('parseRememberedRect: junk → null, valid → rect', m.parseRememberedRect('nope') === null && m.parseRememberedRect('{"x":1}') === null && m.parseRememberedRect(null) === null && JSON.stringify(m.parseRememberedRect(JSON.stringify(remembered))) === JSON.stringify(remembered));
}

// ── zoom / pan ─────────────────────────────────────────────────────────────
{
  const N = { width: 2000, height: 1000 }, VP = { width: 1000, height: 600 };
  const fit = m.fitView(N, VP);
  ck('fit: whole image visible', near(fit.scale, 0.5) && fit.x === 0 && fit.y === 0);
  ck('fit never upscales a small image', m.fitScale({ width: 100, height: 50 }, VP) === 1);
  const cursor = { x: 200, y: -100 };
  const z = m.wheelZoom(fit, -100, cursor, N, VP);
  ck('wheel up zooms in', z.scale > fit.scale);
  // the image point under the cursor stays under it: (cursor - offset)/scale is invariant
  // (on an axis where the image still overflows the viewport; one that fits stays centred)
  ck('wheel zoom from fit keeps the cursor point on the overflowing axis', near((cursor.x - fit.x) / fit.scale, (cursor.x - z.x) / z.scale) && z.y === 0, JSON.stringify(z));
  const one = { scale: 1, x: 0, y: 0 };
  const z2 = m.wheelZoom(one, -100, cursor, N, VP);
  ck('wheel zoom keeps the point under the cursor (both axes)', near((cursor.x - one.x) / one.scale, (cursor.x - z2.x) / z2.scale) && near((cursor.y - one.y) / one.scale, (cursor.y - z2.y) / z2.scale), JSON.stringify(z2));
  ck('wheel down from fit zooms out (bounded)', m.wheelZoom(fit, 100, cursor, N, VP).scale < fit.scale);
  let far = fit; for (let i = 0; i < 100; i++) far = m.wheelZoom(far, -500, { x: 0, y: 0 }, N, VP);
  ck('zoom capped at 800%', near(far.scale, m.WINDOW_MAX_SCALE));
  const at100 = m.toggleFitActual(fit, cursor, N, VP);
  ck('double-click at fit → 100% around the cursor', near(at100.scale, 1) && near((cursor.x - fit.x) / fit.scale, (cursor.x - at100.x) / at100.scale, 1e-6), JSON.stringify(at100));
  ck('double-click at 100% → back to fit', JSON.stringify(m.toggleFitActual(at100, cursor, N, VP)) === JSON.stringify(fit));
  const panned = m.panView(at100, -5000, 5000, N, VP);
  ck('pan is bounded: image edge never comes inside the viewport edge', near(panned.x, -(2000 - 1000) / 2) && near(panned.y, (1000 - 600) / 2), JSON.stringify(panned));
  ck('pan at fit (image smaller on the short axis) keeps it centred there', m.panView(fit, 50, 50, N, VP).y === 0);
  ck('zoom label', m.zoomPercent(at100) === '100%' && m.zoomPercent(fit) === '50%');
}

// ── keys ───────────────────────────────────────────────────────────────────
ck('Esc closes the window', m.windowKeyAction({ key: 'Escape' }) === 'close');
ck('←/→ navigate', m.windowKeyAction({ key: 'ArrowLeft' }) === 'prev' && m.windowKeyAction({ key: 'ArrowRight' }) === 'next');
ck('Ctrl+C and ⌘+C copy', m.windowKeyAction({ key: 'c', ctrlKey: true }) === 'copy' && m.windowKeyAction({ key: 'c', metaKey: true }) === 'copy' && m.windowKeyAction({ key: 'C', ctrlKey: true }) === 'copy');
ck('bare c / modified arrows do nothing', m.windowKeyAction({ key: 'c' }) === null && m.windowKeyAction({ key: 'ArrowLeft', metaKey: true }) === null);
ck('0 fit, 1 actual, +/- zoom', m.windowKeyAction({ key: '0' }) === 'fit' && m.windowKeyAction({ key: '1' }) === 'actual' && m.windowKeyAction({ key: '=' }) === 'zoomIn' && m.windowKeyAction({ key: '-' }) === 'zoomOut');

// ── opener: window reuse, handshake, fallback (stubbed Tauri bridge) ──────
{
  type Call = { cmd: string; args: any };
  const calls: Call[] = [];
  let windows: string[] = [];
  let failCreate = false;
  const listeners = new Map<string, number>();
  const g = globalThis as any;
  g.window = g;
  g.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb: (x: unknown) => void) => { const id = Math.floor(Math.random() * 1e9); g[`_${id}`] = cb; return id; },
    invoke: async (cmd: string, args: any) => {
      calls.push({ cmd, args });
      if (cmd === 'plugin:event|listen') { listeners.set(args.event, args.handler); return listeners.size; }
      if (cmd === 'plugin:window|get_all_windows') return windows.slice();
      if (cmd === 'plugin:window|current_monitor') return { name: 'm', position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1700 } }, scaleFactor: 2 };
      if (cmd === 'plugin:webview|create_webview_window') { if (failCreate) throw new Error('boom'); windows.push(args.options.label); return null; }
      return null;
    },
  };
  const { openImageWindow } = await import('./image-window');
  const conv = [authed('a'), authed('b'), plain('c')];
  const pay = (key: string, now: number) => m.imageWindowPayload({ conversation: conv, message: [], tappedKey: key, profileId: 'p-1', serverUrl: HUB, title: '示例-A', now })!;

  const origWarn = console.warn; console.warn = () => {};
  const ok1 = await openImageWindow(pay('a', Date.now()));
  const creates = () => calls.filter(c => c.cmd === 'plugin:webview|create_webview_window');
  ck('first click creates the window', ok1 && creates().length === 1, JSON.stringify(calls.map(c => c.cmd)));
  const opts = creates()[0]?.args?.options ?? {};
  ck('created with the reusable label + fixed url', opts.label === m.IMAGE_WINDOW_LABEL && opts.url === m.IMAGE_WINDOW_URL, JSON.stringify(opts));
  ck('created resizable + maximizable', opts.resizable === true && opts.maximizable === true);
  ck('initial rect: on the opener\'s screen (logical px), within 80%', opts.width <= 1440 * 0.8 && opts.height <= 850 * 0.8 && Math.abs(opts.x + opts.width / 2 - 720) <= 1, JSON.stringify(opts));
  ck('window options carry no token', !/token|bearer/i.test(JSON.stringify(opts)));

  // the new page announces itself → the opener answers with the payload
  const ready = listeners.get(m.IMAGE_WINDOW_READY_EVENT);
  ck('opener listens for the window\'s ready', typeof ready === 'number');
  g[`_${ready}`]?.({ event: m.IMAGE_WINDOW_READY_EVENT, id: 1, payload: { label: m.IMAGE_WINDOW_LABEL } });
  await new Promise(r => setTimeout(r, 20));
  const shows = () => calls.filter(c => c.cmd === 'plugin:event|emit_to' && c.args?.event === m.IMAGE_WINDOW_SHOW_EVENT);
  ck('ready → payload sent to the image window only', shows().length === 1 && JSON.stringify(shows()[0].args.target).includes(m.IMAGE_WINDOW_LABEL) && shows()[0].args.payload.images[0].key === 'a', JSON.stringify(shows()[0]?.args));

  // second click: reuse, navigate, focus — no second window
  const ok2 = await openImageWindow(pay('c', Date.now()));
  ck('second click reuses the window (no second create)', ok2 && creates().length === 1);
  const last = shows().at(-1);
  ck('second click navigates it (payload index = tapped image)', !!last && last.args.payload.index === 2, JSON.stringify(last?.args?.payload));
  ck('second click focuses it', calls.some(c => c.cmd === 'plugin:window|set_focus'));

  // creation fails → false (caller falls back to the in-app viewer)
  windows = []; failCreate = true;
  ck('create failure → false (in-app fallback)', (await openImageWindow(pay('b', Date.now()))) === false);
  delete g.__TAURI_INTERNALS__;
  ck('no Tauri → false', (await openImageWindow(pay('b', Date.now()))) === false);
  console.warn = origWarn;
}

console.log(`\nimage-window-model: ${p}/${t} passed`);
if (p !== t) process.exit(1);
