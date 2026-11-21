import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR, OUT } = process.env;
if (!WEB_DIR || !OUT) throw new Error('WEB_DIR and OUT required');
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
try {
  for (const width of [1024, 1440, 390]) for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, locale: TEST_LOCALE,
      ...(width === 390 ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36' } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(() => {
      window.__chatTasksFixture = [{ task_id: 'sender-card', from_name: '示例-B', from_node_id: 'n_sweep_b', to_name: '示例-A', content: '来自另一节点的消息', result: '当前节点回复', status: 'replied', created_at: new Date().toISOString() }];
      window.__routeOverride = u => {
        if (u.pathname.endsWith('/members')) return { members: [{ user_id: 'user-tester', username: 'tester', role: 'admin' }] };
        if (u.pathname.endsWith('/departments')) return { departments: [], members: [] };
        return undefined;
      };
    });
    await page.goto(web.url);
    await page.locator('[data-agent-alias="示例-A"]').first().click({ timeout: 30000 });
    await page.getByTestId('chat-sender-avatar-foreign').first().click({ timeout: 15000 });
    const card = page.getByTestId('chat-sender-identity');
    await card.getByText('示例-B', { exact: true }).waitFor();
    const message = page.getByTestId('chat-sender-message');
    await message.waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId('chat-info-row-search').count(), 0);
    if (width === 390) {
      await page.waitForFunction(() => {
        const panel = document.querySelector('[data-testid="chat-info-panel"]');
        return panel && Math.abs(panel.getBoundingClientRect().top) < 1;
      });
    }
    await page.screenshot({ path: `${OUT}/${width}-${theme}-sender.png` });
    await message.click();
    await page.getByTestId('chat-header').getByText('示例-B', { exact: true }).first().waitFor({ timeout: 10000 });
    assert.equal(await card.count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width} ${theme}: sender identity, no conversation tools, message navigation`);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close();
}
