// Desktop 「图片预览」 window — the real app (expo web export + Tauri bridge stub), no hub process:
// every hub request is answered in-page from placeholder data (alias 示例-A, host mock-hub.invalid).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-desktop-image-window/drive.mjs
//
// A  main window, desktop 1200×800: open 示例-A's chat (3 images sent + 1 in the reply)
//    1 clicking an image calls create_webview_window with label image-viewer, url /?imageViewer=1
//    2 no in-app overlay (the full-window ImageViewer) mounts
//    3 the new page's READY is answered with SHOW → image-viewer: 4 images (whole conversation), index
//      of the clicked one, the account (profileId + serverUrl) — and no token anywhere in what crossed
//    4 clicking another image: no second window; SHOW with the new index; the window is focused
// B  same, but window creation fails → the in-app ImageViewer mounts (fallback) and the failure is logged
// C  the viewer page itself at 1000×700, window label image-viewer:
//    1 READY is emitted; SHOW delivers the payload; the image loads (bearer only to mock-hub /api/files)
//    2 toolbar: every control shares one centre line (≤1px) — plus a positive control (a control moved
//      2px must fail the same check)
//    3 index 1/4 → ArrowRight → 2/4; wheel up zooms in; double-click toggles fit ↔ 100%; drag pans
//    4 Ctrl+C → clipboard-manager write_image with PNG bytes; 另存为… → dialog save → save_download
//    5 Esc → window close
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const { PNG } = createRequire(import.meta.url)('pngjs');

