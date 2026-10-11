// TEST-ONLY: exported React UI against synthetic scoped Hub receipts; no real OAuth.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
try {
  const page = await browser.newPage({ locale: TEST_LOCALE, viewport: { width: 1200, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript({ content: `(${initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200')})({theme:'light'});` });
  await page.addInitScript(() => {
    const daemon = { node_id: 'daemon-a', alias: 'daemon-a', role: 'host_supervisor', lifecycle_state: 'running', config_snapshot: { role: 'host_supervisor' } };
    const snapshotId = 'dps_00000000-0000-0000-0000-000000000001';
    const loginId = 'dpl_00000000-0000-0000-0000-000000000002';
    const accountId = '00000000-0000-0000-0000-000000000003';
    const applicationId = 'dpa_00000000-0000-0000-0000-000000000004';
    let intent, accounts = [], providers = [], revision = 0;
    let application;
    window.__applyCalls = [];
    window.__bindCalls = [];
    window.__loginCalls = []; window.__loginConfirmed = false;
    const envelope = payload => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } });
    window.__routeOverride = (url, text) => {
      if (url.pathname === '/api/nodes') return { nodes: [daemon] };
      if (url.pathname === '/api/status') return { sessions: [{ ...daemon, version: '2.5.0-preview.129', status: 'idle', updated_at: new Date().toISOString() }] };
      if (url.pathname === '/api/host-supervisors') return { ok: true, daemons: [{ daemon_node_id: 'daemon-a', alias: 'daemon-a', online: true }] };
      if (url.pathname !== '/mcp') return;
      const params = JSON.parse(text || '{}').params;
      if (params?.name !== 'daemon_provider_snapshot') return;
      const a = params.arguments;
      if (a.action === 'apply') {
        window.__applyCalls.push(a); application = a;
        return envelope({ ok: true, request_id: applicationId, status: 'pending' });
      }
      if (a.action === 'read' && a.id === applicationId) return envelope({ ok: true, request_id: applicationId,
        daemon_node_id: 'daemon-a', status: 'succeeded', application: {
          status: 'applied', request_id: applicationId, node_id: application.provider.node_id,
          provider_id: application.provider.provider_id, auth_id: application.provider.auth_id, account_id: application.provider.account_id,
          model: application.provider.model, runtime_provider: 'openai', node_revision: 'b'.repeat(64),
          provider_revision: application.revision, verification: 'runtime_confirmed', applied_at: Date.now(),
        } });
      if (a.action === 'put') {
        window.__bindCalls.push(a);
        if (a.revision !== revision) return envelope({ ok: false, error: 'revision_conflict' });
        providers = [{ ...a.provider, runtimes: a.provider.runtimes.map(r => ({ ...r, auth: r.auth.map(profile => ({
          ...profile, credential_present: true, verification: 'not_checked', application: 'not_applied',
        })) })) }]; revision++;
        return envelope({ ok: true, request_id: snapshotId, status: 'pending' });
      }
      if (a.action === 'login') {
        window.__loginCalls.push(a); intent = a.provider;
        return envelope({ ok: true, request_id: loginId, status: 'pending' });
      }
      if (a.action === 'read' && a.id === loginId) {
        let login;
        if (intent.action === 'accounts') login = { accounts };
        else if (intent.action === 'cancel') login = { request_id: intent.session_id, status: 'cancelled' };
        else if (intent.action === 'save') {
          accounts = [{ version: 1, network_id: 'net-sweep', daemon_node_id: 'daemon-a', account_id: accountId, label: intent.label, created_at: Date.now(), auth_state: 'not_checked' }];
          login = { request_id: intent.session_id, status: 'authenticated', account_id: accountId };
        } else login = window.__loginConfirmed ? { request_id: intent.session_id, status: 'authenticated' }
          : { request_id: intent.session_id, status: 'awaiting_user', challenge: { loginId: accountId, verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-1234' } };
        return envelope({ ok: true, request_id: loginId, daemon_node_id: 'daemon-a', status: 'succeeded', login });
      }
      if (a.action === 'refresh') return envelope({ ok: true, request_id: snapshotId, status: 'pending' });
      return envelope({ ok: true, request_id: snapshotId, daemon_node_id: 'daemon-a', status: 'succeeded', observed_at: Date.now(), snapshot: {
        network_id: 'net-sweep', daemon_node_id: 'daemon-a', source: 'daemon', revision, providers,
        codex_inventory: { observed_at: Date.now(), scope: 'hub_bound_nodes', rows: [
          { node_id: 'node-fixture', alias: 'Fixture', status: 'observed', runtime: 'codex-app-server', config_revision: 'a'.repeat(64),
            home_ref: '1234567890abcdef', home_source: 'node-codex-home', config_status: 'read',
            configured_provider: 'openai', configured_model: 'model-fixture', node_configured_model: 'model-fixture',
            provider_ids: ['openai'], auth_kind: 'unknown', credential_status: 'unknown', account_fingerprint: null,
            verification: 'not_checked', effective_state: 'not_checked' },
        ] },
      } });
    };
  });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: 'daemon-a', daemonMgmt: true }));
  await page.getByTestId('daemon-section-tabs-provider').click();
  await page.getByTestId('daemon-login-empty').waitFor();
  await page.getByTestId('daemon-login-start').click();
  assert.equal(await page.getByTestId('daemon-login-code').innerText(), 'TEST-1234');
  if (process.env.OUT_DIR) await page.getByTestId('daemon-login-card').screenshot({ path: `${process.env.OUT_DIR}/managed-login-code.png` });
  assert.equal(await page.getByTestId('daemon-login-save').count(), 0);
  await page.evaluate(() => { window.__loginConfirmed = true; });
  await page.getByTestId('daemon-login-check').click();
  await page.getByTestId('daemon-login-label').fill('Work account');
  await page.getByTestId('daemon-login-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="daemon-login-state"]')?.textContent?.includes('尚未应用到节点'));
  await page.getByTestId('daemon-login-card').getByText('Work account', { exact: true }).waitFor();
  assert((await page.getByTestId('daemon-login-card').innerText()).includes('Work account'));
  assert.equal(await page.getByTestId('daemon-login-code').count(), 0);
  await page.getByTestId('daemon-login-models').fill('model-fixture');
  await page.getByTestId('daemon-login-bind-00000000-0000-0000-0000-000000000003').click();
  await page.getByTestId('daemon-provider-openai').waitFor();
  assert((await page.getByTestId('daemon-provider-openai').innerText()).includes('model-fixture'));
  const bindings = await page.evaluate(() => window.__bindCalls);
  assert.equal(bindings.length, 1); assert.equal(bindings[0].revision, 0);
  assert.equal(bindings[0].provider.runtimes[0].auth[0].account_id, '00000000-0000-0000-0000-000000000003');
  for (const [field, id] of Object.entries({ nodeId: 'node-fixture', providerId: 'openai',
    authId: '00000000-0000-0000-0000-000000000003', model: 'model-fixture' })) {
    const control = `daemon-provider-select-${field}`;
    await page.getByTestId(control).click();
    await page.getByTestId(`${control}-menu-search`).fill(id);
    await page.getByTestId(`${control}-menu-opt-${id}`).click();
  }
  await page.getByTestId('daemon-provider-apply').click();
  assert.equal(await page.evaluate(() => window.__applyCalls.length), 0);
  await page.getByTestId('daemon-provider-apply-confirm').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="daemon-provider-application-status"]')?.textContent?.includes('已确认所选'));
  const applied = await page.evaluate(() => window.__applyCalls);
  assert.equal(applied.length, 1); assert.equal(applied[0].revision, 1);
  assert.equal(applied[0].provider.account_id, '00000000-0000-0000-0000-000000000003');
  assert.equal(applied[0].provider.node_id, 'node-fixture');
  await page.evaluate(() => { window.__loginConfirmed = false; });
  await page.getByTestId('daemon-login-start').click();
  await page.getByTestId('daemon-login-code').waitFor();
  await page.getByTestId('daemon-login-cancel').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="daemon-login-state"]')?.textContent?.includes('已取消'));
  assert((await page.getByTestId('daemon-login-card').innerText()).includes('Work account'));
  const calls = await page.evaluate(() => window.__loginCalls);
  assert(calls.every(c => c.id === 'daemon-a' && c.network_id === 'net-sweep'));
  assert.equal(calls.filter(c => c.provider.action === 'start').length, 2);
  assert.equal(calls.filter(c => c.provider.action === 'save').length, 1);
  assert.equal(calls.filter(c => c.provider.action === 'cancel').length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS managed-login rendered core: start/code/manual-check/save/scoped-list/bind-model/confirm-apply/exact-receipt/cancel; synthetic receipts, no real OAuth or node switch');
} finally { await browser.close(); web.close(); }
