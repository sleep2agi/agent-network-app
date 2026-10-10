// App-wide visual modernisation (radius / elevation tokens): screenshots of the main screens plus
// computed-style samples, in the real app — expo web export + the layout sweep's Tauri stub, which
// answers every hub request in-page from placeholder data (no hub process, no port, no HOME).
// Not in CI (needs Playwright + Chromium).
//
//   WEB_DIR=<expo web export> OUT=<png dir> TAG=before|after [ONLY=<screen,...>] \
//   [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-modern-ui/shoot.mjs
//
// Layouts: phone 390×844 (Android UA; `?safeAreaSim=0,0,0,0` only to expose the sweep's setScreen
// hook, insets stay 0), desktop 1000×700 and 1200×800 (Tauri desktop shell). Light and dark.
// Writes <OUT>/<layout>-<theme>-<screen>-<TAG>.png and <OUT>/samples-<TAG>.json:
// per screen × layout × theme, the computed border-radius / box-shadow / border of every element
// tagged with a sample testID (see SAMPLES), so before/after can be diffed as numbers.
// Exit 1 when a screen could not be opened (a screen that never ran is a FAIL, not a skip).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT, TAG = process.env.TAG || 'run';
if (!WEB || !OUT) throw new Error('need WEB_DIR and OUT');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });

// A synthetic 320×200 gradient PNG for the chat image thumbnails (no real image, no network).
const { PNG } = createRequire(import.meta.url)('pngjs');
const png = new PNG({ width: 320, height: 200 });
for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
  const i = (y * 320 + x) * 4;
  png.data[i] = 40 + Math.round(x / 2); png.data[i + 1] = 120 + Math.round(y / 3); png.data[i + 2] = 200; png.data[i + 3] = 255;
}
const PNG_B64 = PNG.sync.write(png).toString('base64');

// Runs after harness initScript: wraps its invoke to add an image reply, a sent image, a few more
// chat turns, /api/files/* bytes and a requirements board. Everything else goes to the harness.
const extraScript = ({ pngB64 }) => {
  const base = window.__TAURI_INTERNALS__;
  const orig = base.invoke;
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const bytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
  const img = (id) => ({ type: 'file', file_id: id, name: `${id}.png`, mime: 'image/png', size: bytes.length });
  const tasks = [
    { task_id: 't_ui_3', from_name: 'tester', to_name: '示例-A', content: '把示意图发我看看', result: '示例回复:图在下面。', status: 'replied', priority: 'normal', created_at: iso(8), updated_at: iso(7), completed_at: iso(7), meta_json: JSON.stringify({ reply_attachments: [img('f_ui_reply')] }) },
    { task_id: 't_ui_2', from_name: 'tester', to_name: '示例-A', content: '这是一张截图', result: '收到。', status: 'replied', priority: 'normal', created_at: iso(6), updated_at: iso(5), completed_at: iso(5), meta_json: JSON.stringify({ attachments: [img('f_ui_sent')] }) },
    { task_id: 't_ui_1', from_name: 'tester', to_name: '示例-A', content: '示例任务:检查一下构建', result: '示例回复:构建通过。\n\n- 一项\n- 两项\n\n`inline code`', status: 'replied', priority: 'normal', created_at: iso(3), updated_at: iso(2), completed_at: iso(2) },
  ];
  const requirements = [
    { id: 'r1', name: '示例需求:整理文档', priority: 'high', assignee: '', due: '', column: 'pool', createdAt: iso(100) },
    { id: 'r2', name: '示例需求:修复布局', priority: 'normal', assignee: '', due: '', column: 'doing', createdAt: iso(90) },
    { id: 'r3', name: '示例需求:发布说明', priority: 'low', assignee: '', due: '', column: 'done', createdAt: iso(80) },
  ];
  const mine = new Map(); let rid = 1e6;
  const route = (url) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/api/files/')) return { bin: bytes, type: 'image/png' };
    if (u.pathname === '/api/tasks' && u.searchParams.get('to_name') === '示例-A') return { json: { ok: true, tasks } };
    if (u.pathname === '/api/requirements') return { json: { ok: true, requirements } };
    return null;
  };
  base.invoke = async (cmd, args) => {
    if (cmd === 'plugin:http|fetch') {
      const r = route(args.clientConfig.url);
      if (r) { const id = ++rid; mine.set(id, r); return id; }
    }
    if (cmd === 'plugin:http|fetch_send' && mine.has(args.rid)) {
      const r = mine.get(args.rid);
      const buf = r.bin || new TextEncoder().encode(JSON.stringify(r.json));
      const id = ++rid; mine.set(id, { buf, sent: false });
      return { status: 200, statusText: 'OK', url: 'http://mock-hub.invalid/', headers: [['content-type', r.type || 'application/json']], rid: id };
    }
    if (cmd === 'plugin:http|fetch_read_body' && mine.has(args.rid)) {
      const b = mine.get(args.rid);
      if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
      return [1];
    }
    return orig(cmd, args);
  };
};

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const LAYOUTS = [
  { name: 'phone', w: 390, h: 844, ua: PHONE_UA, query: '?safeAreaSim=0,0,0,0' },
  { name: 'd1000', w: 1000, h: 700, ua: undefined, query: '' },
  { name: 'd1200', w: 1200, h: 800, ua: undefined, query: '' },
];
const tid = (id) => `[data-testid="${id}"]`;
const phone = (L) => L.name === 'phone';
const setScreen = (s) => async (page) => { await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 }); await page.evaluate(x => window.__anetLayoutSweep.setScreen(x), s); };
const rail = (label) => async (page) => { await page.locator(`${tid('desktop-rail')} [aria-label="${label}"]`).first().click({ timeout: 10000 }); };
const openChat = async (page, L) => {
  if (phone(L)) await setScreen({ name: 'chat', alias: '示例-A' })(page);
  else await page.locator('[data-agent-alias="示例-A"]').first().click({ timeout: 10000 });
  await page.locator(tid('chat-header')).waitFor({ timeout: 10000 });
  await page.getByText('示例回复:图在下面。').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800); // thumbnails decode
};

