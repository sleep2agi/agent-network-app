// Production web bundle, page-local Hub fixture, real Chromium in Docker.
// Not an authenticated Hub/native-package/model-call E2E.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let passed = 0;
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1200, height: 850 }]) {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(initScript, { theme: 'light' });
    await page.addInitScript(() => {
      window.__catalogReads = 0;
      window.__routeOverride = (url, text) => {
        if (url.pathname !== '/mcp') return;
        if (JSON.parse(text || '{}')?.params?.name !== 'list_providers') return;
        window.__catalogReads++;
        return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true,
          providers: [{ id: 'foreign-provider', runtimes: ['codex-app-server', 'opencode-cli'], models: ['foreign-model'], api_key: 'sk-FAKE-scope-secret' }],
        }) }] } };
      };
    });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    const open = async (id, local = false) => {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
      await page.evaluate(({ id, local }) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: {
        daemon_node_id: id, alias: id, online: true, can_create_nodes: true,
        runtimes_supported: ['codex-app-server', 'opencode-cli'],
        ...(local ? { runtime_readiness: {
          'codex-app-server': { state: 'ready', providers: [{ id: 'local-provider', models: ['local-model'] }] },
          'opencode-cli': { state: 'ready', providers: [{ id: 'local-provider', models: ['local-model'] }] },
        } } : {}),
      } }), { id, local });
      await page.getByTestId('create-name-input').fill('scope-fixture');
      await page.getByTestId('create-node-next').click();
      await page.getByTestId('runtime-row-codex-app-server').click();
    };
    await open('daemon-a', true);
    await page.waitForFunction(() => window.__catalogReads > 0);
    const catalog = page.getByTestId('daemon-runtime-providers');
    await page.getByTestId('daemon-runtime-providers-codex').waitFor();
    assert((await catalog.innerText()).includes('local-model')); passed++;
    assert(!(await catalog.innerText()).includes('foreign-model')); passed++;
    await page.getByTestId('runtime-row-opencode-cli').click();
    await page.getByTestId('opencode-generation-v2').click();
    await page.getByTestId('daemon-runtime-providers-opencode').waitFor();
    assert((await catalog.innerText()).includes('local-provider/local-model')); passed++;
    assert(!(await catalog.innerText()).includes('foreign-model')); passed++;
    await open('daemon-b');
    await page.getByTestId('daemon-runtime-providers-upgrade').waitFor();
    assert(!(await catalog.innerText()).includes('local-model')); passed++;
    assert(!(await catalog.innerText()).includes('foreign-model')); passed++;
    assert(!(await page.locator('body').innerText()).includes('sk-FAKE-scope-secret')); passed++;
    assert.deepEqual(errors, []); passed++;
    await ctx.close();
  }
  console.log(`PASS rendered daemon scope: ${passed}/16 assertions (phone + desktop)`);
} finally { await browser.close(); web.close(); }
