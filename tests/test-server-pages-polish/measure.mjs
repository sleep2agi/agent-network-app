// Desktop server pages polish — measured against a real (throwaway) hub, not eyeballed.
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself
// (never 127.0.0.1:9200). Seed it with seed.mjs in this directory first.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:9298 HUB_TOKEN=<utok_…> \
//   HUB_NETWORK=<net_…> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-server-pages-polish/measure.mjs
//
// At 1200×800 (Tauri desktop shell stub), on every top-level desktop page and every 服务器 page:
//   back    : no phone back affordance ([data-testid=pane-back], a 「‹」 glyph or aria-label 返回*) in the right pane
//   pin     : the 窗口置顶 button intersects no element outside the rail (floating ⇒ it overlapped headers)
//   title   : on 事件与日志 / 新建节点, header title left edge = content left edge (±1 px)
//   badge   : the 节点 badge covers < 40% of its icon (seeded 120 online nodes ⇒ 「99+」)
//   events  : 事件流 preloads the seeded tasks, rows read 「发起 → 接收 · 状态 · 时间」, no `connected`
//             row, no task content anywhere on the page; clicking a row that involves the viewer opens that chat
// At 390×844 (Android UA ⇒ phone): 事件流 keeps its back button, and the list renders.
// Exit 1 when any assertion fails. BASELINE=1 records the same numbers without failing (for the
// before column).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
const BASELINE = process.env.BASELINE === '1';
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (the plain web branch hits SecureStore); plugin:http is forwarded to the real hub.
// The event stream: in Tauri, logs-sse asks the native side (`start_network_event_stream`) and listens
// for `network-event-stream` events. The stub plays that native side with a streaming fetch against the
// real hub's /events/network/:id, so the page gets the hub's real frames (including `connected`).
const initScript = ({ hubUrl, token, networkId }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-server-polish', displayName: 'tester', networkId };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  const listeners = new Map(); // event name → callback ids
  const emit = (event, payload) => { for (const id of listeners.get(event) || []) window[`_${id}`]?.({ event, id: 0, payload }); };
  const startStream = async ({ streamId, serverUrl, token: tok, networkId: net }) => {
    emit('network-event-stream', { kind: 'state', stream_id: streamId, state: 'connecting' });
    const r = await fetch(`${serverUrl}/events/network/${encodeURIComponent(net)}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'text/event-stream' } });
    if (r.status !== 200) { emit('network-event-stream', { kind: 'state', stream_id: streamId, state: 'disconnected', error: `HTTP ${r.status}` }); return; }
    emit('network-event-stream', { kind: 'state', stream_id: streamId, state: 'connected' });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let carry = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parts = (carry + dec.decode(value, { stream: true })).split('\n\n');
      carry = parts.pop() || '';
      for (const frame of parts) {
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (data) try { emit('network-event-stream', { kind: 'event', stream_id: streamId, event: JSON.parse(data) }); } catch {}
      }
    }
    emit('network-event-stream', { kind: 'state', stream_id: streamId, state: 'disconnected', error: 'closed' });
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': {
          const ids = listeners.get(args.event) || []; ids.push(args.handler); listeners.set(args.event, ids);
          return args.handler;
        }
        case 'start_network_event_stream': { void startStream(args); return null; }
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url, headers: Array.from(r.headers.entries()), rid: id };
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
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const r1 = (n) => Math.round(n * 10) / 10;
// Ionicons glyphs render as private-use characters; read their code points from the installed map so
// a chevron-back button (the 0.2.124 「‹ Server」 row used one, with no ‹ text) is detectable.
const GLYPHS = JSON.parse(readFileSync(new URL('../../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json', import.meta.url), 'utf8'));
const CHEVRON_BACK = String.fromCodePoint(GLYPHS['chevron-back']);
const NODES_ICON = String.fromCodePoint(GLYPHS['git-network-outline']);

const rows = [];
let failures = 0;
function record(page, checks, detail) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok && !BASELINE) failures++;
  const row = { page, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return b.width || b.height ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}, sel);

/** Elements (leaf-ish, visible) outside the rail whose box intersects `r`. */
const overlapping = (page, r) => page.evaluate((r) => {
  const rail = document.querySelector('[data-testid="desktop-rail"]');
  const hits = [];
  for (const el of document.querySelectorAll('body *')) {
    if (rail && rail.contains(el)) continue;
    if (el.closest('[data-testid^="window-pin"]')) continue;
    if (el.childElementCount > 0 && !(el.getAttribute('role') === 'button')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const w = Math.min(b.right, r.x + r.w) - Math.max(b.left, r.x);
    const h = Math.min(b.bottom, r.y + r.h) - Math.max(b.top, r.y);
    if (w > 0.5 && h > 0.5) hits.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `#${el.dataset.testid}` : ''}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}`);
  }
  return hits;
}, r);

