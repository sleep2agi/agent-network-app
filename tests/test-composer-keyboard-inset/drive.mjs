// #547 — the iOS keyboard (Chinese 9-key + candidate bar) covered the chat composer.
// Real app (expo web export + the layout sweep's in-page hub stub; no hub process, no port, no HOME).
//
//   WEB_DIR=<expo web export> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-composer-keyboard-inset/drive.mjs
//
// `?keyboardSim=1` makes the screens run their iOS keyboard path (src/screen-keyboard-inset.tsx) against a fake
// Keyboard; the drive emits the frames iOS would (keyboardWillShow / keyboardWillChangeFrame / keyboardWillHide,
// endCoordinates.screenY = viewport height − keyboard height). `?safeAreaSim=<top>,0,0,0` gives the window a top
// safe-area inset the way the phone has one, so the chat sits under the nav shell at window y = top — the nesting
// that made RN's KeyboardAvoidingView come out one top inset short.
//
// Per viewport (iPhone 14 / 16 Pro Max portrait, iPhone 14 landscape) and screen (agent chat, DM):
//   seat   : composer bottom == keyboard top ±2px, for each frame in a sequence that changes height mid-way
//            (9-key with candidates → English → emoji → candidates again)
//   last   : the newest message's last line is visible between header and composer while the keyboard is up (chat)
//   hide   : after keyboardWillHide the composer is back at the screen bottom ±2px
//   no-x   : no horizontal page scroll
// Plus desktop 1320×754: the sim never touches it (no keyboard listeners outside the iOS path): composer unchanged.
// Witness: on origin/main (before #547) every `seat` row is red — the web KAV has no iOS path at all, and the unit
// test src/keyboard-inset.test.ts shows the device formula was one top inset short.
// Exit 1 when any check fails or a screen could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const NEAR = 2;
const rows = [];
let failures = 0;
const r1 = (n) => (n == null ? n : Math.round(n * 10) / 10);
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const NEWEST = '最新一条消息-键盘上方必须看得见';
// Enough history that the list overflows; newest first like the hub.
const chatFixture = () => {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const out = [{ task_id: 't_kb_newest', from_name: 'tester', to_name: '示例-A', content: '示例问题', result: NEWEST, status: 'replied', priority: 'normal', created_at: iso(1), updated_at: iso(1), completed_at: iso(1) }];
  for (let i = 1; i <= 24; i++) out.push({ task_id: `t_kb_${i}`, from_name: 'tester', to_name: '示例-A', content: `示例历史 ${i}`, result: `示例回复 ${i}:占位文字,用来把列表撑满。`, status: 'replied', priority: 'normal', created_at: iso(10 + i * 3), updated_at: iso(9 + i * 3), completed_at: iso(9 + i * 3) });
  return out;
};

