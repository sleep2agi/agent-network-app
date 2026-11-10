// Mounted production ChatScreen + the new composer model command palette.
// Synthetic IPC fixture only: no real Hub, daemon, account or native runtime.
//
// It proves, in a real React mount:
//  · the floating palette has a search box and provider groups with counts;
//  · search filters by provider/model (case-insensitive) and shows an empty state;
//  · exactly the current model row carries the checkmark;
//  · selecting a model writes the canonical patch and closes only after a
//    matching terminal ACK + real config readback updated the footer;
//  · a wrong update_id / nonterminal ACK never moves the footer;
//  · unknown variant stays unknown (never painted as the default variant);
//  · double click is single-flight;
//  · the panel sits above the composer card on desktop and phone.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { serveExport, initScript } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const OUT = process.env.SHOT_DIR || '/tmp/opencode/model-picker-shots';
mkdirSync(OUT, { recursive: true });
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
let checks = 0;
const ck = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };

const fx = () => {
  const node = alias => ({
    alias, node_id: `n_${alias}`, network_id: 'net-sweep', runtime: 'opencode-cli',
    opencode_generation: 'v2', lifecycle_daemon_node_id: 'n_fixture_daemon', status: 'idle',
    version: '2.5.0-preview.174', config_revision: 1, config_update_capable: true,
    opencode_variant_config_capable: true,
    model: 'tianma/MiniMax-M3.1-Flash', model_effective: 'tianma/MiniMax-M3.1-Flash',
  });
  window.__mpNodes = { A: node('A'), B: node('B') };
  window.__mpMode = 'applied';
  window.__mpWrites = [];
  window.__mpDelay = 0;
  window.__mpWorld = 'tianma/MiniMax-M3.1-Flash';
  const mcp = value => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
  window.__routeOverride = (url, body) => {
    if (url.pathname === '/api/status') {
      return {
        ok: true,
        sessions: Object.values(window.__mpNodes).map(n => ({
          alias: n.alias, node_id: n.node_id, network_id: n.network_id, runtime: n.runtime,
          status: 'idle', model: window.__mpWorld, version: n.version,
        })),
      };
    }
    if (url.pathname === '/api/nodes') return { ok: true, nodes: Object.values(window.__mpNodes) };
    const cfg = /^\/api\/nodes\/n_([AB])\/config$/.exec(url.pathname);
    if (cfg) return window.__mpNodes[cfg[1]];
    if (url.pathname !== '/mcp') return undefined;
    const { name, arguments: args } = JSON.parse(body).params;
    if (name === 'read_opencode_catalog') return mcp({ ok: true, request_id: 'fixture_catalog' });
    if (name === 'get_opencode_catalog') {
      return mcp({
        ok: true, status: 'ready', snapshot: {
          providers: [
            { id: 'tianma', activation: 'enabled' },
            { id: 'deepseek', activation: 'enabled' },
            { id: 'off', activation: 'disabled' },
          ],
          models: [
            { providerId: 'tianma', id: 'MiniMax-M3.1-Flash' },
            { providerId: 'tianma', id: 'MiniMax-M3' },
            { providerId: 'deepseek', id: 'deepseek-flash' },
            { providerId: 'deepseek', id: 'deepseek-v4-flash' },
            { providerId: 'off', id: 'hidden-model' },
          ],
        },
      });
    }
    if (name !== 'update_node_config') return undefined;
    window.__mpWrites.push(args);
    const n = Object.values(window.__mpNodes).find(x => x.node_id === args.node_id);
    const update_id = `u_${window.__mpWrites.length}`;
    if (window.__mpMode === 'failure') return mcp({ ok: false, error: 'synthetic refusal' });
    // The synthetic node applies the model, but the client must still prove it.
    n.model_effective = args.patch.model;
    if (Object.prototype.hasOwnProperty.call(args.patch, 'modelVariant')) n.modelVariant = args.patch.modelVariant;
    n.last_update = { update_id, status: 'applied', terminal: true, requested_model: args.patch.model };
    if (window.__mpMode === 'wrong-id') n.last_update.update_id = 'unrelated';
    if (window.__mpMode === 'nonterminal') n.last_update.terminal = false;
    return mcp({ ok: true, update_id, apply_mode: 'hot' });
  };
  // Delay MCP update responses when asked, to keep a write in flight for the single-flight check.
  const ipc = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd === 'plugin:http|fetch_send' && window.__mpDelay > 0) await new Promise(r => setTimeout(r, window.__mpDelay));
    return ipc(cmd, args);
  };
};