/** Back affordances visible anywhere right of the rail. */
const backAffordances = (page) => page.evaluate((chevron) => {
  const rail = document.querySelector('[data-testid="desktop-rail"]');
  const railRight = rail ? rail.getBoundingClientRect().right : 0;
  const out = [];
  for (const el of document.querySelectorAll('[data-testid="pane-back"], [aria-label^="返回"], div, span')) {
    const b = el.getBoundingClientRect();
    if (!b.width || b.left < railRight) continue;
    const label = el.getAttribute('aria-label') || '';
    const text = el.childElementCount === 0 ? (el.textContent || '').trim() : '';
    if (el.dataset?.testid === 'pane-back' || label.startsWith('返回') || text === '‹' || text.startsWith('‹ ')) out.push(el.dataset?.testid || label || text);
    else if (text === chevron) out.push('chevron-back icon');
  }
  return [...new Set(out)];
}, CHEVRON_BACK);

const pinBox = async (page) => (await box(page, '[data-testid="window-pin-rail"]')) || (await box(page, '[data-testid="window-pin-floating"]')) || (await box(page, '[aria-label="窗口置顶"], [aria-label="取消窗口置顶"]'));

const clickLabel = async (page, label) => { await page.locator(`[aria-label="${label}"]`).first().click(); await page.waitForTimeout(900); };

async function newPage(vp, android) {
  const ctx = await browser.newContext({ viewport: vp, userAgent: android ? ANDROID_UA : undefined, deviceScaleFactor: 1 });
  await ctx.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto(WEB_URL);
  await page.waitForTimeout(3500);
  return { ctx, page };
}

