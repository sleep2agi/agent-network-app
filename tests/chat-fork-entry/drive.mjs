// Real production React mount, synthetic transport only. No native/live account.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, TEST_LOCALE, ANDROID_UA } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.SHOT_DIR || '/tmp/opencode/chat-fork-shots';
mkdirSync(out, { recursive: true });
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let checks = 0;
const ck = (name, result) => { assert.ok(result, name); checks++; console.log(`PASS ${name}`); };
function fixture() {
  window.__chatFork = { mode: 'fail', missing: false, calls: [], directory: 0, creates: 0, gets: 0 };
  window.__routeOverride = (url, raw, method) => {
    const p = new URL(url).pathname;
    const fx = window.__chatFork;
    if (p === '/api/status') return { ok: true, sessions: ['A', 'B'].map(alias => ({
      alias, node_id: `n_${alias}`, network_id: 'net-sweep', runtime: 'opencode-cli', status: 'idle',
      session_id: fx.missing ? undefined : `ses_${alias}123`, project_dir: '/work/current-project',
    })) };
    if (p === '/api/nodes') return { ok: true, nodes: ['A', 'B'].map(alias => ({ alias, node_id: `n_${alias}`,
      runtime: 'opencode-cli', opencode_generation: 'v2', lifecycle_daemon_node_id: 'd_fixture' })) };
    if (p.includes('/source/directory')) { fx.directory++; return { ok: false, error: 'directory_must_not_be_called' }; }
    if (p.includes('/source/project-create')) { fx.creates++; return { ok: false, error: 'create_must_not_be_called' }; }
    if (p === '/api/node-session-control/source' && method === 'POST') {
      fx.calls.push(JSON.parse(raw));
      if (fx.mode === 'unknown') return { ok: true, request_id: 'fork_fixture', status: 'unknown_rotation_required' };
      return { ok: false, error: 'source_preview_unavailable' };
    }
    if (p === '/api/node-session-control/source/fork_fixture') { fx.gets++; return { ok: true, request_id: 'fork_fixture', status: 'unknown_rotation_required' }; }
    return undefined;
  };
}
async function mount(viewport) {
  const ctx = await browser.newContext({ viewport, locale: TEST_LOCALE, ...(viewport.width < 600 ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: 'A' }));
  await page.getByTestId('chat-header-more').waitFor();
  return { ctx, page, errors };
}
async function open(page) {
  await page.getByTestId('chat-header-more').click();
  await page.getByTestId('chat-info-row-fork').click();
  await page.getByTestId('source-fork-frame').waitFor();
}
async function bounds(page, viewport) {
  const box = await page.getByTestId('source-fork-frame').boundingBox();
  ck('palette fits viewport', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
}
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { ctx, page, errors } = await mount(viewport);
    const composerBefore = await page.getByTestId('composer-model-entry').boundingBox();
    await page.getByTestId('chat-header-more').click();
    await page.getByTestId('chat-info-row-fork').waitFor();
    ck(`${name}: fork is a node menu row, not a composer pill`, await page.getByTestId('chat-info-row-fork').count() === 1);
    await page.screenshot({ path: `${out}/${name}-entry.png` });
    await page.getByTestId('chat-info-row-fork').click();
    await page.getByTestId('source-palette-row-ses_A123-check').waitFor();
    ck(`${name}: current node only, unique checked native session`, await page.locator('[data-testid$="-check"]').count() === 1 && await page.getByTestId('source-palette-row-ses_B123').count() === 0);
    ck(`${name}: no directory/create side effects`, await page.evaluate(() => window.__chatFork.directory === 0 && window.__chatFork.creates === 0));
    ck(`${name}: path group has count 1`, (await page.getByTestId('source-palette-group-fork:/work/current-project-count').innerText()) === '1');
    await bounds(page, viewport);
    await page.screenshot({ path: `${out}/${name}-open.png` });
    await page.getByTestId('source-palette-search').fill('current-project');
    await page.getByTestId('source-palette-row-ses_A123').click();
    await page.getByTestId('source-fork-child-name').fill('chat-fork-child');
    await bounds(page, viewport);
    await page.screenshot({ path: `${out}/${name}-selected.png` });
    await page.getByTestId('source-fork-submit').click();
    await page.getByTestId('source-fork-message').waitFor();
    const error = await page.getByTestId('source-fork-message').innerText();
    ck(`${name}: real gate error visible, no fallback`, error.includes('source_preview_unavailable') && error.includes('不会退回普通创建'));
    const calls = await page.evaluate(() => window.__chatFork.calls);
    assert.deepEqual(Object.keys(calls[0]).sort(), ['child_name', 'intent_id', 'mode', 'network_id', 'session_id', 'source_node_id']);
    ck(`${name}: exact current source/native session and fork mode`, calls.length === 1 && calls[0].session_id === 'ses_A123' && calls[0].source_node_id === 'n_A' && calls[0].mode === 'fork_independent' && calls[0].network_id === 'net-sweep');
    await bounds(page, viewport);
    await page.screenshot({ path: `${out}/${name}-failure.png` });
    await page.getByTestId('source-fork-frame-close').click();
    const composerAfter = await page.getByTestId('composer-model-entry').boundingBox();
    ck(`${name}: composer layout unchanged`, composerBefore && composerAfter && Math.abs(composerAfter.height - composerBefore.height) <= 1 && Math.abs(composerAfter.width - composerBefore.width) <= 1);
    await page.evaluate(() => { window.__chatFork.mode = 'unknown'; });
    await open(page);
    await page.getByTestId('source-fork-submit').click();
    await page.getByTestId('source-fork-status').waitFor();
    ck(`${name}: unknown disables submit rather than generating another intent`, await page.getByTestId('source-fork-submit').getAttribute('aria-disabled') === 'true');
    ck(`${name}: unknown added only one POST`, await page.evaluate(() => window.__chatFork.calls.length === 2));
    await page.getByTestId('source-fork-frame-close').click();
    await page.evaluate(() => { window.__chatFork.missing = true; });
    await open(page);
    await page.getByTestId('chat-fork-source-error').waitFor();
    // #1328 turned the raw codes into human text (describeForkSourceError). The drive
    // was still asserting the code string, so it went red on a behaviour that was
    // deliberately changed. Assert what the user sees, and keep the structural parts
    // (no submit, no preselection) that actually carry the guarantee.
    const missingText = await page.getByTestId('chat-fork-source-error').innerText();
    ck(`${name}: missing native id means explicit error and no preselection`,
      missingText.includes('还没有 OpenCode 会话')
      && await page.getByTestId('source-fork-submit').count() === 0
      && await page.locator('[data-testid$="-check"]').count() === 0);
    ck(`${name}: no JS errors`, errors.length === 0);
    await ctx.close();
  }
  console.log(`${checks}/${checks} checks passed; synthetic React transport, not native acceptance`);
} finally { await browser.close(); web.close(); }
