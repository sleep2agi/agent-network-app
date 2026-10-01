// 连接状态角标 —— 取代全宽顶部横幅(Vincent 2026-10-01 iPad 截图:「缩到角落里,让我知道就行」)。量真框。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process, no
// port, no HOME touched). The link is degraded through the stub (window.__stubDelayMs / __stubFail), so the app's own
// slow / offline logic (src/connectivity.ts) decides the state — nothing is forced.
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-connectivity-indicator/drive.mjs
//
// desktop 1440×900 (desktop rail), iPad landscape 1366×1024 (iPad UA ⇒ two-pane + MobileNavRail), phone 390×844
// (Android UA ⇒ phone stack), light + dark. Per run:
//   online   no indicator, no banner text anywhere
//   slow     every read answered 6.5 s late → 「连接较慢」:
//            - no element carrying the status text is anywhere near viewport-wide (the old banner was 100%)
//            - the indicator is visible: wide = in the left rail, bottom 60 px, next to the version label;
//              phone = the top-right corner of the content
//            - accessible label carries the full text
//            - every reference box (list head, search box, first row, rail) is identical to the online state
//            - the indicator does not intersect any other interactive element
//            - hover (desktop) / tap (touch) shows the tip with the full text, inside the viewport
//   offline  every read fails → red 「无法连接服务器」, same no-shift / no-banner checks
//   recover  link back + tap the indicator → it is gone
// Prints a measurement table. Exit 1 when any check fails. Against an export from before this change it fails
// (banner spans the width, no indicator, content pushed down).
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWPORTS = {
  desktop: { w: 1440, h: 900, ua: undefined, wide: true },
  ipad: { w: 1366, h: 1024, ua: IPAD_UA, wide: true },
  phone: { w: 390, h: 844, ua: ANDROID_UA, wide: false },
};
// Boxes that must not move when the state flips (the page "title" row and what hangs off it).
const REFS = ['agents-list-head', 'agents-search', 'agent-group-示例', 'desktop-rail', 'mobile-nav-rail', 'two-pane-detail', 'nav-shell', 'rail-version'];
const STATUS_TEXT = /连接较慢|无法连接服务器/;

const rows = [];
const measures = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
const bb = async (page, sel) => { const l = page.locator(sel).first(); return (await l.count()) && await l.isVisible() ? l.boundingBox() : null; };
const measure = (where, el, b) => { if (b) measures.push({ where, el, x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }); };
const same = (a, b) => (!a && !b) || (!!a && !!b && ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) <= 0.5));
const inView = (b, V) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= V.w + 0.5 && b.y + b.height <= V.h + 0.5;

