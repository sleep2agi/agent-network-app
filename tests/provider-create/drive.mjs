// Actual exported wizard, synthetic Hub only. Does not launch a real node.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const daemon = { daemon_node_id: 'd_fixture', alias: 'daemon-fixture', online: true,
  runtimes_supported: ['codex-app-server'], can_create_nodes: true };
let passed = 0;
try {
  for (const [theme, viewport] of [['light', { width: 1200, height: 900 }], ['dark', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport, colorScheme: theme });
    const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript({ content: `(${initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200')})({theme:${JSON.stringify(theme)}});` });
    await page.addInitScript(value => localStorage.setItem('theme_mode_v1', value), theme);
    await page.addInitScript(() => {
      window.__createCalls = [];
      const envelope = value => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
      window.__routeOverride = (u, body) => {
        if (u.pathname === '/api/node-create-requests') return { ok: true, request: { request_id: 'cr_fixture', status: window.__oldDaemon ? 'failed' : 'pending',
          ...(window.__oldDaemon ? { error: 'validate: flag_key_unknown:daemonProvider' } : {}) } };
        if (u.pathname !== '/mcp') return;
        const p = JSON.parse(body || '{}').params;
        if (p?.name === 'create_node') { window.__createCalls.push(p.arguments); return envelope({ ok: true, request_id: 'cr_fixture' }); }
        if (p?.name !== 'daemon_provider_snapshot') return;
        const id = 'dps_00000000-0000-0000-0000-000000000001';
        if (p.arguments.action === 'refresh') return envelope({ ok: true, request_id: id, status: 'pending' });
        return envelope({ ok: true, request_id: id, daemon_node_id: 'd_fixture', status: 'succeeded', observed_at: Date.now(), snapshot: {
          network_id: 'net-sweep', daemon_node_id: 'd_fixture', source: 'daemon', revision: 7, providers: [{
            id: 'custom', label: 'Configured Provider', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [{
              id: 'work', kind: 'api_key', models: ['configured-model'], baseUrl: 'https://api.example.test/v1',
              credential_present: true, verification: 'not_checked', application: 'not_applied',
            }] }],
          }],
        } });
      };
    });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.getByText('示例-A', { exact: true }).first().waitFor();
    await page.evaluate(d => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), daemon);
    await page.getByTestId('create-name-input').fill('provider-fixture');
    await page.getByTestId('create-node-next').click();
    await page.getByTestId('create-daemon-provider-mode-true').click();
    assert.equal(await page.getByTestId('create-node-next').isDisabled(), true); passed++;
    for (const [field, id] of Object.entries({ providerId: 'custom', authId: 'work', model: 'configured-model' })) {
      const control = `create-daemon-provider-${field}`;
      await page.getByTestId(control).click();
      await page.getByTestId(`${control}-menu-opt-${id}`).click();
    }
    assert.equal(await page.getByTestId('create-node-next').isDisabled(), false); passed++;
    await page.getByTestId('create-node-next').click();
    await page.getByTestId('create-node-submit').waitFor();
    assert((await page.getByTestId('create-step-body').innerText()).includes('configured-model')); passed++;
    assert.equal(await page.getByTestId('create-name-summary').innerText(), 'provider-fixture'); passed++;
    await page.getByTestId('create-name-edit').click();
    assert.equal(await page.getByTestId('create-name-input').inputValue(), 'provider-fixture');
    const editedName = `创建演示-${theme}`;
    await page.getByTestId('create-name-input').fill(editedName);
    await page.getByTestId('create-node-next').click();
    await page.getByTestId('create-node-next').click();
    await page.getByTestId('create-node-submit').waitFor();
    assert.equal(await page.getByTestId('create-name-summary').innerText(), editedName); passed++;
    await page.getByTestId('create-node-submit').click();
    await page.waitForFunction(() => window.__createCalls.length === 1);
    const args = await page.evaluate(() => window.__createCalls[0]);
    assert.equal(args.daemon_node_id, 'd_fixture');
    assert.equal(args.node_spec.name, editedName);
    assert.equal(args.node_spec.model, 'configured-model');
    assert.deepEqual(args.node_spec.flags.daemonProvider, { revision: 7, provider_id: 'custom', auth_id: 'work', model: 'configured-model' });
    assert(!JSON.stringify(args).includes('baseUrl')); passed++;
    assert.equal(await page.getByText(`✓ ${editedName} 已上线`, { exact: true }).count(), 0); passed++;
    await page.evaluate(() => { window.__oldDaemon = true; });
    await page.getByText(/请先升级 Hub 至 0\.9\.0-preview\.124/).waitFor();
    const errorText = await page.getByText(/请先升级 Hub 至 0\.9\.0-preview\.124/).innerText();
    assert(errorText.includes('2.3.0-preview.166') && errorText.includes('2.5.0-preview.132')); passed++;
    assert.equal(await page.evaluate(() => window.__createCalls.length), 1); passed++;
    assert.deepEqual(errors, []); passed++;
    await ctx.close();
  }
  assert.equal(passed, 20);
  console.log('PASS Provider creation wizard20/20, exact old-Daemon upgrade targets without retry; desktop/light + phone/dark; pending is not running');
} finally { await browser.close(); web.close(); }