// ── desktop 1200×800 ──
const { ctx, page } = await newPage({ width: 1200, height: 800 }, false);
const TOP = [
  { name: 'agents', go: () => clickLabel(page, 'Agents') },
  { name: 'tasks', go: () => clickLabel(page, 'Tasks') },
  { name: 'scheduled', go: () => clickLabel(page, '定时') },
  { name: 'messages', go: () => clickLabel(page, 'Messages') },
  { name: 'settings', go: () => clickLabel(page, '设置') },
  { name: 'server-overview', go: async () => { await clickLabel(page, '服务器设置'); await clickLabel(page, '服务器-概览'); } },
  { name: 'server-nodes', go: () => clickLabel(page, '服务器-节点') },
  { name: 'server-create', go: () => clickLabel(page, '服务器-新建节点') },
  { name: 'server-logs', go: () => clickLabel(page, '服务器-事件与日志') },
];
for (const t of TOP) {
  await t.go();
  await page.waitForTimeout(t.name === 'server-logs' ? 2500 : 600);
  const png = `${OUT}/desktop-1200x800-${t.name}.png`;
  await page.screenshot({ path: png });
  const pin = await pinBox(page);
  const hits = pin ? await overlapping(page, pin) : [];
  const backs = await backAffordances(page);
  record(t.name, { noBack: backs.length === 0, pinClear: hits.length === 0 }, {
    pin: pin ? `${r1(pin.x)},${r1(pin.y)} ${r1(pin.w)}×${r1(pin.h)}` : 'none', pinOverlaps: hits.join(' | ') || '-', back: backs.join(' | ') || '-', png,
  });

  if (t.name === 'server-overview' || t.name === 'server-logs') {
    // Generic on purpose (works on the baseline build, which has no testIDs): the 节点 row is the
    // button labelled 服务器-节点; the icon is its git-network glyph, the badge the element reading 99+.
    const geo = await page.evaluate((glyph) => {
      const row = document.querySelector('[aria-label="服务器-节点"]');
      if (!row) return null;
      const leaves = [...row.querySelectorAll('div, span')].filter(n => n.childElementCount === 0);
      const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const iconEl = leaves.find(n => n.textContent === glyph);
      const badgeText = leaves.find(n => /^\d+\+?$/.test((n.textContent || '').trim()));
      const labelEl = leaves.find(n => (n.textContent || '').trim() === '节点');
      const range = labelEl && document.createRange(); range?.selectNodeContents(labelEl);
      return {
        icon: iconEl && rect(iconEl),
        badge: badgeText && rect(badgeText.parentElement),
        badgeText: badgeText?.textContent || '',
        label: range && (() => { const b = range.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })(),
      };
    }, NODES_ICON);
    const icon = geo?.icon, badge = geo?.badge, badgeText = geo?.badgeText ?? '';
    const inter = (a, b) => a && b ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : NaN;
    const share = icon ? inter(icon, badge) / (icon.w * icon.h) : NaN;
    const labelHit = inter(geo?.label, badge);
    record(`${t.name}:badge`, { badgeFound: !!badge, under40: share < 0.4, visible60: 1 - share >= 0.6, labelClear: labelHit === 0 }, {
      badgeText, icon: icon && `${r1(icon.x)},${r1(icon.y)} ${r1(icon.w)}×${r1(icon.h)}`, badge: badge && `${r1(badge.x)},${r1(badge.y)} ${r1(badge.w)}×${r1(badge.h)}`, covered: `${r1(share * 100)}%`,
      label: geo?.label && `${r1(geo.label.x)},${r1(geo.label.y)} ${r1(geo.label.w)}×${r1(geo.label.h)}`, badgeOverLabelPx2: r1(labelHit),
    });
  }

  if (t.name === 'server-logs') {
    // Text left edges via Range (the ink start), not element boxes: a flex:1 Text box starts where
    // its text starts, but the intro's nested <Text> leaf can be a zero-padding inline span.
    const textX = (sel, needle) => page.evaluate(({ sel, needle }) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!needle || n.textContent.includes(needle)) { const r = document.createRange(); r.selectNodeContents(n); return { x: r.getBoundingClientRect().x }; }
      }
      return null;
    }, { sel, needle });
    const title = await textX('[data-testid="logs-title"]', '事件流');
    const intro = await textX('[data-testid="logs-intro"]', '显示网络任务流转');
    const firstRow = await box(page, '[data-testid="logs-row"]');
    const info = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-testid="logs-row"]').length,
      statusLine: document.querySelector('[data-testid="logs-status-line"]')?.textContent || '',
      body: document.body.innerText,
    }));
    const rowsText = await page.$$eval('[data-testid="logs-row"]', els => els.slice(0, 3).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    record('server-logs:content', {
      titleAlignsIntro: !!title && !!intro && Math.abs(title.x - intro.x) <= 1,
      titleAlignsRows: !!title && !!firstRow && Math.abs(title.x - firstRow.x) <= 1,
      preloaded: info.rows >= 30,
      noConnectedRow: !/(^|\n)connected(\n|$)/.test(info.body),
      noContent: !/PRIVATE-(CONTENT|RESULT)/.test(info.body),
      privacyLine: info.body.includes('不含消息内容'),
    }, {
      titleX: title && r1(title.x), introX: intro && r1(intro.x), firstRowX: firstRow && r1(firstRow.x), rows: info.rows, statusLine: info.statusLine, newestRows: rowsText.join(' || '),
    });
    // Click the newest row that involves the viewer → its chat opens.
    const target = await page.evaluate(() => {
      const rowsEls = [...document.querySelectorAll('[data-testid="logs-row"]')];
      const hit = rowsEls.find(r => /(^|\s)tester(\s|$)/.test(r.innerText) && r.getAttribute('role') === 'button');
      if (!hit) return null;
      hit.setAttribute('data-click-target', '1');
      const m = hit.innerText.match(/demo-node-\d{3}/);
      return m ? m[0] : null;
    });
    if (target) {
      await page.locator('[data-click-target="1"]').click();
      await page.waitForTimeout(1500);
      const chatAlias = await page.evaluate(() => document.querySelector('[data-testid="chat-header"]')?.innerText || '');
      await page.screenshot({ path: `${OUT}/desktop-1200x800-server-logs-click-chat.png` });
      record('server-logs:click', { opensChat: chatAlias.includes(target) }, { target, chatHeader: chatAlias.replace(/\s+/g, ' ').slice(0, 40) });
      await clickLabel(page, '服务器设置');
      await clickLabel(page, '服务器-事件与日志');
    } else {
      record('server-logs:click', { opensChat: false }, { target: 'none' });
    }
  }

  if (t.name === 'server-create') {
    const title = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="screen-header"]');
      const leaf = h && [...h.querySelectorAll('div, span')].find(n => n.childElementCount === 0 && (n.textContent || '').trim() === '选服务器');
      if (!leaf) return null;
      const r = document.createRange(); r.selectNodeContents(leaf);
      const b = r.getBoundingClientRect();
      return { x: b.x };
    });
    // Content left edge: the left of the first visible block under the header — a card's edge, or a
    // text's ink when there is no card (what the eye aligns the title with).
    const content = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="screen-header"]');
      const hb = h?.getBoundingClientRect();
      if (!hb) return null;
      let best = null;
      for (const n of document.querySelectorAll('div')) {
        const b = n.getBoundingClientRect();
        if (!b.width || b.top < hb.bottom + 1 || b.left < hb.left || b.top > hb.bottom + 80) continue;
        const cs = getComputedStyle(n);
        const painted = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || parseFloat(cs.borderTopWidth) > 0;
        const text = n.childElementCount === 0 && (n.textContent || '').trim();
        if (!painted && !text) continue;
        if (b.left - hb.left < 2) continue; // full-bleed containers
        if (!best || b.left < best.x) best = { x: b.left, text: (n.textContent || '').trim().slice(0, 16) };
      }
      return best;
    });
    record('server-create:title', { titleAlignsContent: !!title && !!content && Math.abs(title.x - content.x) <= 1 }, { titleX: title && r1(title.x), contentX: content && r1(content.x), contentText: content?.text });
  }
}
await ctx.close();

