// Actual exported App UI; synthetic scoped MCP/native HTTP. Not a native install or real provider inference.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let passed = 0;
try {
  const context = await browser.newContext({ locale: TEST_LOCALE, viewport: { width: 1200, height: 900 } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript({ content: `(${initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200')})({theme:'light'});` });
  await page.addInitScript(() => {
    window.__keys = ['EXISTING_KEY']; window.__writes = []; window.__mode = 'ok';
    const envelope = value => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
    window.__routeOverride = (url, body) => {
      if (url.pathname !== '/mcp') return;
      const { name, arguments: a } = JSON.parse(body || '{}').params || {};
      if (name === 'list_network_secrets') return envelope({ ok: true, keys: window.__keys });
      if (name === 'upsert_network_secret') {
        window.__writes.push({ key: a.key, network_id: a.network_id, valueMatches: a.value === 'TEST-ONLY-key' });
        if (window.__mode === 'denied') return envelope({ ok: false, error: 'secret_owner_only' });
        if (!window.__keys.includes(a.key)) window.__keys.push(a.key);
        return envelope({ ok: true, key: a.key });
      }
    };
  });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.getByText('示例-A', { exact: true }).first().waitFor();
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'hubTokens' }));
  await page.getByTestId('hub-token-row-EXISTING_KEY').waitFor(); passed++;
  await page.getByTestId('hub-token-name').fill('DEEPSEEK_API_KEY');
  await page.getByTestId('hub-token-value').fill('TEST-ONLY-key');
  await page.getByTestId('hub-token-save').click();
  await page.getByTestId('hub-token-row-DEEPSEEK_API_KEY').waitFor(); passed++;
  assert.equal(await page.getByTestId('hub-token-value').inputValue(), ''); passed++;
  assert.deepEqual(await page.evaluate(() => window.__writes), [{ key: 'DEEPSEEK_API_KEY', network_id: 'net-sweep', valueMatches: true }]); passed++;
  assert((await page.getByTestId('hub-token-status').innerText()).includes('已确认保存')); passed++;
  await page.getByTestId('hub-token-replace-DEEPSEEK_API_KEY').click();
  assert.equal(await page.getByTestId('hub-token-name').inputValue(), 'DEEPSEEK_API_KEY'); passed++;
  await page.evaluate(() => { window.__mode = 'denied'; });
  await page.getByTestId('hub-token-value').fill('TEST-ONLY-key'); await page.getByTestId('hub-token-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-token-status"]')?.textContent.includes('未确认成功')); passed++;
  assert.equal(await page.getByTestId('hub-token-value').inputValue(), ''); passed++;
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'serverPending', tab: 'tokens' }));
  await page.getByTestId('hub-token-row-DEEPSEEK_API_KEY').waitFor(); passed++;
  assert(!(await page.getByTestId('hub-tokens-real').innerText()).includes('TEST-ONLY-key')); passed++;
  assert.deepEqual(errors, []); passed++;
  await context.close();
  console.log(`PASS Hub tokens exported UI ${passed}/11: list, save/readback, clear, replace, permission failure, both live routes`);
} finally { await browser.close(); web.close(); }
