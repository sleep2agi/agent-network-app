// Real production ChatScreen/ComposerModelPalette, synthetic Hub transport only.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.SHOT_DIR || '/tmp/opencode/composer-agent-shots';
mkdirSync(out, { recursive: true });
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let count = 0;
const ck = (name, ok) => { assert.ok(ok, name); count++; console.log(`PASS ${name}`); };
function fixture(mode) {
  const ids = ['build', 'general', 'explore', 'compaction', 'title', 'summary', 'plan', 'build'];
  window.__agentMode = 'applied';
  window.__agentWrites = [];
  window.__agentNode = { node_id: 'n_A', alias: 'A', network_id: 'net-sweep', runtime: 'opencode-cli', opencode_generation: 'v2',
    opencode_catalog: ['fixture/model'], config_revision: 1, config_update_capable: true, model: 'fixture/model', model_effective: 'fixture/model',
    ...(mode === 'missing' ? {} : { opencode_agent_config_capable: mode !== 'unsupported', agents: mode === 'empty' ? [] : ids,
      ...(mode === 'unknown' ? {} : { agent: 'build' }) }) };
  const mcp = value => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
  window.__routeOverride = (url, body) => {
    const node = window.__agentNode;
    if (url.pathname === '/api/status') return { ok: true, sessions: [{ ...node, status: 'idle', agent: 'agent-node:opencode' }] };
    if (url.pathname === '/api/nodes') return { ok: true, nodes: [node] };
    if (url.pathname === '/api/nodes/n_A/config') return node;
    if (url.pathname !== '/mcp') return undefined;
    const call = JSON.parse(body).params;
    if (call.name !== 'update_node_config') return undefined;
    const args = call.arguments;
    window.__agentWrites.push(args);
    const update_id = `u_${window.__agentWrites.length}`;
    if (['agent_unsupported', 'invalid_patch', 'timeout'].includes(window.__agentMode)) return mcp({ ok: false, error: window.__agentMode });
    node.last_update = { update_id, status: 'applied', terminal: true };
    if (window.__agentMode === 'pending') { node.last_update.status = 'pending'; node.last_update.terminal = false; }
    else if (window.__agentMode === 'wrong-id') { node.last_update.update_id = 'old'; node.last_update.status = 'applied'; }
    else if (window.__agentMode !== 'mismatch') node.agent = args.patch.agent;
    node.config_revision++;
    return mcp({ ok: true, update_id });
  };
}
async function mount(viewport, mode = 'present') {
  const page = await browser.newPage({ locale: 'zh-CN', viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture, mode);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: 'A' }));
  await page.getByTestId('composer-model-entry').click();
  await page.getByTestId('model-palette-row-fixture/model').waitFor();
  return { page, errors };
}
const check = page => page.locator('[data-testid^="composer-agent-check-"]');
const row = (page, id) => page.getByTestId(`composer-agent-row-${id}`);
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { page, errors } = await mount(viewport);
    await row(page, 'build').waitFor();
    assert.deepEqual(await page.locator('[data-testid^="composer-agent-row-"]').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label'))), ['build', 'general', 'explore', 'compaction', 'title', 'summary', 'plan']);
    ck(`${label}: native order, dedupe only, internal agents retained`, true);
    ck(`${label}: readback current checked once`, await check(page).count() === 1 && await page.getByTestId('composer-agent-check-build').count() === 1);
    const box = await page.getByTestId('composer-model-sheet').boundingBox();
    ck(`${label}: panel within viewport`, box && box.y >= 0 && box.x >= 0 && box.y + box.height <= viewport.height && box.x + box.width <= viewport.width);
    await page.screenshot({ path: `${out}/${label}.png` });
    await row(page, 'build').focus();
    await page.keyboard.press('ArrowDown');
    ck(`${label}: arrow key focuses next agent`, await row(page, 'general').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter');
    await page.getByTestId('composer-agent-check-general').waitFor();
    ck(`${label}: Enter applies only after ACK plus matching readback`, (await page.getByTestId('model-palette-applied').innerText()).includes('general'));
    assert.deepEqual(await page.evaluate(() => window.__agentWrites[0].patch), { agent: 'general' });
    ck(`${label}: canonical agent-only patch`, await page.evaluate(() => window.__agentWrites[0].node_id === 'n_A' && window.__agentWrites[0].base_revision === 1));
    await page.keyboard.press('Escape');
    await page.getByTestId('composer-model-sheet').waitFor({ state: 'detached' });
    ck(`${label}: Escape closes existing model panel`, true);
    ck(`${label}: no React errors`, errors.length === 0);
    await page.close();
  }
  for (const mode of ['missing', 'unsupported', 'empty', 'unknown']) {
    const { page } = await mount({ width: 390, height: 844 }, mode);
    if (mode === 'missing') {
      // Nothing reported at all — nothing to say.
      ck('missing: complete section hidden', await page.getByTestId('composer-agent-section').count() === 0);
    } else if (mode === 'unknown') {
      // Capability + list present, current agent not reported.
      await page.getByTestId('composer-agent-unknown').waitFor();
      ck('missing current is unknown, never build', await check(page).count() === 0);
      ck('unknown: list still offered when the node can switch', await row(page, 'build').count() === 1);
    } else if (mode === 'unsupported') {
      // No capability ⇒ read-only current value; no rows, no checkmark.
      await page.getByTestId('composer-agent-readonly').waitFor();
      ck('unsupported: current value shown read-only', (await page.getByTestId('composer-agent-readonly').innerText()).includes('build'));
      ck('unsupported: no interactive rows', await page.locator('[data-testid^="composer-agent-row-"]').count() === 0);
      ck('unsupported: no checkmark', await check(page).count() === 0);
    } else {
      // Empty list but a reported current value ⇒ still worth showing.
      await page.getByTestId('composer-agent-readonly').waitFor();
      ck('empty: current value shown read-only', (await page.getByTestId('composer-agent-readonly').innerText()).includes('build'));
      ck('empty: no interactive rows', await page.locator('[data-testid^="composer-agent-row-"]').count() === 0);
    }
    await page.screenshot({ path: `${out}/phone-${mode}.png` });
    await page.close();
  }
  for (const mode of ['agent_unsupported', 'invalid_patch', 'timeout', 'mismatch', 'pending', 'wrong-id']) {
    const { page } = await mount({ width: 1280, height: 900 });
    await row(page, 'build').waitFor();
    await page.evaluate(mode => { window.__agentMode = mode; }, mode);
    if (mode === 'pending') {
      await row(page, 'plan').dispatchEvent('click');
      await page.getByTestId('model-palette-busy').waitFor();
      await row(page, 'plan').dispatchEvent('click');
      ck('pending: no optimistic current', await page.getByTestId('composer-agent-check-build').count() === 1);
      ck('pending: duplicate submission suppressed', await page.evaluate(() => window.__agentWrites.length === 1));
    } else await row(page, 'plan').click();
    await page.getByTestId('model-palette-action-error').waitFor();
    ck(`${mode}: old check remains on failure`, await page.getByTestId('composer-agent-check-build').count() === 1 && await page.getByTestId('composer-agent-check-plan').count() === 0);
    const error = await page.getByTestId('model-palette-action-error').innerText();
    ck(`${mode}: honest error preserved`, error.includes(mode === 'mismatch' ? 'agent_readback_mismatch' : mode === 'pending' || mode === 'wrong-id' ? 'timeout' : mode));
    ck(`${mode}: no write replay`, await page.evaluate(() => window.__agentWrites.length === 1));
    await page.close();
  }
  console.log(`${count}/${count} mounted composer-agent checks passed`);
} finally { await browser.close(); web.close(); }
