// Real exported UI and Tauri IPC fixture in Docker; not a signed macOS/Windows acceptance.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.OUT || '/out';
mkdirSync(output, { recursive: true });
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let passed = 0;
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1120, height: 800 }, locale: TEST_LOCALE });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript({ content: `(${initScript.toString().replace('http://mock-hub.invalid', 'http://127.0.0.1:9200')})({theme:'${theme}'});` });
    await page.addInitScript(mode => localStorage.setItem('theme_mode_v1', mode), theme);
    await page.addInitScript(() => {
      window.__calls = []; window.__profileReads = [];
      const original = window.__TAURI_INTERNALS__.invoke;
      const label = new URLSearchParams(location.search).has('daemonSettings') ? 'daemon-settings-fixture' : 'main';
      window.__TAURI_INTERNALS__.metadata = { currentWindow: { label }, currentWebview: { label, windowLabel: label } };
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if (cmd === 'load_desktop_profile') {
          window.__profileReads.push(args.profileId);
          if (args.profileId !== 'p-daemon') throw new Error('missing account');
          return JSON.stringify({ profileId: 'p-daemon', serverUrl: 'http://127.0.0.1:9200', token: 'synthetic-placeholder', networkId: 'stored-other-network', username: 'tester' });
        }
        return original(cmd, args);
      };
      const daemon = { node_id: 'd-scoped', alias: 'daemon-scoped', hostname: 'fixture-host', role: 'host_supervisor', lifecycle_state: 'running', config_snapshot: { role: 'host_supervisor' } };
      window.__routeOverride = (url, body) => {
        window.__calls.push({ path: url.pathname, network: url.searchParams.get('network_id'), alias: url.searchParams.get('alias'), body });
        if (url.pathname === '/api/nodes') return { nodes: [daemon] };
        if (url.pathname === '/api/status') return { sessions: [{ ...daemon, status: 'idle', version: '2.5.0-preview.130', updated_at: new Date().toISOString() }] };
        if (url.pathname === '/api/host-supervisors') return { ok: true, daemons: [{ daemon_node_id: daemon.node_id, alias: daemon.alias, hostname: daemon.hostname, online: true, runtimes_supported: ['codex-app-server'] }] };
        if (url.pathname === '/mcp') {
          const params = JSON.parse(body || '{}').params;
          if (params?.name !== 'daemon_provider_snapshot') return;
          const payload = params.arguments.action === 'refresh'
            ? { ok: true, request_id: 'dps_00000000-0000-0000-0000-000000000959', status: 'pending' }
            : { ok: true, request_id: 'dps_00000000-0000-0000-0000-000000000959', daemon_node_id: daemon.node_id, status: 'succeeded', observed_at: Date.now(), snapshot: {
              daemon_node_id: daemon.node_id, network_id: 'net-target', source: 'daemon', revision: 0, providers: [],
            } };
          return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
        }
      };
    });
    await page.goto(`${web.url}?daemonSettings=daemon-scoped&profile=p-daemon&network=net-target`);
    await page.getByTestId('daemon-settings-window').waitFor();
    const background = await page.getByTestId('daemon-settings-window').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(background, theme === 'dark' ? 'rgb(17, 17, 19)' : 'rgb(246, 247, 249)'); passed++;
    await page.getByText('fixture-host', { exact: false }).first().waitFor(); passed++;
    assert.equal(await page.getByTestId('daemon-mgmt-popout').count(), 0); passed++;
    await page.getByTestId('daemon-section-tabs-provider').click();
    await page.getByTestId('daemon-providers-real').waitFor();
    await page.waitForFunction(() => window.__calls.filter(c => c.path === '/mcp').some(c => JSON.parse(c.body || '{}').params?.arguments?.action === 'read'));
    const state = await page.evaluate(() => ({ calls: window.__calls, profiles: window.__profileReads }));
    assert.deepEqual(state.profiles, ['p-daemon']); passed++;
    assert(state.calls.filter(c => ['/api/nodes', '/api/status', '/api/host-supervisors'].includes(c.path)).every(c => c.network === 'net-target')); passed++;
    const provider = state.calls.filter(c => c.path === '/mcp').map(c => JSON.parse(c.body || '{}').params).filter(p => p?.name === 'daemon_provider_snapshot');
    assert(provider.length > 0 && provider.every(p => p.arguments.network_id === 'net-target')); passed++;
    assert(provider.filter(p => p.arguments.action === 'refresh').every(p => p.arguments.id === 'd-scoped')); passed++;
    await page.screenshot({ path: `${output}/daemon-settings-${theme}.png` });
    await page.getByTestId('daemon-mgmt-node-settings').click();
    await page.getByTestId('node-section-nav').waitFor();
    await page.waitForFunction(() => window.__calls.some(c => c.path === '/api/status' && c.alias === 'daemon-scoped' && c.network === 'net-target')); passed++;
    assert.equal(errors.length, 0, errors.join('\n')); passed++;
    await page.goto(`${web.url}?daemonSettings=daemon-scoped&profile=missing-profile&network=net-target`);
    await page.getByTestId('daemon-window-error').waitFor();
    assert.equal(await page.getByTestId('daemon-providers-real').count(), 0); passed++;
    assert.deepEqual(await page.evaluate(() => window.__profileReads), ['missing-profile']); passed++;
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: 'daemon-scoped', daemonMgmt: true }));
    await page.getByTestId('daemon-mgmt-popout').click();
    await page.waitForFunction(() => window.__openedWindows?.some(w => w.label.startsWith('daemon-settings-')));
    const opened = await page.evaluate(() => window.__openedWindows.find(w => w.label.startsWith('daemon-settings-')));
    const route = new URL(opened.url, web.url);
    assert.equal(route.searchParams.get('daemonSettings'), 'daemon-scoped');
    assert.equal(route.searchParams.get('profile'), 'p-sweep');
    assert.equal(route.searchParams.get('network'), 'net-sweep'); passed++;
    await context.close();
  }
  console.log(`daemon settings window browser: ${passed}/${passed} PASS (IPC fixture, no native package claim)`);
} finally { await browser.close(); await web.close(); }
