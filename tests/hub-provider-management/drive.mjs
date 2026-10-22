// Actual exported React page, synthetic native HTTP/Hub responses, Docker Chromium.
// Does not prove a real Hub, native installation, model access or inference.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let passed = 0;
const entryOnly = process.env.ENTRY_ONLY === '1';
const httpOnly = process.env.HTTP_ONLY === '1';
const cases = entryOnly
  ? [['light', { width: 390, height: 844 }], ['dark', { width: 390, height: 844 }]]
  : [['light', { width: 1200, height: 900 }], ['dark', { width: 390, height: 844 }]];
try {
  for (const [theme, viewport] of cases) {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport, colorScheme: theme }); const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const fixture = httpOnly ? initScript : initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200');
    await page.addInitScript({ content: `(${fixture})({theme:${JSON.stringify(theme)}});` });
    await page.addInitScript(value => localStorage.setItem('theme_mode_v1', value), theme);
    await page.addInitScript(() => {
      const envelope = value => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
      window.__hubProviders = []; window.__hubWrites = []; window.__hubBindings = []; window.__receiptMode = 'ok';
      let daemonRevision = 0, daemonProviders = [], counter = 0; const requests = new Map();
      const request = (daemonId, providers) => {
        const id = `dps_00000000-0000-0000-0000-${String(++counter).padStart(12, '0')}`;
        requests.set(id, { ok: true, request_id: id, daemon_node_id: daemonId, status: 'succeeded', observed_at: Date.now(),
          snapshot: { network_id: 'net-sweep', daemon_node_id: daemonId, source: 'daemon', revision: daemonRevision, providers } });
        return { ok: true, request_id: id, daemon_node_id: daemonId, status: 'pending' };
      };
      window.__routeOverride = (url, text) => {
        if (url.pathname === '/api/status' && window.innerWidth === 390) return { ok: true, sessions: Array.from({ length: 12 }, (_, i) => ({
          alias: i === 0 ? '示例-A' : `示例机器-${i}`, node_id: `n_phone_${i}`, hostname: `phone-host-${i}`,
          status: 'idle', agent: 'claude-code', updated_at: new Date().toISOString(),
          cpu_load_1min: 2, cpu_cores: 4, mem_total_gb: 16, mem_used_gb: 8, mem_avail_gb: 8,
          disk_total_gb: 100, disk_used_gb: 50, disk_avail_gb: 50,
        })) };
        if (url.pathname !== '/mcp') return;
        const { name, arguments: a } = JSON.parse(text || '{}').params || {};
        if (name === 'list_network_secrets') return envelope({ ok: true, keys: ['SHARED_API_KEY'] });
        if (name === 'daemon_provider_snapshot' && a.action.startsWith('hub_')) {
          if (a.action === 'hub_read') return envelope({ ok: true, network_id: a.network_id, source: 'hub', secret_reference_supported: true, providers: window.__hubProviders });
          if (a.action === 'hub_put') {
            window.__lastHubProviderWrite = { hub: url.origin, baseUrl: a.provider.baseUrl };
            window.__hubWrites.push({ network_id: a.network_id, revision: a.revision, id: a.provider.id, secretKeyRef: a.provider.secretKeyRef, hadKey: Object.hasOwn(a.provider, 'key') });
            const { key, secretKeyRef, ...publicConfig } = a.provider;
            const saved = { ...publicConfig, revision: a.revision + 1, updated_at: Date.now(), source: 'hub', credential_present: true,
              verification: 'not_checked', compatible_runtimes: a.provider.protocol === 'openai-responses' ? ['codex-tui'] : [], ...(secretKeyRef ? { secret_key_ref: secretKeyRef } : {}) };
            window.__hubProviders = [saved]; return envelope({ ok: true, network_id: a.network_id, provider: saved });
          }
          if (a.action === 'hub_bind') {
            window.__hubBindings.push(a); const source = window.__hubProviders.find(p => p.id === a.id);
            const targetId = 'hub_' + 'a'.repeat(24); daemonRevision++;
            daemonProviders = [{ id: targetId, label: `Hub · ${source.label}`, enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [{
              id: 'hub_key', kind: 'api_key', models: source.models, baseUrl: source.baseUrl, credential_present: true,
              verification: 'not_checked', application: 'not_applied' }] }] }];
            const pending = request(a.provider.daemon_node_id, daemonProviders);
            return envelope({ ...pending, provider_reference: { network_id: a.network_id, id: a.id, revision: a.revision, daemon_provider_id: targetId } });
          }
        }
        if (name === 'daemon_provider_snapshot') {
          if (a.action === 'refresh') return envelope(request(a.id, daemonProviders));
          if (a.action === 'read') {
            const result = requests.get(a.id);
            if (window.__receiptMode === 'wrong' && result?.snapshot.providers.length) return envelope({ ...result, daemon_node_id: 'foreign-daemon' });
            return envelope(result);
          }
        }
      };
    });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.getByText('示例-A', { exact: true }).first().waitFor();
    if (viewport.width === 390) {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
      const entry = page.getByTestId('server-action-providers');
      await entry.waitFor();
      const box = await entry.boundingBox();
      assert(box && box.y >= 0 && box.y + box.height <= viewport.height,
        `Provider entry must be in the first viewport, without scrolling: ${JSON.stringify(box)}`); passed++;
      assert.equal(await page.getByTestId('server-one-column').count(), 1); passed++;
      mkdirSync('/tmp/hub-provider-screenshots', { recursive: true });
      await page.screenshot({ path: `/tmp/hub-provider-screenshots/phone-entry-${theme}.png` });
      // Real viewport tap: locator.click() would auto-scroll and hide this regression.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByTestId('hub-providers-real').waitFor(); passed++;
      assert.equal(await page.evaluate(() => window.__hubWrites.length), 0); passed++;
      assert.equal(await page.evaluate(() => window.__hubBindings.length), 0); passed++;
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await page.getByTestId('server-header').waitFor(); passed++;
      assert.deepEqual(await page.evaluate(() => [window.__hubWrites.length, window.__hubBindings.length]), [0, 0]); passed++;
      if (entryOnly) { assert.deepEqual(errors, []); passed++; await ctx.close(); continue; }
    }
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'serverPending', tab: 'provider' }));
    await page.getByTestId('hub-providers-real').waitFor({ timeout: 8000 }).catch(async error => {
      console.log('Synthetic page diagnostic', JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 1200) }));
      throw error;
    });
    assert.equal(await page.getByTestId('hub-providers-real').evaluate(el => getComputedStyle(el).backgroundColor),
      theme === 'dark' ? 'rgb(17, 17, 19)' : 'rgb(246, 247, 249)'); passed++;
    const baseUrl = httpOnly ? 'http://api.example.test/v1' : 'https://api.example.test/v1';
    if (httpOnly) {
      await page.getByTestId('hub-provider-http-advisory').waitFor();
      assert((await page.getByTestId('hub-provider-http-advisory').innerText()).includes('仍可继续保存和下发')); passed++;
      assert.equal(await page.evaluate(() => window.__hubWrites.length), 0); passed++;
    }
    for (const [field, value] of Object.entries({ id: 'shared', label: 'Shared fixture', baseUrl, models: 'model-a, model-b', key: 'TEST-ONLY-hub-key' })) await page.getByTestId(`hub-provider-field-${field}`).fill(value);
    if (httpOnly) { await page.getByTestId('hub-provider-endpoint-advisory').waitFor(); passed++; }
    await page.getByTestId('hub-provider-save').click();
    await page.getByTestId('hub-provider-row-shared').waitFor();
    assert.equal(await page.getByTestId('hub-provider-field-key').inputValue(), ''); passed++;
    assert.equal(await page.evaluate(() => window.__hubWrites.length), 1); passed++;
    assert.equal(await page.evaluate(() => window.__hubBindings.length), 0); passed++;
    await page.getByTestId('hub-provider-choose-shared').click();
    await page.getByTestId('hub-provider-target-d_sweep_1').click();
    await page.getByTestId('hub-provider-review-distribution').click();
    assert.equal(await page.evaluate(() => window.__hubBindings.length), 0); passed++;
    const review = page.getByTestId('hub-provider-distribution-review');
    const reviewText = await review.innerText();
    assert(reviewText.includes('Shared fixture · shared')); passed++;
    assert(reviewText.includes('配置版本 1') && reviewText.includes('openai-responses')); passed++;
    assert(reviewText.includes('model-a, model-b')); passed++;
    assert(reviewText.includes('目标 Daemon（1 台）') && reviewText.includes('d_sweep_1')); passed++;
    await page.getByTestId('hub-provider-cancel-distribution').click();
    assert.equal(await review.count(), 0); passed++;
    assert.equal(await page.evaluate(() => window.__hubBindings.length), 0); passed++;
    await page.getByTestId('hub-provider-review-distribution').click();
    await page.getByTestId('hub-provider-target-d_sweep_1').click();
    assert.equal(await review.count(), 0); passed++;
    await page.getByTestId('hub-provider-target-d_sweep_1').click();
    await page.getByTestId('hub-provider-review-distribution').click();
    await page.getByTestId('hub-provider-confirm-distribution').click();
    const receipt = page.getByTestId('hub-provider-receipt-d_sweep_1'); await receipt.waitFor();
    assert((await receipt.innerText()).includes('未应用到节点')); passed++;
    assert.equal(await page.evaluate(() => window.__hubBindings.length), 1); passed++;
    assert(!(await page.getByTestId('hub-providers-real').innerText()).includes('TEST-ONLY-hub-key')); passed++;
    if (httpOnly) {
      assert.deepEqual(await page.evaluate(() => window.__lastHubProviderWrite), { hub: 'http://mock-hub.invalid', baseUrl }); passed++;
      assert.deepEqual(errors, []); passed++;
      mkdirSync('/tmp/hub-provider-screenshots', { recursive: true });
      await page.screenshot({ path: `/tmp/hub-provider-screenshots/http-${theme}.png`, fullPage: true });
      await ctx.close(); continue;
    }
    if (theme === 'light') {
      await page.evaluate(() => { window.__receiptMode = 'wrong'; });
      await page.getByTestId('hub-provider-review-distribution').click(); await page.getByTestId('hub-provider-confirm-distribution').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="hub-provider-receipt-d_sweep_1"]')?.textContent.includes('未确认'));
      assert((await receipt.innerText()).includes('未确认')); passed++;
    }
    assert.deepEqual(errors, []); passed++;
    await page.getByTestId('hub-provider-credential-reference').click();
    await page.getByTestId('hub-provider-secret-SHARED_API_KEY').click();
    assert.equal(await page.getByTestId('hub-provider-field-key').count(), 0); passed++;
    await page.getByTestId('hub-provider-save').click();
    await page.waitForFunction(() => window.__hubWrites.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__hubWrites[1]), { network_id: 'net-sweep', revision: 1, id: 'shared', secretKeyRef: 'SHARED_API_KEY', hadKey: false }); passed++;
    await page.getByTestId('hub-provider-choose-shared').click();
    await page.getByTestId('hub-provider-target-d_sweep_1').click();
    await page.getByTestId('hub-provider-review-distribution').click();
    const bindingCount = await page.evaluate(() => window.__hubBindings.length);
    await page.evaluate(() => { window.__receiptMode = 'ok'; });
    await page.getByTestId('hub-provider-confirm-distribution').click();
    await page.waitForFunction(n => window.__hubBindings.length === n + 1, bindingCount);
    await page.waitForFunction(() => document.querySelector('[data-testid="hub-provider-receipt-d_sweep_1"]')?.textContent.includes('未应用到节点')); passed++;
    mkdirSync('/tmp/hub-provider-screenshots', { recursive: true });
    await page.screenshot({ path: `/tmp/hub-provider-screenshots/${theme}.png`, fullPage: true });
    await ctx.close();
  }
  console.log(httpOnly ? `PASS HTTP Provider core: ${passed} assertions, HTTP advisory/save/confirm/bind/readback, synthetic transport`
    : entryOnly
    ? `PASS phone Provider entry: ${passed}/16 assertions, light + dark, visible/tap/back/zero writes`
    : `PASS Hub Provider real page: ${passed}/46 assertions, desktop/light + phone/dark (entry + palette asserted)`);
} finally { await browser.close(); web.close(); }
