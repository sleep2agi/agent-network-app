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
      window.__providerMode = 'ready'; window.__providerCalls = []; window.__savedProviders = {}; window.__providerRevision = 3;
      window.__providerApplyEnabled = false; window.__applicationIntent = null;
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
        const applicationId = 'dpa_00000000-0000-0000-0000-000000000002';
        if (params.arguments.action === 'apply') {
          window.__applicationIntent = params.arguments;
          return envelope({ ok: true, request_id: applicationId, status: 'pending' });
        }
        if (params.arguments.action === 'read' && params.arguments.id === applicationId) {
          const intent = window.__applicationIntent;
          return envelope({ ok: true, request_id: applicationId, daemon_node_id: 'daemon-a', status: 'succeeded', application: {
            status: 'applied', request_id: applicationId, node_id: intent.provider.node_id, provider_id: intent.provider.provider_id,
            auth_id: intent.provider.auth_id, model: intent.provider.model, runtime_provider: 'anet_' + 'b'.repeat(20),
            node_revision: 'c'.repeat(64), provider_revision: intent.revision, verification: 'runtime_confirmed', applied_at: Date.now(),
          } });
        }
        if (params.arguments.action === 'put') {
          if (params.arguments.revision !== window.__providerRevision) return envelope({ ok: false, error: 'revision_conflict' });
          window.__savedProviders[params.arguments.provider.id] = params.arguments.provider;
          window.__providerRevision++;
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
          ...(window.__providerApplyEnabled ? { config_revision: 'a'.repeat(64) } : {}),
        }] } };
        if (window.__providerMode === 'empty') value.providers = [];
        if (window.__providerMode === 'ready') {
          value.revision = window.__providerRevision;
          for (const p of Object.values(window.__savedProviders)) {
            value.providers = value.providers.filter(old => old.id !== p.id);
            value.providers.push({ ...p, runtimes: p.runtimes.map(r => ({ ...r, auth: r.auth.map(({ key, ...a }) => ({ ...a,
              credential_present: a.kind === 'api_key', verification: 'not_checked', application: 'not_applied',
            })) })) });
          }
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
    for (const [field, id] of Object.entries({ nodeId: 'n_existing', providerId: 'deepseek', authId: 'work', model: 'deepseek-chat' })) {
      const control = `daemon-provider-select-${field}`;
      await page.getByTestId(control).click();
      await page.getByTestId(`${control}-menu-search`).fill(id);
      await page.getByTestId(`${control}-menu-opt-${id}`).click();
    }
    const selection = await page.getByTestId('daemon-provider-selection-summary').innerText();
    assert(selection.includes('n_existing') && selection.includes('deepseek-chat') && selection.includes('work'));
    assert.equal(await page.getByTestId('daemon-provider-apply').isDisabled(), true); passed++;
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
    assert.equal(await page.getByTestId('daemon-provider-selection-summary').count(), 0); passed++;
    const writesBefore = await page.evaluate(() => window.__providerCalls.filter(c => c.arguments.action === 'put').length);
    await page.getByTestId('daemon-provider-toggle-custom').click();
    assert((await page.getByTestId('daemon-provider-toggle-confirm-custom').innerText()).includes('不会停止'));
    assert.equal(await page.evaluate(() => window.__providerCalls.filter(c => c.arguments.action === 'put').length), writesBefore); passed++;
    await page.getByTestId('daemon-provider-toggle-submit-custom').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="daemon-provider-custom"]')?.textContent?.includes('已停用配置'));
    const toggleWrite = await page.evaluate(() => window.__providerCalls.filter(c => c.arguments.action === 'put').at(-1).arguments);
    assert.equal(toggleWrite.revision, 4); assert.equal(toggleWrite.provider.enabled, false);
    assert.equal(toggleWrite.provider.runtimes[0].auth[0].key, undefined);
    assert((await page.getByTestId('daemon-provider-custom').innerText()).includes('model-save')); passed++;
    await page.getByTestId('daemon-provider-toggle-custom').click();
    await page.getByTestId('daemon-provider-toggle-submit-custom').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="daemon-provider-custom"]')?.textContent?.includes('已启用配置'));
    assert.equal(await page.evaluate(() => window.__providerCalls.filter(c => c.arguments.action === 'put').at(-1).arguments.revision), 5); passed++;
    await page.evaluate(() => { window.__providerApplyEnabled = true; });
    await page.getByTestId('daemon-providers-refresh').click();
    await page.getByTestId('daemon-provider-custom').waitFor();
    assert.equal(await page.getByTestId('daemon-provider-save-status').count(), 0); passed++;
    for (const [field, id] of Object.entries({ nodeId: 'n_existing', providerId: 'deepseek', authId: 'work', model: 'deepseek-chat' })) {
      const control = `daemon-provider-select-${field}`;
      await page.getByTestId(control).click();
      await page.getByTestId(`${control}-menu-search`).fill(id);
      await page.getByTestId(`${control}-menu-opt-${id}`).click();
    }
    await page.getByTestId('daemon-provider-apply').click();
    assert.equal(await page.evaluate(() => window.__providerCalls.filter(c => c.arguments.action === 'apply').length), 0); passed++;
    await page.getByTestId('daemon-provider-apply-confirm').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="daemon-provider-application-status"]')?.textContent?.includes('已确认所选'));
    const applied = await page.evaluate(() => window.__providerCalls.filter(c => c.arguments.action === 'apply'));
    assert.equal(applied.length, 1); assert.equal(applied[0].arguments.revision, 6);
    assert.deepEqual(applied[0].arguments.provider, { node_id: 'n_existing', node_revision: 'a'.repeat(64), provider_id: 'deepseek', auth_id: 'work', model: 'deepseek-chat', confirm_restart: true }); passed++;
    assert.equal(await page.getByTestId('daemon-provider-apply').isDisabled(), true); passed++;
    assert.deepEqual(errors, []); passed++;
    await ctx.close();
  }
  console.log(`PASS daemon Provider management UI ${passed}/18 (one inventory, save, enable/disable and confirmed application receipt flow; synthetic Hub, no real runtime)`);
} finally { await browser.close(); web.close(); }
