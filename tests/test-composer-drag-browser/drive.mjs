// app#240 —— 真浏览器(真鼠标)对照:0.2.46 形状的分隔条 vs 修复后的分隔条。
// 老形状是阳性对照:它必须复现「拖不动 + 全选」,否则这个量具本身不可信。
import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse())
    for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  throw new Error('no chromium under ~/.cache/ms-playwright');
};
const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, executablePath: findExe() }));
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.split('\n')[0]));
await page.goto(`http://127.0.0.1:${process.env.PORT || 8765}/index.html`);
await page.waitForSelector('[data-testid="fixed-h"]', { timeout: 10000 });
await page.evaluate(() => { window.__dp = {}; document.addEventListener('mousedown', (e) => { window.__dp[e.target.closest('[data-testid]')?.dataset.testid ?? '?'] = e.defaultPrevented; }, false); });
const dragged = async (id) => {
  const box = await page.locator(`[data-testid="${id}-divider"]`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const h = async () => Number(await page.locator(`[data-testid="${id}-h"]`).innerText());
  const sel = async () => page.evaluate(() => window.getSelection().toString().length);
  const bodyUS = async () => page.evaluate(() => document.body.style.userSelect);
  const h0 = await h();
  await page.mouse.move(cx, cy); await page.mouse.down();
  const bodyUserSelectDuring = await bodyUS();
  await page.mouse.move(cx, cy - 40, { steps: 8 }); const h1 = await h();
  await page.mouse.move(cx, cy - 100, { steps: 12 }); const h2 = await h();
  await page.mouse.move(cx + 30, cy - 140, { steps: 8 }); const h3 = await h(); // wander over the message list
  const selDuringChars = await sel();
  await page.screenshot({ path: `${here}/out/${id}-during.png` });
  await page.mouse.up();
  const hEnd = await h(); const selAfterChars = await sel(); const bodyUserSelectAfter = await bodyUS();
  const mousedownPrevented = await page.evaluate((id) => window.__dp[`${id}-divider`], id);
  return { id, h0, h1, h2, h3, hEnd, expectedEnd: h0 + 140, mousedownPrevented, selDuringChars, selAfterChars, bodyUserSelectDuring, bodyUserSelectAfter };
};
const results = {};
for (const id of ['old', 'fixed']) { results[id] = await dragged(id); console.log(JSON.stringify(results[id])); await page.evaluate(() => window.getSelection().removeAllRanges()); }
await browser.close();
const bad = [];
const o = results.old, f = results.fixed;
if (!(o.hEnd < o.expectedEnd - 100 && o.selDuringChars > 0 && o.mousedownPrevented === false)) bad.push('positive control (0.2.46 shape) did NOT reproduce stall + selection — harness untrusted');
if (f.hEnd !== f.expectedEnd || f.h1 !== f.h0 + 40 || f.h2 !== f.h0 + 100) bad.push(`fixed divider does not track the mouse: ${JSON.stringify([f.h0, f.h1, f.h2, f.h3, f.hEnd])}`);
if (f.selDuringChars !== 0 || f.selAfterChars !== 0) bad.push(`fixed divider still selects text: ${f.selDuringChars}/${f.selAfterChars} chars`);
if (f.mousedownPrevented !== true) bad.push('fixed divider does not preventDefault the mousedown');
if (f.bodyUserSelectDuring !== 'none' || f.bodyUserSelectAfter !== '') bad.push(`body user-select not locked/restored: '${f.bodyUserSelectDuring}' → '${f.bodyUserSelectAfter}'`);
if (bad.length) { for (const b of bad) console.error('✗', b); process.exit(1); }
console.log('✓ composer drag: 0.2.46 shape reproduces both bugs; fixed divider tracks the mouse and selects nothing');