const SCREENS = [
  { name: 'agents', open: async (page, L) => { if (phone(L)) await setScreen({ name: 'agents' })(page); } },
  { name: 'chat', open: openChat },
  { name: 'chatInfo', open: async (page, L) => { await openChat(page, L); await page.locator(tid('chat-header-more')).click(); await page.locator(tid('chat-info-panel')).waitFor({ timeout: 5000 }); } },
  { name: 'settings', open: async (page, L) => { if (phone(L)) await setScreen({ name: 'settings' })(page); else await rail('设置')(page); } },
  { name: 'settingsSub', open: async (page, L) => {
    if (phone(L)) { await setScreen({ name: 'settings' })(page); await page.locator(tid('settings-row-voice')).click({ timeout: 10000 }); }
    else { await rail('设置')(page); await page.getByText('外观', { exact: true }).first().click({ timeout: 10000 }); }
  } },
  { name: 'scheduled', open: async (page, L) => { if (phone(L)) await setScreen({ name: 'scheduled' })(page); else await rail('定时')(page); } },
  { name: 'server', open: async (page, L) => { if (phone(L)) await setScreen({ name: 'server' })(page); else await rail('Hub 设置')(page); } },
  { name: 'nodeDetail', open: async (page, L) => {
    if (phone(L)) await setScreen({ name: 'nodeDetail', alias: '示例-A' })(page);
    else { await openChat(page, L); await page.locator(tid('chat-header-more')).click(); await page.locator(tid('chat-info-panel')).waitFor({ timeout: 5000 }); await page.locator(tid('chat-info-row-node')).click({ timeout: 5000 }); await page.locator(tid('screen-header')).first().waitFor({ timeout: 10000 }); }
  } },
  { name: 'taskBoard', open: async (page, L) => { if (phone(L)) await setScreen({ name: 'tasks' })(page); else await rail('Tasks')(page); await page.locator(tid('tasks-view-board')).click({ timeout: 10000 }); } },
];

