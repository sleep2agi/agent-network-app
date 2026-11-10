// Mounted production ChatScreen + NodeModelSection, using the existing synthetic
// layout-sweep IPC fixture. No real Hub, daemon, account, or native acceptance.
import assert from 'node:assert/strict';
import { serveExport, initScript } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let checks = 0;
const ck = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(() => {
    const node = (alias) => ({ alias, node_id: `n_${alias}`, network_id: 'net-sweep', runtime: 'opencode-cli',
      opencode_generation: 'v2', lifecycle_daemon_node_id: 'n_fixture_daemon', status: 'idle',
      version: '2.5.0-preview.174', config_revision: 1, config_update_capable: true,
      opencode_variant_config_capable: true, model: 'stub/selected-not-effective', model_effective: 'stub/effective', modelVariant: null });
    window.__variantNodes = { A: node('A'), B: node('B') };
    window.__variantMode = 'applied';
    window.__variantWrites = [];
    const mcp = value => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
    window.__routeOverride = (url, body) => {
      if (url.pathname === '/api/status') return { ok: true, sessions: Object.values(window.__variantNodes).map(n => ({ ...n, model: 'stub/status-old' })) };
      if (url.pathname === '/api/nodes') return { ok: true, nodes: Object.values(window.__variantNodes) };
      const match = /^\/api\/nodes\/n_([AB])\/config$/.exec(url.pathname);
      if (match) return window.__variantNodes[match[1]];
      if (url.pathname !== '/mcp') return undefined;
      const { name, arguments: args } = JSON.parse(body).params;
      if (name === 'read_opencode_catalog') return mcp({ ok: true, request_id: 'fixture_catalog' });
      if (name === 'get_opencode_catalog') return mcp({ ok: true, status: 'ready', snapshot: { models: [
        { providerId: 'stub', id: 'effective', variants: ['high', 'low'] },
      ] } });
      if (name === 'update_node_config') {
        window.__variantWrites.push(args);
        const n = Object.values(window.__variantNodes).find(n => n.node_id === args.node_id);
        const update_id = `u_${window.__variantWrites.length}`;
        if (window.__variantMode === 'failure') return mcp({ ok: false, error: 'synthetic refusal' });
        n.modelVariant = args.patch.modelVariant;
        n.last_update = { update_id, status: 'applied', terminal: true, requested_model: args.patch.model };
        if (window.__variantMode === 'wrong-id') n.last_update.update_id = 'unrelated';
        if (window.__variantMode === 'nonterminal') n.last_update.terminal = false;
        return mcp({ ok: true, update_id, apply_mode: 'hot' });
      }
      return undefined;
    };
    // Hold a fully captured config response, then release after changing chat.
    const ipc = window.__TAURI_INTERNALS__.invoke;
    const urls = new Map();
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      const out = await ipc(cmd, args);
      if (cmd === 'plugin:http|fetch') urls.set(out, args.clientConfig.url);
      if (cmd === 'plugin:http|fetch_send' && window.__holdConfig && /\/config(?:\?|$)/.test(urls.get(args.rid) || '')) {
        window.__holdConfig = false;
        await new Promise(resolve => { window.__releaseConfig = resolve; });
      }
      return out;
    };
  });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  const chat = alias => page.evaluate(alias => window.__anetLayoutSweep.setScreen({ name: 'chat', alias }), alias);
  const footer = page.getByTestId('composer-model-entry');
  // Footer now has two controls (model + variant), so read both: the old single
  // composer-model entry only carries the model name.
  const text = () => page.evaluate(() => ['composer-model', 'composer-variant']
    .map(id => document.querySelector(`[data-testid="${id}"]`)?.textContent || '')
    .join(' '));
  const waitFooter = value => page.waitForFunction(v => ['composer-model', 'composer-variant']
    .map(id => document.querySelector(`[data-testid="${id}"]`)?.textContent || '')
    .join(' ').includes(v), value);
  const open = () => footer.click();
  await chat('A');
  await footer.waitFor();
  ck('initial footer does not guess default', !(await text()).includes('默认'));
  await open();
  await page.getByTestId('node-variant-chip-high').waitFor();
  await waitFooter('默认');
  ck('initial config uses effective model, never selected/status mixture', (await text()).includes('stub/effective') && !(await text()).includes('selected') && !(await text()).includes('status-old'));
  await page.getByTestId('node-variant-chip-high').evaluate(el => { el.click(); el.click(); });
  await waitFooter('high');
  ck('same-model change reaches footer after ack readback', (await text()).includes('high'));
  ck('same-turn double press is singleflight', await page.evaluate(() => window.__variantWrites.length === 1));
  ck('write uses effective model', await page.evaluate(() => window.__variantWrites[0].patch.model === 'stub/effective'));
  await page.getByTestId('node-variant-clear').click();
  await waitFooter('默认');
  ck('explicit clear reaches footer after matching ack', (await text()).includes('默认'));
  await open();
  await page.getByTestId('composer-model-sheet').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    window.__realNow = Date.now;
    Date.now = () => window.__realNow() + 36_000;
  });
  // Re-render from the draft, not by reopening the panel: a legitimate new
  // config response would otherwise refresh its TTL during this assertion.
  await page.locator('[data-testid="desktop-composer-card"] textarea').fill('synthetic expiry probe');
  await page.waitForFunction(() => {
    const text = ['composer-model', 'composer-variant']
      .map(id => document.querySelector(`[data-testid="${id}"]`)?.textContent || '').join(' ');
    return !text.includes('默认') && !text.includes('high');
  });
  ck('expired snapshot is unknown even with suspended expiry timers', !(await text()).includes('默认') && !(await text()).includes('high'));
  await page.evaluate(() => { Date.now = window.__realNow; });
  await page.locator('[data-testid="desktop-composer-card"] textarea').fill('');
  await open();
  await page.getByTestId('node-variant-chip-high').waitFor();
  await waitFooter('默认');
  await page.evaluate(() => { window.__variantMode = 'failure'; });
  await page.getByTestId('node-variant-chip-high').click();
  await page.getByText('失败:synthetic refusal', { exact: true }).waitFor();
  ck('failed write does not claim requested high', !(await text()).includes('high'));
  await page.evaluate(() => { window.__variantMode = 'wrong-id'; });
  await page.getByTestId('node-variant-chip-high').click();
  await page.getByText('失败:已接受，但当前档位未确认', { exact: true }).waitFor();
  ck('wrong update_id readback does not publish high', !(await text()).includes('high'));
  await page.evaluate(() => { window.__variantMode = 'nonterminal'; });
  await page.getByTestId('node-variant-chip-low').click();
  await page.waitForFunction(() => window.__variantWrites.length === 5);
  await page.getByText('失败:已接受，但当前档位未确认', { exact: true }).waitFor();
  ck('nonterminal readback does not publish low', !(await text()).includes('low'));
  // Close/reopen to fetch a held old-A response, then switch to B before release.
  await open();
  await page.getByTestId('composer-model-sheet').waitFor({ state: 'detached' });
  await page.evaluate(() => { window.__holdConfig = true; });
  await open();
  await page.waitForFunction(() => !!window.__releaseConfig);
  await chat('B');
  await page.waitForFunction(() => document.querySelector('[data-testid="desktop-composer-card"] textarea')?.getAttribute('placeholder')?.includes('B'));
  await page.evaluate(() => window.__releaseConfig());
  await waitFooter('默认');
  ck('late A config cannot populate B footer', !(await text()).includes('low') && !(await text()).includes('high'));
  if (await page.getByTestId('composer-model-sheet').isVisible()) await open();
  await page.evaluate(() => { delete window.__variantNodes.B.modelVariant; });
  await open();
  await page.waitForFunction(() => {
    const text = ['composer-model', 'composer-variant']
      .map(id => document.querySelector(`[data-testid="${id}"]`)?.textContent || '').join(' ');
    return text.includes('stub/effective') && text.includes('思考档位')
      && (document.querySelector('[data-testid="composer-variant-entry"]')?.getAttribute('aria-label') || '').includes('未知');
  });
  ck('missing variant on older config is unknown, not explicit default', !(await text()).includes('默认'));
  ck('no page errors', errors.length === 0);
  console.log(`${checks}/${checks} mounted composer variant checks passed`);
} finally {
  await browser.close();
  web.close();
}
