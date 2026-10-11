// Real exported React UI, synthetic HTTP fixture, Chromium in Docker.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let passed = 0;
try {
  for (const viewport of [{ width: 1200, height: 850 }]) {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript({ content: `(${initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200')})({theme:'light'});` });
    await page.addInitScript(() => {
      window.__providerMode = 'ready'; window.__providerCalls = []; window.__savedProvider = null;
      const daemon = { node_id: 'daemon-a', alias: 'daemon-a', role: 'host_supervisor', lifecycle_state: 'running', config_snapshot: { role: 'host_supervisor' } };
      const requestId = 'dps_00000000-0000-0000-0000-000000000001';
      const envelope = payload => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } });
      window.__routeOverride = (url, text) => {
        if (url.pathname === '/api/nodes') return { nodes: [daemon] };
        if (url.pathname === '/api/status') return { sessions: [{ ...daemon, status: 'idle', updated_at: new Date().toISOString() }] };
        if (url.pathname === '/api/host-supervisors') return { ok: true, daemons: [{ daemon_node_id: daemon.node_id, alias: daemon.alias, online: true, runtimes_supported: ['codex-app-server'] }] };
        if (url.pathname !== '/mcp') return;
        const params = JSON.parse(text || '{}').params;
        if (params?.name !== 'daemon_provider_snapshot') return;
        window.__providerCalls.push(params);
        if (params.arguments.action === 'put') {
          window.__savedProvider = params.arguments.provider;
          return envelope({ ok: true, request_id: requestId, status: 'pending' });
        }
        if (window.__providerMode === 'forbidden') return envelope({ ok: false, error: 'provider_admin_required' });
        if (window.__providerMode === 'unsupported') return { jsonrpc: '2.0', id: 1, error: { message: 'Unknown tool daemon_provider_snapshot' } };
        if (params.arguments.action === 'refresh') return envelope({ ok: true, request_id: requestId, status: 'pending' });
        const value = { network_id: 'net-sweep', daemon_node_id: window.__providerMode === 'foreign' ? 'daemon-b' : 'daemon-a', source: 'daemon', revision: 3, providers: [
          { id: 'deepseek', label: 'DeepSeek', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [
            { id: 'work', kind: 'api_key', models: ['deepseek-chat'], baseUrl: 'https://api.example.test/v1', credential_present: true, verification: 'not_checked', application: 'not_applied' },
          ] }] },
          { id: 'openai', label: 'OpenAI', enabled: false, runtimes: [{ runtime: 'codex-tui', auth: [
            { id: 'personal', kind: 'chatgpt', models: ['model-fixture'], credential_present: false, verification: 'not_checked', application: 'not_applied' },
          ] }] },
        ], codex_inventory: { observed_at: Date.now(), scope: 'hub_bound_nodes', installation: { status: 'found', version: '0.133.0' }, rows: [{
          node_id: 'n_existing', alias: 'existing-codex', status: 'observed', runtime: 'codex-app-server', home_ref: '1234567890abcdef', home_source: 'node-codex-home',
          config_status: 'read', configured_provider: 'configured-custom', configured_model: 'existing-model', node_configured_model: 'node-model', provider_ids: ['configured-custom'],
          auth_kind: 'api_key', credential_status: 'unknown', account_fingerprint: null, verification: 'not_checked', effective_state: 'not_checked',
        }] } };
        if (window.__providerMode === 'empty') value.providers = [];
        if (window.__savedProvider && window.__providerMode === 'ready') {
          const p = window.__savedProvider;
          value.revision = 4;
          value.providers.push({ ...p, runtimes: p.runtimes.map(r => ({ ...r, auth: r.auth.map(({ key, ...a }) => ({ ...a,
            credential_present: true, verification: 'not_checked', application: 'not_applied',
          })) })) });
        }
        return envelope({ ok: true, request_id: requestId, daemon_node_id: 'daemon-a', status: 'succeeded', observed_at: Date.now(), snapshot: value });
      };
    });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: 'daemon-a', daemonMgmt: true }));
    await page.getByTestId('daemon-section-tabs-provider').click();
    const panel = page.getByTestId('daemon-providers-real');
    await page.getByTestId('daemon-provider-deepseek').waitFor();
    assert((await panel.innerText()).includes('deepseek-chat')); passed++;
    assert((await panel.innerText()).includes('未验证')); passed++;
    assert((await panel.innerText()).includes('尚未应用')); passed++;
    const inventory = await page.getByTestId('daemon-codex-inventory').innerText();
    assert(inventory.includes('existing-codex') && inventory.includes('existing-model') && inventory.includes('0.133.0')); passed++;
    assert(inventory.includes('凭据状态未知') && inventory.includes('不重启')); passed++;
    assert((await page.getByTestId('daemon-providers-counts').innerText()).includes('2')); passed++;
    const calls = await page.evaluate(() => window.__providerCalls);
    assert.equal(calls[0].arguments.id, 'daemon-a'); assert.equal(calls[0].arguments.network_id, 'net-sweep'); passed++;
    for (const [field, value] of Object.entries({ id: 'custom', label: 'My provider', authId: 'work', baseUrl: 'https://api.example.test/v1', models: 'model-save', key: 'TEST-ONLY-UI-KEY' })) {
      await page.getByTestId(`daemon-provider-input-${field}`).fill(value);
    }
    await page.getByTestId('daemon-provider-save').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="daemon-provider-save-status"]')?.textContent?.includes('已确认保存'));
    assert((await page.getByTestId('daemon-provider-custom').innerText()).includes('model-save'));
    assert.equal(await page.getByTestId('daemon-provider-input-key').inputValue(), '');
    assert(!(await panel.innerText()).includes('TEST-ONLY-UI-KEY')); passed++;
    await page.getByTestId('daemon-providers-refresh').click();
    await page.getByTestId('daemon-provider-custom').waitFor();
    assert.equal(await page.getByTestId('daemon-provider-save-status').count(), 0); passed++;
    assert.deepEqual(errors, []); passed++;
    await ctx.close();
  }
  console.log(`PASS daemon Provider management UI ${passed}/10 (one inventory, save and refreshed receipt flow; synthetic Hub)`);
} finally { await browser.close(); web.close(); }
