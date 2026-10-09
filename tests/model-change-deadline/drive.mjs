// Rendered Web export with a page-local Hub fixture, not native/real-Hub E2E.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';
const source = process.env.SOURCE_COMMIT;
assert.match(source ?? '', /^[0-9a-f]{40}$/);
assert.equal(source, process.env.EXPECTED_SOURCE_COMMIT);
console.log(`product_source=${source}; fixture Hub only`);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const fixture = () => {
  window.__modelCalls = []; window.__modelApplied = false;
  const node = { node_id: 'n_model_fixture', alias: 'model-fixture', runtime: 'opencode-cli',
    status: 'idle', lifecycle_state: 'running', config_revision: 0, model: 'stub/old',
    config_snapshot: { model: 'stub/old' }, network_id: 'net-sweep' };
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/api/status') return { ok: true, sessions: [node] };
    if (u.pathname === '/api/nodes') return { ok: true, nodes: [node] };
    if (u.pathname === '/api/nodes/n_model_fixture/config') return { ...node,
      config_update_capable: true, config_revision: window.__modelApplied ? 1 : 0,
      model: window.__modelApplied ? 'stub/next' : 'stub/old' };
    if (u.pathname === '/mcp') {
      const params = JSON.parse(bodyText || '{}').params;
      if (params?.name !== 'update_node_config') return undefined;
      window.__modelCalls.push(params.arguments);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, apply_mode: 'restart' }) }] } };
    }
  };
};
try {
  for (const slow of [false, true]) {
    const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(initScript, { theme: 'light' });
    await page.addInitScript(fixture);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    console.log('UI ready');
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: 'model-fixture' }));
    await page.getByRole('tab', { name: '模型与运行时', exact: true }).click();
    console.log('Model tab open');
    await page.getByPlaceholder(/模型 id\(provider\/model\)/).fill('stub/next');
    await page.getByText('切换模型', { exact: true }).click();
    await page.getByText(/已下发,节点正在以新模型重启/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__modelCalls), [{ node_id: 'n_model_fixture', base_revision: 0, patch: { model: 'stub/next' }, network_id: 'net-sweep' }]);
    if (!slow) {
      await page.evaluate(() => { window.__modelApplied = true; });
      await page.getByText('已切换到 stub/next', { exact: true }).waitFor({ timeout: 7000 });
      console.log('PASS fast model change: exact payload and matching revision readback');
    } else {
      const started = Date.now();
      await page.evaluate(() => { window.__stubDelayMs = 2000; });
      try {
        await page.getByText(/但 90s 内节点没有以新模型回来/).waitFor({ timeout: 95000 });
      } catch (error) {
        console.log(`FAIL wall-clock deadline after ${Date.now() - started}ms; UI=${await page.getByText(/已下发,节点正在以新模型重启/).allTextContents()}`);
        throw error;
      }
      await page.evaluate(() => { window.__stubDelayMs = 0; window.__modelApplied = true; });
      await page.waitForTimeout(6000);
      assert.equal(await page.getByText('已切换到 stub/next', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.__modelCalls.length), 1);
      console.log('PASS slow reads: 90s wall-clock deadline, no late revival or implicit resubmission');
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
} finally { await browser.close(); await web.close(); }
