// Desktop chat view (owner's screenshot: Windows 0.2.137 at 1320×754): the composer card, measured.
// Expo web export + the layout sweep's Tauri stub (placeholder data, no hub, no port). Not in CI.
//
//   WEB_DIR=<expo web export> OUT=<png dir> TAG=before|after [MEASURE=0] \
//   [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-modern-ui/desktop-chat.mjs
//
// Screenshots at 1320×754 and 1200×800, light and dark: empty draft, and a 5-line draft.
// MEASURE=1 (default; needs the card build) asserts, per size and theme:
//   insets   card left / right / bottom gap to the chat pane are equal (±1px) and = 12
//   toolbar  ＋ / shortcut hint / 🎤 / 发送 share one centre line (±1px)
//   grow     1 line → min card; 5 lines → +4 lines; 60 lines → 40% of the pane, textarea scrolls
//   drag     dragging the divider up 100px makes the card 100px taller (±2); dragging back restores it
// Exit 1 on any failed check or a size that could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT, TAG = process.env.TAG || 'run';
const MEASURE = process.env.MEASURE !== '0';
if (!WEB || !OUT) throw new Error('need WEB_DIR and OUT');
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (tag, name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`); };
const r1 = (n) => Math.round(n * 10) / 10;

const geom = () => {
  const card = document.querySelector('[data-testid="desktop-composer-card"]');
  const header = document.querySelector('[data-testid="chat-header"]');
  if (!card || !header) return null;
  // the chat pane = the header's parent (the chat root spans the pane)
  const pane = header.parentElement.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const ta = card.querySelector('textarea');
  const cy = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const plus = card.querySelector('[data-testid="composer-desktop-plus"]');
  const hint = card.querySelector('[data-testid="composer-shortcut-hint"]');
  // 发送 is a Pressable; when disabled RN-web drops its role, so find it by its label text's box
  const sendText = [...card.querySelectorAll('div')].find(d => [...d.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === '发送'));
  const send = sendText?.parentElement;
  const mic = [...card.querySelectorAll('[role="button"],button,[aria-label]')].find(b => /语音|麦克风|mic/i.test(b.getAttribute('aria-label') || ''));
  const items = { plus, hint, mic, send };
  const cys = Object.fromEntries(Object.entries(items).filter(([, el]) => el).map(([k, el]) => [k, cy(el)]));
  const cs = getComputedStyle(card);
  return {
    pane: { x: pane.left, r: pane.right, b: pane.bottom, h: pane.height },
    card: { x: c.left, r: c.right, t: c.top, b: c.bottom, h: c.height, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, border: `${cs.borderTopWidth} ${cs.borderTopColor}` },
    insets: { left: c.left - pane.left, right: pane.right - c.right, bottom: pane.bottom - c.bottom },
    cys,
    ta: ta ? { scrollH: ta.scrollHeight, clientH: ta.clientHeight } : null,
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [w, h] of [[1320, 754], [1200, 800]]) for (const theme of ['light', 'dark']) {
  const tag = `${w}x${h}-${theme}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(initScript, { theme });
    await page.goto(web.url);
    await page.locator('[data-agent-alias="示例-A"]').first().click({ timeout: 30000 });
    await page.locator('[data-testid="chat-header"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/desktop-chat-${tag}-empty-${TAG}.png` });
    const ta = page.locator('textarea').first();
    await ta.fill('第一行\n第二行\n第三行\n第四行\n第五行');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/desktop-chat-${tag}-5lines-${TAG}.png` });
    if (MEASURE) {
      await ta.fill('');
      await page.waitForTimeout(300);
      const g0 = await page.evaluate(geom);
      check(tag, 'composer card present', !!g0);
      if (g0) {
        const { left, right, bottom } = g0.insets;
        check(tag, 'insets left = right = bottom (±1) = 12', Math.abs(left - right) <= 1 && Math.abs(left - bottom) <= 1 && Math.abs(left - 12) <= 1, `L ${r1(left)} R ${r1(right)} B ${r1(bottom)}`);
        const vals = Object.values(g0.cys);
        const spread = Math.max(...vals) - Math.min(...vals);
        check(tag, 'toolbar controls on one centre line (±1)', vals.length >= 4 && spread <= 1, `${Object.entries(g0.cys).map(([k, v]) => `${k}:${r1(v)}`).join(' ')} spread ${r1(spread)}`);
        check(tag, 'card radius 16', g0.card.radius === '16px', g0.card.radius);
        check(tag, theme === 'light' ? 'light: soft shadow' : 'dark: visible border, no shadow', theme === 'light' ? g0.card.shadow !== 'none' : g0.card.shadow === 'none' && g0.card.border.startsWith('1px'), `${g0.card.shadow.slice(0, 40)} | ${g0.card.border}`);
        check(tag, 'empty draft: compact card (one line + toolbar = 81)', Math.abs(g0.card.h - 81) <= 1, `h ${r1(g0.card.h)}`);
        await ta.fill('第一行\n第二行\n第三行\n第四行\n第五行');
        await page.waitForTimeout(300);
        const g5 = await page.evaluate(geom);
        check(tag, '5 lines: grows by 4 lines (84 ±2)', Math.abs(g5.card.h - g0.card.h - 84) <= 2, `h ${r1(g0.card.h)} → ${r1(g5.card.h)}`);
        check(tag, '5 lines: insets unchanged', Math.abs(g5.insets.bottom - g0.insets.bottom) <= 1 && Math.abs(g5.insets.left - g0.insets.left) <= 1);
        await ta.fill(Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行`).join('\n'));
        await page.waitForTimeout(300);
        const gL = await page.evaluate(geom);
        const cap = Math.floor(gL.pane.h * 0.4);
        check(tag, '60 lines: stops at 40% of the pane, then scrolls', Math.abs(gL.card.h - cap) <= 2 && gL.ta && gL.ta.scrollH > gL.ta.clientH, `h ${r1(gL.card.h)} cap ${cap} scroll ${gL.ta?.scrollH}/${gL.ta?.clientH}`);
        await ta.fill('');
        await page.waitForTimeout(300);
        // drag the divider (just above the card wrap) up 100px, then back down
        const div = page.locator('[aria-label="拖动调整输入框高度"]').first();
        const db = await div.boundingBox();
        const x = db.x + db.width / 2, y = db.y + db.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(x, y - 10 * i);
        await page.mouse.up(); await page.waitForTimeout(300);
        const gU = await page.evaluate(geom);
        check(tag, 'divider drag up 100 → card +100 (±2)', Math.abs(gU.card.h - g0.card.h - 100) <= 2, `h ${r1(g0.card.h)} → ${r1(gU.card.h)}`);
        const db2 = await div.boundingBox();
        const y2 = db2.y + db2.height / 2;
        await page.mouse.move(x, y2); await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(x, y2 + 10 * i);
        await page.mouse.up(); await page.waitForTimeout(300);
        const gD = await page.evaluate(geom);
        check(tag, 'divider drag back down → compact again', Math.abs(gD.card.h - g0.card.h) <= 2, `h ${r1(gD.card.h)}`);
        const sel = await page.evaluate(() => String(getSelection?.() || '').length);
        check(tag, 'dragging selected no page text (#2026-09-05 regression)', sel === 0, `selection ${sel}`);
      }
    }
  } catch (e) {
    failed++;
    console.log(`FAIL [${tag}] not run: ${String(e.message || e).split('\n')[0].slice(0, 140)}`);
  }
  await ctx.close();
}
await browser.close(); web.close();
console.log(`\n${TAG}: ${failed} failing`);
process.exit(failed ? 1 : 0);