// placeholder images: different sizes/colours so switching is visible
const png = (w, h, [r, g, b]) => {
  const img = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const stripe = ((x >> 5) + (y >> 5)) % 2 ? 40 : 0;
    img.data[i] = Math.min(255, r + stripe); img.data[i + 1] = Math.min(255, g + stripe); img.data[i + 2] = Math.min(255, b + stripe); img.data[i + 3] = 255;
  }
  return [...PNG.sync.write(img)];
};
const FILES = {
  f_demo_img_1: png(1600, 900, [40, 110, 200]),
  f_demo_img_2: png(640, 960, [200, 90, 60]),
  f_demo_img_3: png(300, 200, [70, 170, 90]),
  f_demo_img_4: png(1200, 800, [150, 80, 180]),
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Runs in the page before the app.
const initScript = ({ files, label, failCreate }) => {
  const HUB = 'http://mock-hub.invalid';
  const TOKEN = 'placeholder-token-9f3a';
  const profile = { serverUrl: HUB, token: TOKEN, username: 'tester', profileId: 'p-imgwin', displayName: 'tester', networkId: 'net-imgwin' };
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const sessions = [{ alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_imgwin_a', updated_at: iso(1), files_capable: true }];
  const att = (id, name) => ({ type: 'file', file_id: id, name, mime: 'image/png' });
  const tasks = [
    { task_id: 't_imgwin_2', from_name: 'tester', to_name: '示例-A', content: '再看这张', result: '收到,回一张图。', status: 'replied', priority: 'normal', created_at: iso(5), updated_at: iso(4), completed_at: iso(4),
      meta_json: JSON.stringify({ reply_attachments: [att('f_demo_img_4', 'reply.png')] }) },
    { task_id: 't_imgwin_1', from_name: 'tester', to_name: '示例-A', content: '三张截图', status: 'delivered', priority: 'normal', created_at: iso(10), updated_at: iso(10),
      meta_json: JSON.stringify({ attachments: [att('f_demo_img_1', 'one.png'), att('f_demo_img_2', 'two.png'), att('f_demo_img_3', 'three.png')] }) },
  ];
  const route = (url) => {
    const u = new URL(url); const p = u.pathname;
    if (p === '/api/auth/me') return { ok: true, user: { username: 'tester' }, current_network: 'net-imgwin', networks: [{ network_id: 'net-imgwin', name: 'imgwin' }] };
    if (p === '/api/status') return { ok: true, sessions, files_capable: true };
    if (p === '/api/nodes') return { ok: true, nodes: [], count: 0 };
    if (p === '/api/tasks') return { ok: true, tasks };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0 };
    if (p.startsWith('/api/events')) return null;
    return { ok: true };
  };
  const log = (window.__calls = []);
  const listeners = (window.__listeners = new Map());
  const windows = [];
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__deliver = (event, payload) => {
    for (const h of listeners.get(event) ?? []) window[`_${h}`]?.({ event, id: 1, payload });
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      log.push({ cmd, args: cmd.startsWith('plugin:http') ? undefined : JSON.parse(JSON.stringify(args ?? null)) });
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'load_desktop_profile': return args.profileId === profile.profileId ? JSON.stringify(profile) : null;
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'plugin:event|listen': { const set = listeners.get(args.event) ?? []; set.push(args.handler); listeners.set(args.event, set); return set.length; }
        case 'plugin:window|get_all_windows': return windows.slice();
        case 'plugin:window|current_monitor': return { name: 'm', position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, workArea: { position: { x: 0, y: 50 }, size: { width: 2880, height: 1700 } }, scaleFactor: 2 };
        case 'plugin:webview|create_webview_window': if (failCreate) throw new Error('simulated create failure'); windows.push(args.options.label); return null;
        case 'plugin:dialog|save': return '/tmp/placeholder/saved.png';
        case 'save_download': return args.targetPath ?? '/tmp/placeholder/Downloads/x.png';
        case 'plugin:window|scale_factor': return 1;
        case 'plugin:window|is_maximized': case 'plugin:window|is_minimized': return false;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const u = new URL(c.url);
          const auth = (c.headers || []).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? null;
          (window.__http ||= []).push({ url: c.url, auth });
          const file = u.pathname.match(/^\/api\/files\/([^/]+)$/)?.[1];
          let buf, type = 'application/json', status = 200;
          if (file && files[file]) {
            if (auth !== `Bearer ${TOKEN}`) { status = 401; buf = new TextEncoder().encode('{"error":"unauthorized"}'); }
            else { buf = new Uint8Array(files[file]); type = 'image/png'; }
          } else {
            const body = route(c.url);
            status = body === null ? 404 : 200;
            buf = new TextEncoder().encode(body === null ? '{"ok":false}' : JSON.stringify(body));
          }
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status, statusText: 'OK', url: c.url, headers: [['content-type', type]], rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        default: return null;
      }
    },
  };
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe() });
let failures = 0;
const ck = (tag, name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`); };
const r1 = (n) => Math.round(n * 10) / 10;
const calls = (page, cmd) => page.evaluate((c) => window.__calls.filter(x => x.cmd === c), cmd);

async function openChat(page) {
  await page.getByText('示例-A', { exact: true }).first().click({ timeout: 20000 });
  // thumbnails are clickable once their authed bytes loaded (AuthedWebThumb → 「预览 <name>」)
  await page.locator('[aria-label="预览 reply.png"]').waitFor({ timeout: 15000 });
  await page.locator('[aria-label="预览 three.png"]').waitFor({ timeout: 15000 });
}

// ── A: click → window ──────────────────────────────────────────────────────
{
  const tag = 'A-main-1200x800';
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { files: FILES, label: 'main', failCreate: false });
  await page.goto(WEB_URL);
  await openChat(page);
  const cells = page.locator('[data-testid="chat-image-grid-cell"]');
  ck(tag, 'the chat shows the 3-image grid', (await cells.count()) === 3, `cells=${await cells.count()}`);
  await page.locator('[aria-label="预览 two.png"]').click();
  await page.waitForTimeout(800);
  const creates = await calls(page, 'plugin:webview|create_webview_window');
  const opts = creates[0]?.args?.options ?? {};
  ck(tag, 'click → create_webview_window(label image-viewer, url /?imageViewer=1)', creates.length === 1 && opts.label === 'image-viewer' && opts.url === '/?imageViewer=1', JSON.stringify(opts));
  ck(tag, 'window resizable + maximizable, within 80% of the (1440×850 logical) screen', opts.resizable === true && opts.maximizable === true && opts.width <= 1152 && opts.height <= 680, `${opts.width}×${opts.height} @${opts.x},${opts.y}`);
  ck(tag, 'no in-app full-window viewer mounted', (await page.locator('[data-testid="image-viewer"]').count()) === 0);
  await page.screenshot({ path: `${OUT}/imgwin-A-main-after-click.png` });

  // the new page announces itself
  await page.evaluate(() => window.__deliver('image-viewer:ready', { label: 'image-viewer' }));
  await page.waitForTimeout(300);
  let shows = (await calls(page, 'plugin:event|emit_to')).filter(c => c.args.event === 'image-viewer:show');
  const pay = shows[0]?.args?.payload;
  ck(tag, 'READY answered with SHOW targeted at image-viewer', shows.length === 1 && shows[0].args.target?.label === 'image-viewer', JSON.stringify(shows[0]?.args?.target));
  ck(tag, 'payload = whole conversation (4 images, oldest first), index = clicked (two.png → 1)', pay?.images?.length === 4 && pay.images.map(i => i.name).join(',') === 'one.png,two.png,three.png,reply.png' && pay.index === 1, JSON.stringify(pay?.images?.map(i => i.name)) + ` index=${pay?.index}`);
  ck(tag, 'payload names the account, carries hub file urls', pay?.profileId === 'p-imgwin' && pay?.serverUrl === 'http://mock-hub.invalid' && pay.images.every(i => i.authUri?.startsWith('http://mock-hub.invalid/api/files/')));
  const crossed = JSON.stringify(await page.evaluate(() => window.__calls.filter(x => x.cmd.startsWith('plugin:event') || x.cmd.startsWith('plugin:webview'))));
  ck(tag, 'no token in anything sent over events / window creation', !crossed.includes('placeholder-token-9f3a') && !/bearer/i.test(crossed));

  // second click: reuse + navigate + focus
  await page.locator('[aria-label="预览 reply.png"]').click();
  await page.waitForTimeout(800);
  const creates2 = await calls(page, 'plugin:webview|create_webview_window');
  shows = (await calls(page, 'plugin:event|emit_to')).filter(c => c.args.event === 'image-viewer:show');
  ck(tag, 'second click: no second window', creates2.length === 1, `creates=${creates2.length}`);
  ck(tag, 'second click: SHOW with the reply image (index 3)', shows.length === 2 && shows[1].args.payload.index === 3, JSON.stringify(shows.map(s => s.args.payload.index)));
  ck(tag, 'second click: window focused', (await calls(page, 'plugin:window|set_focus')).length >= 1);
  ck(tag, 'still no in-app overlay', (await page.locator('[data-testid="image-viewer"]').count()) === 0);
  await ctx.close();
}

// ── B: window creation fails → in-app viewer ───────────────────────────────
{
  const tag = 'B-fallback';
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const warnings = [];
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.addInitScript(initScript, { files: FILES, label: 'main', failCreate: true });
  await page.goto(WEB_URL);
  await openChat(page);
  await page.locator('[aria-label="预览 one.png"]').click();
  await page.waitForTimeout(1000);
  ck(tag, 'create failed → the in-app ImageViewer mounts', (await page.locator('[data-testid="image-viewer"]').count()) >= 1);
  ck(tag, 'the failure is logged', warnings.some(w => w.includes('[image-window]')), warnings.join(' | ').slice(0, 200));
  await page.screenshot({ path: `${OUT}/imgwin-B-fallback.png` });
  await ctx.close();
}

// ── C: the viewer page standalone at 1000×700 ──────────────────────────────
{
  const tag = 'C-viewer-1000x700';
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { files: FILES, label: 'image-viewer', failCreate: false });
  // answer READY the way an opener does
  await page.addInitScript(() => {
    const payload = { v: 1, profileId: 'p-imgwin', serverUrl: 'http://mock-hub.invalid', title: '示例-A', index: 0, at: Date.now(),
      images: ['f_demo_img_1:one.png', 'f_demo_img_2:two.png', 'f_demo_img_3:three.png', 'f_demo_img_4:reply.png'].map(s => { const [id, name] = s.split(':'); return { key: id, name, authUri: `http://mock-hub.invalid/api/files/${id}`, mime: 'image/png', save: true }; }) };
    const orig = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      const r = await orig(cmd, args);
      if (cmd === 'plugin:event|emit' && args.event === 'image-viewer:ready') setTimeout(() => window.__deliver('image-viewer:show', payload), 50);
      return r;
    };
  });
  await page.goto(`${WEB_URL}?imageViewer=1`);
  const img = page.locator('[data-testid="image-window-image"]');
  await img.waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  ck(tag, 'READY emitted by the page', (await calls(page, 'plugin:event|emit')).some(c => c.args.event === 'image-viewer:ready'));
  ck(tag, 'token loaded from the credential store by profileId', (await calls(page, 'load_desktop_profile')).some(c => c.args.profileId === 'p-imgwin'));
  const http = await page.evaluate(() => window.__http || []);
  ck(tag, 'bearer sent only to mock-hub /api/files/…', http.length > 0 && http.every(h => !h.auth || h.url.startsWith('http://mock-hub.invalid/api/files/')), JSON.stringify(http).slice(0, 200));
  ck(tag, 'index shows 1/4', (await page.getByTestId('image-window-index').innerText()) === '1/4');
  ck(tag, 'window title follows the image', (await calls(page, 'plugin:window|set_title')).some(c => c.args.value === 'one.png · 示例-A · 图片预览'), JSON.stringify(await calls(page, 'plugin:window|set_title')));

  const stage = await page.getByTestId('image-window-stage').boundingBox();
  const ib = await img.boundingBox();
  ck(tag, 'image fitted inside the stage and centred', ib.width <= stage.width + 0.5 && ib.height <= stage.height + 0.5 && Math.abs(ib.x + ib.width / 2 - (stage.x + stage.width / 2)) <= 1 && Math.abs(ib.y + ib.height / 2 - (stage.y + stage.height / 2)) <= 1, `img=${r1(ib.width)}×${r1(ib.height)} stage=${r1(stage.width)}×${r1(stage.height)}`);
  await page.screenshot({ path: `${OUT}/imgwin-C-viewer-1000x700.png` });

  // toolbar controls share one centre line
  const ids = ['image-window-prev', 'image-window-index', 'image-window-next', 'image-window-name', 'image-window-zoom-out', 'image-window-zoom', 'image-window-zoom-in', 'image-window-copy', 'image-window-save'];
  const boxes = await page.evaluate((ids) => ids.map(id => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { id, cy: r.y + r.height / 2, h: r.height, x: r.x }; }), ids);
  const bar = await page.getByTestId('image-window-toolbar').boundingBox();
  const missing = boxes.filter(b => !b).length;
  const cys = boxes.filter(Boolean).map(b => b.cy);
  const spread = Math.max(...cys) - Math.min(...cys);
  console.log('toolbar centre lines:', boxes.filter(Boolean).map(b => `${b.id.replace('image-window-', '')}=${r1(b.cy)}`).join(' '), `| bar cy=${r1(bar.y + bar.height / 2)}`);
  ck(tag, 'all toolbar controls present', missing === 0);
  ck(tag, 'toolbar controls share one centre line (≤1px)', spread <= 1, `spread=${r1(spread)}px`);
  ck(tag, "…which is the toolbar's own centre line (≤1px)", Math.abs(cys[0] - (bar.y + bar.height / 2)) <= 1, `control=${r1(cys[0])} bar=${r1(bar.y + bar.height / 2)}`);
  const shifted = await page.evaluate(() => { const el = document.querySelector('[data-testid="image-window-copy"]'); el.style.transform = 'translateY(2px)'; const r = el.getBoundingClientRect(); el.style.transform = ''; return r.y + r.height / 2; });
  ck(tag, 'positive control: a control moved 2px fails the centre-line check', Math.abs(shifted - cys[0]) > 1);

  // keys + mouse
  const zoomLabel = () => page.getByTestId('image-window-zoom').innerText();
  const fitLabel = await zoomLabel();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-window-index"]')?.textContent === '2/4', null, { timeout: 5000 }).catch(() => {});
  ck(tag, '→ → 2/4', (await page.getByTestId('image-window-index').innerText()) === '2/4');
  await page.getByTestId('image-window-image').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/imgwin-C-viewer-2of4.png` });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  ck(tag, '← → back to 1/4', (await page.getByTestId('image-window-index').innerText()) === '1/4');
  const sb = await page.getByTestId('image-window-stage').boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.7, sb.y + sb.height * 0.4);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  const zoomed = await zoomLabel();
  ck(tag, 'wheel up zooms in', parseInt(zoomed) > parseInt(fitLabel), `${fitLabel} → ${zoomed}`);
  await page.getByTestId('image-window-zoom').click(); // not at fit → fit
  await page.waitForTimeout(150);
  ck(tag, 'zoom pill click → back to fit', (await zoomLabel()) === fitLabel, await zoomLabel());
  await page.mouse.dblclick(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForTimeout(150);
  ck(tag, 'double-click at fit → 100%', (await zoomLabel()) === '100%', await zoomLabel());
  // drag pans (image is 1600 wide at 100% in a 1000 stage)
  const before = await page.getByTestId('image-window-image').boundingBox();
  await page.mouse.move(sb.x + 500, sb.y + 300); await page.mouse.down(); await page.mouse.move(sb.x + 400, sb.y + 300, { steps: 5 }); await page.mouse.up();
  const after = await page.getByTestId('image-window-image').boundingBox();
  ck(tag, 'drag pans the zoomed image', Math.abs((after.x - before.x) + 100) <= 1, `dx=${r1(after.x - before.x)}`);
  await page.mouse.dblclick(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForTimeout(150);
  ck(tag, 'double-click at 100% → fit', (await zoomLabel()) === fitLabel, await zoomLabel());

  await page.keyboard.press('Control+c');
  await page.waitForTimeout(500);
  const writes = await calls(page, 'plugin:clipboard-manager|write_image');
  const bytes = writes[0]?.args?.image;
  const head = Array.isArray(bytes) ? bytes.slice(0, 4) : bytes && typeof bytes === 'object' ? [bytes[0], bytes[1], bytes[2], bytes[3]] : null;
  ck(tag, 'Ctrl+C → clipboard-manager write_image with PNG bytes', writes.length === 1 && JSON.stringify(head) === JSON.stringify([0x89, 0x50, 0x4e, 0x47]), `${writes.length} ${JSON.stringify(Object.keys(writes[0]?.args ?? {}))} ${JSON.stringify(head)}`);
  ck(tag, '「已复制图片」 note', (await page.getByTestId('image-window-note').innerText().catch(() => '')).includes('已复制图片'));

  await page.getByTestId('image-window-save').click();
  await page.waitForTimeout(500);
  ck(tag, '另存为… → save dialog then save_download to the chosen path', (await calls(page, 'plugin:dialog|save')).length === 1 && (await calls(page, 'save_download')).some(c => c.args.targetPath === '/tmp/placeholder/saved.png'));
  ck(tag, '在浏览器打开 hidden for authed hub files', (await page.getByTestId('image-window-open-browser').count()) === 0);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ck(tag, 'Esc → window close', (await calls(page, 'plugin:window|close')).length === 1);
  await ctx.close();
}

await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