// Geometry read in the page. Composer = the direct child of the screen root that contains the visible textarea.
const measure = (page, paneId, newest = null) => page.evaluate(([paneId, newest]) => {
  const pane = document.querySelector(`[data-testid="${paneId}"]`);
  const ta = [...document.querySelectorAll('textarea')].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  if (!pane || !ta) return null;
  let row = ta;
  while (row.parentElement && row.parentElement !== pane) row = row.parentElement;
  if (row.parentElement !== pane) return null;
  const rb = row.getBoundingClientRect();
  const pb = pane.getBoundingClientRect();
  const header = pane.querySelector('[data-testid="chat-header"], [data-testid="dm-header"]')?.getBoundingClientRect();
  let last = null;
  if (newest) {
    const el = [...pane.querySelectorAll('div, span')].filter(e => e.childElementCount === 0 && (e.textContent || '').includes(newest)).pop();
    if (el) { const b = el.getBoundingClientRect(); last = { top: b.top, bottom: b.bottom }; }
  }
  return {
    composerTop: rb.top, composerBottom: rb.bottom, paneBottom: pb.bottom,
    headerBottom: header?.bottom ?? pb.top, last,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
}, [paneId, newest]);

const emit = (page, name, height, vh) => page.evaluate(([name, height, vh]) => {
  const n = window.__anetKeyboardSim?.emit(name, { endCoordinates: { screenY: vh - height, height, screenX: 0, width: window.innerWidth }, duration: 250, easing: 'keyboard' }) ?? -1;
  return n;
}, [name, height, vh]);

const settle = (page) => page.waitForTimeout(250);

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

const VIEWPORTS = [
  { name: 'iPhone 14 portrait', w: 390, h: 844, top: 47, frames: [['keyboardWillShow', 380], ['keyboardWillChangeFrame', 336], ['keyboardWillShow', 336], ['keyboardWillChangeFrame', 380]] },
  { name: 'iPhone 16 Pro Max portrait', w: 440, h: 956, top: 62, frames: [['keyboardWillShow', 336], ['keyboardWillChangeFrame', 392], ['keyboardWillChangeFrame', 301]] },
  { name: 'iPhone 14 landscape', w: 844, h: 390, top: 0, frames: [['keyboardWillShow', 200], ['keyboardWillChangeFrame', 209], ['keyboardWillChangeFrame', 172]] },
];
const SCREENS = [
  { name: 'chat', pane: 'chat-pane', screen: { name: 'chat', alias: '示例-A' }, newest: NEWEST },
  { name: 'dm', pane: 'dm-pane', screen: { name: 'dm', alias: 'peer-demo', userId: 'u_peer_demo', displayName: '示例同事' }, newest: null },
];

async function open(v, sc, { touch = true, sim = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'dark', deviceScaleFactor: 1, locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(() => { try { localStorage.setItem('voice_composer_input_mode_v1', 'keyboard'); } catch { /* default */ } });
  await page.addInitScript((tasks) => { window.__chatTasksFixture = tasks; }, chatFixture());
  await page.addInitScript(initScript, { theme: 'dark' });
  await page.goto(`${url}?safeAreaSim=${v.top ?? 0},0,0,0${sim ? '&keyboardSim=1' : ''}`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
  await page.evaluate((s) => window.__anetLayoutSweep.setScreen(s), sc.screen);
  await page.waitForFunction((id) => !!document.querySelector(`[data-testid="${id}"]`) && [...document.querySelectorAll('textarea')].some(e => e.getClientRects().length), sc.pane, { timeout: 15000 });
  if (sc.newest) await page.waitForFunction((t) => document.body.innerText.includes(t), sc.newest, { timeout: 15000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

for (const v of VIEWPORTS) for (const sc of SCREENS) {
  const vp = `${v.name} ${v.w}x${v.h} ${sc.name}`;
  let ctx, page;
  try { ({ ctx, page } = await open(v, sc)); } catch (e) {
    record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] });
    await ctx?.close();
    continue;
  }
  const rest = await measure(page, sc.pane, sc.newest);
  record(vp, 'rest', { measured: !!rest, atBottom: !!rest && Math.abs(rest.composerBottom - v.h) <= NEAR }, { composerBottom: r1(rest?.composerBottom) });
  const ta = page.locator('textarea').filter({ visible: true }).first();
  await ta.click();
  let i = 0;
  for (const [event, height] of v.frames) {
    const listeners = await emit(page, event, height, v.h);
    await settle(page);
    const m = await measure(page, sc.pane, sc.newest);
    const kbTop = v.h - height;
    const checks = {
      listened: listeners > 0,
      measured: !!m,
      seat: !!m && Math.abs(m.composerBottom - kbTop) <= NEAR,
      noX: !!m && !m.overflowX,
    };
    // The newest message's last line sits between the header and the composer (WeChat: the list stays pinned to
    // the newest message; in landscape a tall bubble may lose its top, never its end).
    if (sc.newest) checks.last = !!m?.last && m.last.bottom <= m.composerTop + 1 && m.last.bottom - 16 >= m.headerBottom - 1;
    record(vp, `${++i}:${event} ${height}`, checks, { keyboardTop: kbTop, composerBottom: r1(m?.composerBottom), delta: m ? r1(m.composerBottom - kbTop) : null, lastBottom: r1(m?.last?.bottom), headerBottom: r1(m?.headerBottom), composerTop: r1(m?.composerTop) });
    if (OUT && i === 1) await page.screenshot({ path: join(OUT, `${v.w}x${v.h}-${sc.name}-kb${height}.png`) });
  }
  await emit(page, 'keyboardWillHide', v.frames[0][1], v.h + v.frames[0][1]);
  await settle(page);
  const after = await measure(page, sc.pane, sc.newest);
  record(vp, 'hide', { measured: !!after, atBottom: !!after && Math.abs(after.composerBottom - v.h) <= NEAR }, { composerBottom: r1(after?.composerBottom) });
  await ctx.close();
}

// Desktop: same sim flag, no keyboard path (Platform.OS web + pointer); the composer must not move.
{
  const v = { name: 'desktop', w: 1320, h: 754, top: 0 };
  const sc = SCREENS[0];
  try {
    const { ctx, page } = await open(v, sc, { touch: false, sim: false });
    const before = await measure(page, sc.pane, sc.newest);
    const listeners = await page.evaluate(() => window.__anetKeyboardSim ? 1 : 0);
    record(`desktop ${v.w}x${v.h} chat`, 'no keyboard sim / unchanged', { measured: !!before, noSim: listeners === 0, atBottom: !!before && before.composerBottom <= v.h + NEAR }, { composerBottom: r1(before?.composerBottom) });
    await ctx.close();
  } catch (e) {
    record('desktop 1320x754 chat', 'open', { opened: false }, { error: String(e).split('\n')[0] });
  }
}

await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} rows ok`);
process.exit(failures ? 1 : 0);