// Computed style of the sampled surfaces. Found by structure, not by testID, so the same sampler
// reads the before and after builds.
const sample = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const cs = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { radius: s.borderTopLeftRadius, radii: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].join(' '), shadow: s.boxShadow, border: `${s.borderTopWidth} ${s.borderTopColor}`, overflow: s.overflow, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };
  const out = {};
  const put = (k, el) => { if (el && vis(el) && !out[k]) out[k] = cs(el); };
  const byTid = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].find(vis);
  const textEl = (t) => [...document.querySelectorAll('div')].find(d => vis(d) && [...d.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === t));
  // nearest ancestor that paints a background (a bubble / button / chip body)
  const painted = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) return e; } return null; };
  const t1 = textEl('示例回复:图在下面。'); if (t1) put('bubble(reply)', painted(t1));
  const t2 = textEl('这是一张截图'); if (t2) put('bubble(sent)', painted(t2));
  const imgs = [...document.querySelectorAll('img')].filter(i => vis(i) && /^blob:/.test(i.src));
  if (imgs[0]) { put('chatImage', imgs[0]); let p = imgs[0].parentElement; for (let i = 0; i < 4 && p; i++, p = p.parentElement) { const s = getComputedStyle(p); if (s.borderTopLeftRadius !== '0px') { put('chatImageFrame', p); break; } } }
  put('composerInput', document.querySelector('textarea'));
  put('search', [...document.querySelectorAll('input')].find(i => vis(i) && /搜索/.test(i.placeholder || '')));
  const pressables = [...document.querySelectorAll('[role="button"],button')].filter(vis);
  const withBg = pressables.filter(b => { const s = getComputedStyle(b); return !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor); });
  // a filled primary button: accent-ish background, text inside, ≥ 28 high
  const primary = withBg.find(b => b.getBoundingClientRect().height >= 28 && b.textContent.trim().length > 0 && b.getBoundingClientRect().width < innerWidth * 0.9);
  put('button', primary);
  const chip = withBg.find(b => { const r = b.getBoundingClientRect(); return r.height < 32 && r.height >= 18 && b.textContent.trim().length > 0 && r.width < 160; });
  put('chip', chip);
  for (const id of ['chat-info-panel', 'agent-row-menu', 'node-files-tree-drawer', 'desktop-rail']) put(id, byTid(id));
  // a card: a painted block with a border or shadow, bigger than a control
  const cards = [...document.querySelectorAll('div')].filter(d => { if (!vis(d)) return false; const r = d.getBoundingClientRect(); if (r.height < 60 || r.width < 160 || r.width > innerWidth * 0.98) return false; const s = getComputedStyle(d); return s.borderTopLeftRadius !== '0px' && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor); });
  put('card', cards[0]);
  // Named probes (one per token class) — found by testID / text so before and after read the same element.
  const pressableOf = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) if (e.matches('[role="button"],button,[tabindex="0"]')) return e; return null; };
  const t3 = textEl('收到。'); if (t3) put('probe:bubble', painted(t3));
  put('probe:chip(tasks-view-board)', byTid('tasks-view-board'));
  put('probe:input(agents-search)', byTid('agents-search'));
  const t4 = textEl('恢复默认'); if (t4) put('probe:button(恢复默认)', pressableOf(t4));
  const t5 = textEl('在线'); if (t5) { let e = t5; for (let i = 0; i < 6 && e; i++, e = e.parentElement) { const s = getComputedStyle(e); if (s.borderTopLeftRadius !== '0px' && e.getBoundingClientRect().height > 60) { put('probe:card(server stat)', e); break; } } }
  put('probe:drawer(chat-info)', byTid('chat-info-panel'));
  return out;
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const samples = {};
let notRun = 0;
for (const L of LAYOUTS) for (const theme of ['light', 'dark']) for (const S of SCREENS) {
  if (ONLY.length && !ONLY.includes(S.name)) continue;
  const key = `${L.name}-${theme}-${S.name}`;
  const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, userAgent: L.ua, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(extraScript, { pngB64: PNG_B64 });
    await page.goto(`${web.url}${L.query}`);
    await page.getByText('示例-A', { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await S.open(page, L);
    await page.waitForTimeout(700);
    samples[key] = await page.evaluate(sample);
    await page.screenshot({ path: `${OUT}/${key}-${TAG}.png` });
    console.log(`ok   ${key}`);
  } catch (e) {
    notRun++;
    console.log(`FAIL ${key}: ${String(e.message || e).split('\n')[0].slice(0, 120)}`);
    await page.screenshot({ path: `${OUT}/${key}-${TAG}-FAILED.png` }).catch(() => {});
  }
  await ctx.close();
}
await browser.close(); web.close();
writeFileSync(`${OUT}/samples-${TAG}.json`, JSON.stringify(samples, null, 1));
console.log(`\n${TAG}: ${Object.keys(samples).length} shots, ${notRun} not run`);
process.exit(notRun ? 1 : 0);
