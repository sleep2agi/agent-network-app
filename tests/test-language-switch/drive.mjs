// Actual web export, isolated placeholder Hub bridge. No production requests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '/output';
mkdirSync(out, { recursive: true });
const web = await serveExport(process.env.WEB_DIR || '/web');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let p = 0, t = 0;
const results = [];
function ck(name, ok, detail) {
  t++; if (ok) p++;
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`);
}
try {
  for (const [name, width, height] of [['desktop', 1200, 800], ['phone', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US', ...(name === 'phone' ? { userAgent: ANDROID_UA } : {}) });
    await context.addInitScript(initScript, { theme: 'light' });
    await context.addInitScript(() => { if (!localStorage.getItem('anet.language.v1')) localStorage.setItem('anet.language.v1', 'en'); });
    const page = await context.newPage();
    await page.goto(web.url);
    await page.getByText('示例-A', { exact: true }).first().click();
    const input = page.locator('textarea').filter({ visible: true }).first();
    await input.fill('中文 draft stays unchanged');
    await page.waitForTimeout(500);
    ck(`${name}: English chat placeholder`, (await input.getAttribute('placeholder'))?.includes('Message'));
    ck(`${name}: Agent message stays Chinese`, await page.getByText('示例回复:构建通过。', { exact: true }).count() > 0);
    await page.screenshot({ path: `${out}/${name}-chat-en.png` });
    const boxes = await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].map(el => {
      const b = el.getBoundingClientRect();
      return { text: el.getAttribute('aria-label') || el.textContent, x: b.x, right: b.right, width: b.width, height: b.height };
    }).filter(b => b.width > 0 && b.height > 0));
    ck(`${name}: visible buttons stay inside viewport`, boxes.every(b => b.x >= -1 && b.right <= width + 1), boxes.filter(b => b.x < -1 || b.right > width + 1));
    await page.evaluate(() => { window.__languagePageMarker = true; localStorage.setItem('anet.language.v1', 'zh'); window.dispatchEvent(new StorageEvent('storage', { key: 'anet.language.v1', newValue: 'zh' })); });
    await page.waitForTimeout(150);
    ck(`${name}: live switch preserves draft and page`, (await input.inputValue()) === '中文 draft stays unchanged' && await page.evaluate(() => window.__languagePageMarker === true));
    ck(`${name}: Chinese send label updates`, await page.getByRole('button', { name: '发送', exact: true }).count() > 0);
    await page.screenshot({ path: `${out}/${name}-chat-zh.png` });
    if (name === 'phone') await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    if (name === 'phone') await page.getByTestId('settings-row-appearance').click();
    else await page.getByRole('button', { name: '设置分类 外观', exact: true }).click();
    await page.getByTestId('settings-language-en').click();
    ck(`${name}: settings control switches immediately without reload`, await page.getByText('Language', { exact: true }).count() > 0 && await page.evaluate(() => window.__languagePageMarker === true));
    // Playwright scrolls nested containers to the clicked radio row. Capture the
    // complete appearance page from its top, not an arbitrary auto-scroll offset.
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach(el => { if (el.scrollTop) el.scrollTop = 0; }); });
    const geometry = await page.getByTestId('settings-language').evaluate(el => [...el.querySelectorAll('[data-testid$="-label"]')].map(label => {
      const b = label.getBoundingClientRect();
      return { text: label.textContent, left: b.left, right: b.right, height: b.height, overflow: label.scrollWidth > label.clientWidth + 1 };
    }));
    ck(`${name}: language labels align and fit`, geometry.length === 3 && Math.max(...geometry.map(b => b.left)) - Math.min(...geometry.map(b => b.left)) <= 1 && geometry.every(b => !b.overflow && b.left >= 0 && b.right <= width), geometry);
    await page.screenshot({ path: `${out}/${name}-settings-en.png` });
    await page.getByTestId('settings-language-system').click();
    ck(`${name}: Follow system resolves en-US`, await page.evaluate(() => localStorage.getItem('anet.language.v1') === 'system') && await page.getByText('Language', { exact: true }).count() > 0);
    await page.getByTestId('settings-language-zh').click();
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach(el => { if (el.scrollTop) el.scrollTop = 0; }); });
    await page.screenshot({ path: `${out}/${name}-settings-zh.png` });
    await page.reload();
    await page.getByRole('tab', { name: '设置', exact: true }).waitFor();
    ck(`${name}: explicit Chinese preference survives reload`, await page.evaluate(() => localStorage.getItem('anet.language.v1') === 'zh'));
    await context.close();
  }
} finally {
  await browser.close(); web.close();
  writeFileSync(`${out}/measurements.json`, JSON.stringify({ passed: p, total: t, results }, null, 2));
}
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