const refBoxes = async (page) => Object.fromEntries(await Promise.all(REFS.map(async id => [id, await bb(page, tid(id))])));
// Widest visible element whose own text (not a descendant's) carries the status text — the banner shape.
const widestStatusText = (page) => page.evaluate((src) => {
  const re = new RegExp(src);
  let widest = 0, text = '';
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
    if (!re.test(own)) continue;
    // the box the text paints in = its nearest block ancestor that has a background (a banner strip) or itself
    let box = el;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const bg = getComputedStyle(a).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { box = a; break; }
    }
    const w = box.getBoundingClientRect().width;
    if (w > widest) { widest = w; text = own.trim(); }
  }
  return { widest, text };
}, STATUS_TEXT.source);
// Interactive elements (other than the indicator itself and its own subtree / ancestors) intersecting the indicator.
const overlapping = (page) => page.evaluate(() => {
  const ind = document.querySelector('[data-testid="connectivity-indicator"]');
  if (!ind) return null;
  const b = ind.getBoundingClientRect();
  const hits = [];
  for (const el of document.querySelectorAll('[role="button"], button, a[href], input, textarea, [role="tab"], [role="link"], [tabindex="0"]')) {
    if (el === ind || ind.contains(el) || el.contains(ind) || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const ix = Math.min(b.right, r.right) - Math.max(b.left, r.left);
    const iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
    if (ix > 0.5 && iy > 0.5) hits.push(`${el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.tagName} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  return hits;
});

async function waitFor(page, fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(250); }
  return false;
}
const anyStatusText = (page) => page.evaluate((src) => new RegExp(src).test(document.body.innerText), STATUS_TEXT.source);

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const press = (loc) => (V.ua ? loc.tap() : loc.click());
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.locator(tid('agents-list-head')).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(2500);

      // ── online ──
      const online = await refBoxes(page);
      for (const [k, b] of Object.entries(online)) measure(`${where}/online`, k, b);
      record(where, 'online: no indicator, no status text', {
        noIndicator: (await page.locator(tid('connectivity-indicator')).count()) === 0,
        noText: !(await anyStatusText(page)),
      });
      await shot('1-online');

      // ── slow ──
      await page.evaluate(() => { window.__stubDelayMs = 6500; });
      const t0 = Date.now();
      const slowSeen = await waitFor(page, async () => (await page.locator(tid('connectivity-indicator-slow')).count()) > 0 || await anyStatusText(page), 45_000);
      await page.waitForTimeout(300);
      const slowMs = Date.now() - t0;
      const slow = await refBoxes(page);
      for (const [k, b] of Object.entries(slow)) measure(`${where}/slow`, k, b);
      const ind = await bb(page, tid('connectivity-indicator'));
      const dot = await bb(page, tid('connectivity-indicator-slow'));
      measure(`${where}/slow`, 'indicator', ind);
      measure(`${where}/slow`, 'dot', dot);
      const rail = online['desktop-rail'] ?? online['mobile-nav-rail'];
      const corner = V.wide
        ? !!ind && !!rail && ind.x >= rail.x - 0.5 && ind.x + ind.width <= rail.x + rail.width + 0.5 && ind.y + ind.height >= V.h - 60
          && !!dot && dot.x >= rail.x + 0.5 && dot.x + dot.width <= rail.x + rail.width - 0.5
        : !!ind && ind.x + ind.width >= V.w - 1 && ind.y <= 20;
      const wide = await widestStatusText(page);
      const label = ind ? await page.locator(tid('connectivity-indicator')).first().getAttribute('aria-label') : null;
      const hits = await overlapping(page);
      const moved = REFS.filter(k => !same(online[k], slow[k]));
      record(where, 'slow: small corner indicator, nothing moves', {
        reached: slowSeen,
        noWideBanner: wide.widest < V.w * 0.5,
        indicatorVisible: !!ind && !!dot && inView(ind, V),
        dotSmall: !!dot && dot.width <= 10 && dot.height <= 10,
        inCorner: corner,
        label: !!label && label.includes('连接较慢'),
        noShift: moved.length === 0,
        noOverlap: Array.isArray(hits) && hits.length === 0,
      }, { slowMs, widestText: `${r1(wide.widest)}px ${wide.text}`, moved: moved.join(',') || '-', overlaps: (hits ?? ['(no indicator)']).join(' | ') || '-', label });
      await shot('2-slow');

      // ── tooltip / popover ──
      if (ind) {
        const loc = page.locator(tid('connectivity-indicator')).first();
        if (V.ua) await loc.tap(); else await loc.hover();
        await page.waitForTimeout(300);
        const tip = await bb(page, tid('connectivity-indicator-tip'));
        measure(`${where}/slow`, V.ua ? 'tip(tap)' : 'tip(hover)', tip);
        const tipText = tip ? await page.locator(tid('connectivity-indicator-tip')).first().innerText() : '';
        const after = await refBoxes(page);
        record(where, `slow: ${V.ua ? 'tap' : 'hover'} shows the full text`, {
          shown: !!tip,
          text: /连接较慢/.test(tipText),
          inViewport: inView(tip, V),
          noShift: REFS.every(k => same(online[k], after[k])),
        }, { tipText: tipText.replace(/\n/g, ' ') });
        await shot('3-slow-tip');
        if (!V.ua) await page.mouse.move(V.w / 2, V.h / 2);
      } else {
        record(where, 'slow: tooltip', { indicatorExists: false });
      }

      // ── offline ──
      await page.evaluate(() => { window.__stubDelayMs = 0; window.__stubFail = true; });
      const offSeen = await waitFor(page, async () => (await page.locator(tid('connectivity-indicator-offline')).count()) > 0 || /无法连接服务器/.test(await page.evaluate(() => document.body.innerText)), 75_000);
      await page.waitForTimeout(300);
      const off = await refBoxes(page);
      for (const [k, b] of Object.entries(off)) measure(`${where}/offline`, k, b);
      const offInd = await bb(page, tid('connectivity-indicator'));
      measure(`${where}/offline`, 'indicator', offInd);
      const offWide = await widestStatusText(page);
      const offLabel = offInd ? await page.locator(tid('connectivity-indicator')).first().getAttribute('aria-label') : null;
      const offMoved = REFS.filter(k => !same(online[k], off[k]));
      record(where, 'offline: red dot, nothing moves', {
        reached: offSeen,
        red: (await page.locator(tid('connectivity-indicator-offline')).count()) > 0,
        noWideBanner: offWide.widest < V.w * 0.5,
        label: !!offLabel && offLabel.includes('无法连接服务器'),
        noShift: offMoved.length === 0,
      }, { widestText: `${r1(offWide.widest)}px ${offWide.text}`, moved: offMoved.join(',') || '-', label: offLabel });
      await shot('4-offline');

      // ── recover ──
      await page.evaluate(() => { window.__stubFail = false; });
      if (offInd) await press(page.locator(tid('connectivity-indicator')).first());
      const gone = await waitFor(page, async () => (await page.locator(tid('connectivity-indicator')).count()) === 0, 8_000);
      const back = await refBoxes(page);
      record(where, 'recover: link back + tap → indicator gone, boxes as before', { gone, noShift: REFS.every(k => same(online[k], back[k])) });
      await shot('5-recovered');
      record(where, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3).join(' | ') || '-' });
    } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL.png` }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
web.close();

console.log('\nmeasurements (CSS px):');
console.table(measures);
console.log(`\n${rows.filter(r => r.ok).length}/${rows.length} checks passed, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
