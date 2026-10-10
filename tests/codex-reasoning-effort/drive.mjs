// Fixture Hub: codex-app-server node changes thinking level via update_node_config flags.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

const fixture = () => {
  window.__reasoningCalls = [];
  window.__reasoningApplied = false;
  const node = {
    node_id: 'n_codex_reason',
    alias: 'codex-reason-fixture',
    runtime: 'codex-app-server',
    status: 'idle',
    lifecycle_state: 'running',
    config_revision: 0,
    config_snapshot: { flags: { modelReasoningEffort: 'low' } },
    network_id: 'net-sweep',
  };
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/api/status') return { ok: true, sessions: [node] };
    if (u.pathname === '/api/nodes') return { ok: true, nodes: [node] };
    if (u.pathname === '/api/nodes/n_codex_reason/config') {
      return {
        ok: true,
        node_id: 'n_codex_reason',
        alias: node.alias,
        config_update_capable: true,
        config_revision: window.__reasoningApplied ? 1 : 0,
        model: null,
        flags: { modelReasoningEffort: window.__reasoningApplied ? 'high' : 'low' },
      };
    }
    if (u.pathname === '/mcp') {
      const params = JSON.parse(bodyText || '{}').params;
      if (params?.name !== 'update_node_config') return undefined;
      window.__reasoningCalls.push(params.arguments);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, apply_mode: 'hot' }) }] } };
    }
  };
};

try {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 850 } });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: 'codex-reason-fixture' }));
  await page.getByRole('tab', { name: '模型与运行时', exact: true }).click();
  await page.getByTestId('node-reasoning-effort-high').click();
  await page.getByText(/已下发,节点正在应用/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__reasoningCalls), [{
    node_id: 'n_codex_reason',
    base_revision: 0,
    patch: { flags: { modelReasoningEffort: 'high' } },
    network_id: 'net-sweep',
  }]);
  await page.evaluate(() => { window.__reasoningApplied = true; });
  await page.getByTestId('node-reasoning-phase').getByText(/思考程度已设为 high/).waitFor({ timeout: 8000 });
  const outDir = process.env.OUT;
  if (outDir) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: `${outDir}/codex-reasoning-effort-applied.png`, fullPage: false });
  }
  console.log('PASS codex reasoning effort UI + hub payload');
  await ctx.close();
} finally {
  await browser.close();
  await web.close();
}
