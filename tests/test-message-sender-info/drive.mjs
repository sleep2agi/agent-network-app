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
        if (window.__senderDirectoryFailure && u.pathname.endsWith('/members')) return { ok: false, error: 'permission_denied' };
        if (u.pathname === '/api/nodes') return { nodes: [
          { node_id: 'n_sweep_a', alias: '示例-A', department_id: null },
          { node_id: 'n_sweep_b', alias: '示例-B', node_name: '发送方显示名', department_id: null },
        ] };
        if (u.pathname.endsWith('/members')) return { members: [{ user_id: 'user-tester', username: 'tester', role: 'admin' }] };
        if (u.pathname.endsWith('/departments')) return { departments: [], members: [] };
        return undefined;
      };
    });
    await page.goto(web.url);
    await page.locator('[data-agent-alias="示例-A"]').first().click({ timeout: 30000 });
    const sourceAvatar = page.getByTestId('chat-sender-avatar-foreign').first();
    await sourceAvatar.waitFor({ timeout: 15000 });
    const sourceImage = await sourceAvatar.locator('img').getAttribute('src');
    await sourceAvatar.click();
    const card = page.getByTestId('chat-sender-identity');
    await card.getByText('发送方显示名', { exact: true }).waitFor();
    assert.equal(await card.locator('img').getAttribute('src'), sourceImage, 'display name must not change avatar identity');
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
    if (width !== 390) {
      const layers = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="chat-info-panel"]');
        const rect = panel.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.bottom - 45;
        const hit = document.elementFromPoint(x, y);
        const chain = [];
        for (let el = panel; el; el = el.parentElement) {
          const css = getComputedStyle(el);
          chain.push({ testID: el.getAttribute('data-testid'), background: css.backgroundColor,
            zIndex: css.zIndex, opacity: css.opacity, position: css.position });
        }
        return { panelOwnsBottom: panel.contains(hit), hitTestID: hit?.getAttribute('data-testid'), chain };
      });
      console.log(`LAYERS ${width} ${theme} ${JSON.stringify(layers)}`);
      assert.notEqual(layers.chain[0].background, 'rgba(0, 0, 0, 0)', 'drawer must remain opaque inside glass content');
      assert.equal(layers.panelOwnsBottom, true);
    }
    const closeCard = async () => {
      if (width === 390) await page.getByTestId('chat-info-back').click();
      else await page.keyboard.press('Escape');
      await card.waitFor({ state: 'detached' });
    };
    await closeCard();
    await page.getByTestId('chat-header').getByText('示例-A', { exact: true }).first().waitFor();
    await page.evaluate(() => { window.__senderDirectoryFailure = true; });
    await sourceAvatar.click();
    await card.getByText('无法确认发送方身份，请关闭后重试', { exact: true }).waitFor();
    assert.equal(await message.count(), 0, 'directory failure must not expose a guessed navigation target');
    await closeCard();
    await page.evaluate(() => { window.__senderDirectoryFailure = false; });
    await sourceAvatar.click();
    await card.getByText('发送方显示名', { exact: true }).waitFor();
    await message.click();
    await page.getByTestId('chat-header').getByText('示例-B', { exact: true }).first().waitFor({ timeout: 10000 });
    assert.equal(await card.count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width} ${theme}: identity, close preserves chat, directory error, reopen recovery, message navigation`);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close();
}