async function mount(viewport, alias = 'A') {
  const page = await browser.newPage({ locale: 'zh-CN', viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fx);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(a => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: a }), alias);
  await page.getByTestId('composer-model-entry').waitFor();
  return { page, errors };
}

const footerModel = page => page.locator('[data-testid="composer-model"]').innerText();
const footerVariant = page => page.locator('[data-testid="composer-variant"]').innerText();
// Unknown = the pill names the control (思考档位) and its accessibility label says 未知; never a level.
const footerVariantUnknown = async page => (await footerVariant(page)).trim() === '思考档位'
  && ((await page.locator('[data-testid="composer-variant-entry"]').getAttribute('aria-label')) || '').includes('未知');
const open = page => page.getByTestId('composer-model-entry').click();
const waitModel = (page, text) => page.waitForFunction(t => (document.querySelector('[data-testid="composer-model"]')?.textContent || '').includes(t), text);
const checksCount = page => page.locator('[data-testid^="model-palette-check-"]').count();

try {
  const { page, errors } = await mount({ width: 1280, height: 900 });

  // 1) Reported model is visible; missing variant is unknown, never "default".
  await waitModel(page, 'tianma/MiniMax-M3.1-Flash');
  ck('footer variant stays unknown before any config readback', (await footerVariantUnknown(page)) && !(await footerVariant(page)).includes('默认'));

  // 2) Open the floating palette above the composer.
  await open(page);
  await page.getByTestId('composer-model-sheet').waitFor();
  await page.getByTestId('model-palette-search').waitFor();
  await page.waitForFunction(() => !!document.querySelector('[data-testid="model-palette-group-deepseek"]'));
  const panelBox = await page.getByTestId('composer-model-sheet').boundingBox();
  const cardBox = await page.getByTestId('desktop-composer-card').boundingBox();
  ck('palette floats above the composer card', !!panelBox && !!cardBox && panelBox.y + panelBox.height <= cardBox.y + 1);
  ck('palette stays inside the viewport', !!panelBox && panelBox.y >= 0 && panelBox.y + panelBox.height <= 900);

  // 3) Provider groups + counts come from the catalog; disabled provider is absent.
  ck('tianma group count is 2', (await page.getByTestId('model-palette-group-count-tianma').innerText()) === '2');
  ck('deepseek group count is 2', (await page.getByTestId('model-palette-group-count-deepseek').innerText()) === '2');
  ck('disabled provider is not listed', (await page.locator('[data-testid="model-palette-group-off"]').count()) === 0);

  // 4) Exactly the current model row is checked.
  ck('one checkmark only', (await checksCount(page)) === 1);
  ck('checkmark is on the reported current model', (await page.locator('[data-testid="model-palette-check-tianma/MiniMax-M3.1-Flash"]').count()) === 1);
  ck('non-current row has no checkmark', (await page.locator('[data-testid="model-palette-check-tianma/MiniMax-M3"]').count()) === 0);

  await page.screenshot({ path: `${OUT}/desktop-palette.png` });

  // 5) Search filters by provider or model, case-insensitively.
  await page.getByTestId('model-palette-search').fill('DEEPSEEK');
  await page.waitForFunction(() => !document.querySelector('[data-testid="model-palette-group-tianma"]'));
  ck('provider search keeps only its group', (await page.getByTestId('model-palette-group-count-deepseek').innerText()) === '2');
  await page.getByTestId('model-palette-search').fill('flash');
  await page.waitForFunction(() => document.querySelector('[data-testid="model-palette-group-count-tianma"]')?.textContent === '1');
  ck('model search counts visible rows', (await page.getByTestId('model-palette-group-count-deepseek').innerText()) === '2');
  await page.getByTestId('model-palette-search').fill('zzz');
  await page.getByTestId('model-palette-empty').waitFor();
  ck('search miss shows an explicit empty state', (await page.getByTestId('model-palette-empty').innerText()).includes('没有匹配'));
  await page.screenshot({ path: `${OUT}/desktop-palette-empty.png` });

  // 6) A switch updates the footer only after ACK + real readback.
  await page.getByTestId('model-palette-search').fill('');
  await page.getByTestId('model-palette-row-deepseek/deepseek-v4-flash').click();
  await page.getByTestId('composer-model-sheet').waitFor({ state: 'detached' });
  await waitModel(page, 'deepseek/deepseek-v4-flash');
  const writes1 = await page.evaluate(() => window.__mpWrites.length);
  ck('confirmed switch wrote once', writes1 === 1);
  ck('write used the catalog key as model', await page.evaluate(() => window.__mpWrites[0].patch.model === 'deepseek/deepseek-v4-flash'));
  ck('footer variant is still unknown after model-only write', (await footerVariantUnknown(page)) && !(await footerVariant(page)).includes('默认'));

  // 7) Reopen: the checkmark moved, and only one row has it.
  await open(page);
  await page.waitForFunction(() => (document.querySelector('[data-testid="model-palette-check-deepseek/deepseek-v4-flash"]') ? 1 : 0) === 1);
  ck('checkmark follows the confirmed footer model', (await checksCount(page)) === 1);
  await page.screenshot({ path: `${OUT}/desktop-palette-selected.png` });

  // 8) Wrong update_id / nonterminal ACK never moves the footer.
  await page.evaluate(() => { window.__mpMode = 'wrong-id'; });
  await page.getByTestId('model-palette-row-tianma/MiniMax-M3').click();
  await page.getByText('失败:已接受，但生效模型未确认', { exact: true }).waitFor();
  ck('wrong update id keeps the old footer model', (await footerModel(page)).includes('deepseek/deepseek-v4-flash'));
  ck('wrong update id renders the real reason', (await page.getByTestId('model-palette-error-detail').innerText()).length > 0);
  await page.evaluate(() => { window.__mpMode = 'nonterminal'; });
  await page.getByTestId('model-palette-row-deepseek/deepseek-flash').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="model-palette-error-detail"]').length > 0);
  ck('nonterminal ACK keeps the old footer model', (await footerModel(page)).includes('deepseek/deepseek-v4-flash'));

  // 9) Same-turn double click is single-flight.
  await page.evaluate(() => { window.__mpMode = 'applied'; window.__mpDelay = 700; });
  const before = await page.evaluate(() => window.__mpWrites.length);
  const row = page.getByTestId('model-palette-row-tianma/MiniMax-M3');
  await Promise.all([row.click().catch(() => {}), row.click().catch(() => {})]);
  await waitModel(page, 'tianma/MiniMax-M3');
  ck('double click produced one write', (await page.evaluate(() => window.__mpWrites.length)) === before + 1);
  await page.evaluate(() => { window.__mpDelay = 0; });

  // 10) Footer/panel consistency after the confirmed switch.
  await open(page);
  await page.waitForFunction(() => (document.querySelector('[data-testid="model-palette-check-tianma/MiniMax-M3"]') ? 1 : 0) === 1);
  ck('footer and checked row agree', (await footerModel(page)).includes('tianma/MiniMax-M3') && (await checksCount(page)) === 1);
  await page.screenshot({ path: `${OUT}/desktop-palette-phone-like.png` });
  if (errors.length) console.log('PAGE ERRORS', JSON.stringify(errors));
  ck('desktop run has no page errors', errors.length === 0);
  await page.close();

  // 11) Phone viewport: same floating shape above the composer, same data.
  const phone = await mount({ width: 390, height: 844 });
  await waitModel(phone.page, 'tianma/MiniMax-M3.1-Flash');
  await open(phone.page);
  await phone.page.getByTestId('composer-model-sheet').waitFor();
  await phone.page.waitForFunction(() => !!document.querySelector('[data-testid="model-palette-group-tianma"]'));
  const pBox = await phone.page.getByTestId('composer-model-sheet').boundingBox();
  const pFooter = await phone.page.getByTestId('composer-model-entry').boundingBox();
  ck('phone palette sits above the composer footer', !!pBox && !!pFooter && pBox.y + pBox.height <= pFooter.y + 1);
  ck('phone palette stays inside the viewport', !!pBox && pBox.y >= 0 && pBox.y + pBox.height <= 844);
  ck('phone group counts match', (await phone.page.getByTestId('model-palette-group-count-tianma').innerText()) === '2');
  ck('phone current row checked once', (await phone.page.locator('[data-testid^="model-palette-check-"]').count()) === 1);
  await phone.page.screenshot({ path: `${OUT}/phone-palette.png` });
  ck('phone run has no page errors', phone.errors.length === 0);
  await phone.page.close();

  console.log(`${checks}/${checks} mounted composer model palette checks passed`);
} finally {
  await browser.close();
  web.close();
}
