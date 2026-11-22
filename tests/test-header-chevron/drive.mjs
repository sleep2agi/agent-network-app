import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR, OUT } = process.env;
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
try {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, locale: TEST_LOCALE,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36' });
    const page = await ctx.newPage();
    await page.addInitScript(initScript, { theme });
    await page.goto(web.url);
    await page.locator('[data-agent-alias="示例-A"]').first().click({ timeout: 30000 });
    await page.getByTestId('chat-header-title').waitFor();
    const result = await page.getByTestId('chat-header-title').evaluate(col => {
      const row = col.firstElementChild;
      const [title, arrow] = row.children;
      const t = title.getBoundingClientRect(), a = arrow.getBoundingClientRect();
      return { gap: a.left - t.right, titleWidth: t.width, rowWidth: row.getBoundingClientRect().width };
    });
    console.log(theme, result);
    assert.ok(Math.abs(result.gap - 4) < 1, 'chevron gap is 4px');
    assert.ok(result.titleWidth < result.rowWidth / 2, 'short title does not stretch across header');
    await page.screenshot({ path: `${OUT}/phone-${theme}.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
  await web.close();
}