// ── phone 390×844 (Android UA ⇒ phone stack) ──
{
  const { ctx: pctx, page: p } = await newPage({ width: 390, height: 844 }, true);
  await p.getByText('服务器', { exact: true }).last().click();
  await p.waitForTimeout(900);
  await p.locator('[data-testid="server-action-logs"]').click();
  await p.waitForTimeout(2500);
  const png = `${OUT}/phone-390x844-server-logs.png`;
  await p.screenshot({ path: png });
  const back = await box(p, '[data-testid="pane-back"]');
  const nRows = await p.evaluate(() => document.querySelectorAll('[data-testid="logs-row"]').length);
  const title = await box(p, '[data-testid="logs-title"]');
  const vw = 390;
  const rowRight = await p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-testid="logs-row"]')].map(e => e.getBoundingClientRect().right)));
  // A row whose time or chip wraps is taller than the others: all visible rows must share one height.
  const heights = await p.evaluate(() => [...document.querySelectorAll('[data-testid="logs-row"]')].map(e => e.getBoundingClientRect()).filter(b => b.top < window.innerHeight).map(b => Math.round(b.height * 10) / 10));
  record('phone-logs', { backShown: !!back, rows: nRows >= 30, noHorizontalOverflow: rowRight <= vw, rowsOneHeight: heights.length > 0 && Math.max(...heights) - Math.min(...heights) <= 1 }, {
    back: back && `${r1(back.x)},${r1(back.y)} ${r1(back.w)}×${r1(back.h)}`, titleX: title && r1(title.x), rows: nRows, rowRight: r1(rowRight), rowHeights: [...new Set(heights)].join('/'), png,
  });
  await pctx.close();
}

writeFileSync(`${OUT}/measurements.json`, JSON.stringify(rows, null, 2));
await browser.close();
web.close();
console.log(failures ? `FAIL ${failures}` : (BASELINE ? 'BASELINE recorded' : 'OK'));
process.exit(failures && !BASELINE ? 1 : 0);
