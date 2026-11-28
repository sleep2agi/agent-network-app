import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
try {
  for (const mobile of [false, true]) {
    for (const [name, report, expected] of [
      ['unsupported', { runtime: 'antigravity' }, [0, 0, 0]],
      ['interrupt-only', { turn_interrupt_capable: true, turn_steer_capable: false }, [1, 1, 0]],
      ['both', { turn_interrupt_capable: true, turn_steer_capable: true }, [1, 1, 1]],
      ['explicit-no', { runtime: 'opencode-cli', opencode_generation: 'v2', opencode_mode: 'copresence', version: '2.5.0-preview.210', turn_interrupt_capable: false, turn_steer_capable: false }, [0, 0, 0]],
    ]) {
      const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, locale: TEST_LOCALE, ...(mobile ? { userAgent: ANDROID_UA } : {}) });
      const page = await ctx.newPage();
      await page.addInitScript(initScript, { theme: 'light' });
      await page.addInitScript(report => {
        window.__routeOverride = u => {
          if (u.pathname === '/api/status') {
            if (u.searchParams.get('light') !== '1') window.__turnStatusReady = true;
            return { ok: true, sessions: [
              { alias: '示例-A', node_id: 'n_sweep_a', status: 'working', ...report },
              { alias: '示例-B', node_id: 'n_sweep_b', status: 'working', runtime: 'antigravity', turn_interrupt_capable: false, turn_steer_capable: false },
            ] };
          }
          return undefined;
        };
      }, report);
      await page.goto(web.url);
      await page.locator('[data-agent-alias="示例-A"]').first().click({ timeout: 30000 });
      await page.getByTestId('chat-header-title').waitFor();
      // Inject deliberately hides for an empty draft, independently of runtime support.
      await page.locator('textarea').last().fill('能力门控测试草稿');
      // Wait for the full capability read, not just the first fail-closed frame.
      await page.waitForFunction(() => (window.__turnStatusReady === true));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const ids = ['composer-stop-entry', 'composer-interrupt-send', 'composer-inject'];
      for (let i = 0; i < ids.length; i++) assert.equal(await page.getByTestId(ids[i]).count(), expected[i], `${mobile ? 'mobile' : 'desktop'} ${name} ${ids[i]}`);
      if (mobile && name === 'both') {
        const modelRow = await page.getByTestId('composer-model-row').boundingBox();
        const modelEntry = await page.getByTestId('composer-model-entry').boundingBox();
        const turnRow = await page.getByTestId('composer-turn-row').boundingBox();
        const stopEntry = await page.getByTestId('composer-stop-entry').boundingBox();
        assert.ok(modelRow && modelEntry && turnRow && stopEntry, 'mobile full-toolbar rows should all render');
        assert.ok(modelEntry.width >= 60, `mobile model pill should not be squashed into a blank bar (width=${modelEntry.width})`);
        assert.ok(turnRow.y >= modelRow.y + modelRow.height - 1, 'mobile turn controls sit cleanly below model row without overlapping');
        assert.ok(stopEntry.x >= 0 && stopEntry.x + stopEntry.width <= 390, 'mobile stop button stays inside viewport');
      }
      if (!mobile && name === 'both') {
        await page.locator('[data-agent-alias="示例-B"]').first().click();
        await page.getByTestId('chat-header-title').filter({ hasText: '示例-B' }).waitFor();
        await page.locator('textarea').last().fill('切换后的草稿');
        for (const id of ids) assert.equal(await page.getByTestId(id).count(), 0, `switch to unsupported: ${id}`);
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); await web.close(); }
