// #4099 核心四态（按 backend 689d99e1 顶层字段）：
// A1 读回旧值 → 不 applied；A2 读回缺 modelVariant（unknown）→ 不 applied；A3 读回失败 → 不 applied
// C 同 render 双击 → 1 次写；B 切目标在途 → 不污染新目标
// 用法: WEB_DIR=/tmp/opencode/web4099v2 node /tmp/opencode/neg-4099-core.mjs
import { serveExport, initScript, findChromium, TEST_LOCALE } from '/tmp/opencode/app-4130-modelline/tests/test-layout-sweep/harness.mjs';
const { chromium } = await import('/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs');

const { url } = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const results = [];
const ck = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

// mode: stale | unknownVariant | readFail | ok
async function run(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1, locale: TEST_LOCALE, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).split('\n')[0]));
  await page.addInitScript((m) => {
    window.__writes = 0;
    let reads = 0;
    const rpc = (p) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(p) }] } });
    window.__routeOverride = (u, bodyText) => {
      const uu = new URL(u); const p = uu.pathname;
      if (p === '/api/status' && !bodyText) return { ok: true, files_capable: true, sessions: [
        { alias: '示例-A', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_sweep_a', session_id: 'ses_A', network_id: 'net-sweep', updated_at: new Date().toISOString() },
        { alias: '示例-B', status: 'idle', agent: 'opencode-cli', runtime: 'opencode-cli', node_id: 'n_sweep_b', session_id: 'ses_B', network_id: 'net-sweep', updated_at: new Date().toISOString() } ] };
      if (p === '/api/nodes' && !bodyText) return { ok: true, nodes: [
        { node_id: 'n_sweep_a', alias: '示例-A', lifecycle_state: 'running', runtime: 'opencode-cli', opencode_generation: 'v2', lifecycle_daemon_node_id: 'd_a' },
        { node_id: 'n_sweep_b', alias: '示例-B', lifecycle_state: 'running', runtime: 'opencode-cli', opencode_generation: 'v2', lifecycle_daemon_node_id: 'd_b' } ] };
      if (p === '/mcp') {
        const params = JSON.parse(bodyText || '{}')?.params ?? {};
        if (params.name === 'read_opencode_catalog') return rpc({ ok: true, request_id: 'r1', status: 'pending' });
        if (params.name === 'get_opencode_catalog') return rpc({ ok: true, request_id: 'r1', status: 'ready', snapshot: { providers: [{ id: 'openai' }], models: [{ providerId: 'openai', id: 'gpt-5-codex', variants: ['low', 'high'] }] } });
        if (params.name === 'update_node_config') { window.__writes++; return rpc({ ok: true, update_id: 'u1', apply_mode: 'hot' }); }
      }
      if (/^\/api\/nodes\/[^/]+\/config$/.test(p) && !bodyText) {
        reads++;
        const nodeId = p.split('/')[3];
        if (m === 'readFail' && reads > 1) return { ok: false };
        const base = { ok: true, node_id: nodeId, config_revision: reads > 1 ? 4 : 3, model: 'openai/gpt-5-codex',
          model_effective: 'openai/gpt-5-codex', config_update_capable: true, opencode_variant_config_capable: true };
        if (reads === 1) return { ...base, modelVariant: 'low' };          // 初始档位 low
        if (m === 'stale') return { ...base, modelVariant: 'low' };        // 写后仍读回 low → 不匹配
        if (m === 'unknownVariant') return { ...base };                    // 键缺失 = unknown（不是 null）
        if (m === 'applied') return { ...base, modelVariant: 'high', last_update: { update_id: 'u1', status: 'applied', terminal: true, requested_model: 'openai/gpt-5-codex' } };
        if (m === 'mismatch') return { ...base, modelVariant: 'high', last_update: { update_id: 'other', status: 'applied', terminal: true, requested_model: 'openai/gpt-5-codex' } };
        return { ...base, modelVariant: 'high' };                          // ok
      }
      return undefined;
    };
  }, mode);
  await page.addInitScript(initScript, { theme: 'light' });
  await page.goto(`${url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="composer-model-entry"]').click();
  await page.waitForTimeout(4500);
  return { ctx, page, errors };
}

const sheetText = (page) => page.evaluate(() => document.querySelector('[data-testid="composer-model-sheet"]')?.innerText ?? '');

// A1 旧值
{
  const { ctx, page, errors } = await run('stale');
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1400); }
  const t = await sheetText(page);
  // 严格负控：不得出现 applied 成功态元素（phaseText: `已切换到 <model>`）
  ck('A1 读回旧值 → 无 applied 成功态元素', !/已切换到/.test(t), t.replace(/\n/g, ' ').slice(0, 80));
  ck('A1 仍给出接受但未确认说明', /已接受/.test(t) && /(未确认|未匹配)/.test(t), (t.match(/已接受[^\n]*/) ?? [''])[0]);
  ck('A1 无异常', errors.length === 0);
  await ctx.close();
}

// A2 读回缺 modelVariant（unknown）
{
  const { ctx, page, errors } = await run('unknownVariant');
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1400); }
  const t = await sheetText(page);
  ck('A2 读回 unknown → 无 applied 成功态元素', !/已切换到/.test(t), t.replace(/\n/g, ' ').slice(0, 80));
  ck('A2 不当 null 且写明 unknown', /已接受/.test(t) && /unknown/.test(t) && !/已清除/.test(t), (t.match(/已接受[^\n]*/) ?? [''])[0]);
  ck('A2 无异常', errors.length === 0);
  await ctx.close();
}

// A3 读回失败
{
  const { ctx, page, errors } = await run('readFail');
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1400); }
  const t = await sheetText(page);
  ck('A3 读回失败 → 无 applied 成功态元素', !/已切换到/.test(t), t.replace(/\n/g, ' ').slice(0, 80));
  ck('A3 写明读回失败/未确认', /已接受/.test(t) && /(未确认|读回失败)/.test(t), (t.match(/已接受[^\n]*/) ?? [''])[0]);
  ck('A3 无异常', errors.length === 0);
  await ctx.close();
}

// C 双击 1 写
{
  const { ctx, page, errors } = await run('ok');
  await page.evaluate(() => { window.__stubDelayMs = 800; });
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) { await Promise.all([chip.click().catch(() => {}), chip.click().catch(() => {})]); await page.waitForTimeout(1800); }
  const w = await page.evaluate(() => window.__writes);
  ck('C 同 render 双击只 1 次写', w === 1, `writes=${w}`);
  ck('C 无异常', errors.length === 0);
  await ctx.close();
}

// B 切目标在途
{
  const { ctx, page, errors } = await run('ok');
  await page.evaluate(() => { window.__stubDelayMs = 900; });
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) await chip.click().catch(() => {});
  await page.locator('[data-agent-alias="示例-B"]').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const w1 = await page.evaluate(() => window.__writes);
  const t = await sheetText(page);
  ck('B 切目标后旧写只发生一次且不污染新目标', w1 <= 1 && !/已接受/.test(t), `writes=${w1} newSheet="${t.slice(0, 30)}"`);
  // 同组件（不 reload）在**新 target** 上再改一次档位：必须成功发出第 2 次写（证明旧 finally 没把新 scope 的锁锁死）
  await page.locator('[data-testid="composer-model-entry"]').first().click().catch(() => {});
  await page.waitForTimeout(4500);
  const panelB = await page.locator('[data-testid="composer-model-sheet"]').count();
  const chipB = page.locator('[data-testid="node-variant-chip-high"]');
  const chipBCount = await chipB.count();
  const sheetBTxt = (await sheetText(page)).replace(/\n/g, ' ').slice(0, 120);
  if (chipBCount) { await chipB.click().catch(() => {}); await page.waitForTimeout(1200); }
  const variantRow = await page.locator('[data-testid="node-variant-row"]').innerText().catch(() => '');
  const gateTxt = await page.locator('[data-testid="node-variant-disabled"]').innerText().catch(() => '');
  console.log(`DBG B2 panel=${panelB} chips=${chipBCount} row="${variantRow.replace(/\n/g,'|')}" gate="${gateTxt}"`);
  const w2 = await page.evaluate(() => window.__writes);
  ck('B2 新 target 可再提交（writes 增加 1，旧 finally 未锁死新 scope）', w2 === w1 + 1, `writes ${w1} -> ${w2}`);
  ck('B 无异常', errors.length === 0);
  await ctx.close();
}

// 正向：last_update.applied 且 request_id 对齐 → applied
{
  const { ctx, page, errors } = await run('applied');
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1500); }
  const t = await sheetText(page);
  ck('E1 last_update=applied 且 update_id 对齐 → applied', !/未确认/.test(t) && /(已切换|已生效|当前：high)/.test(t), t.replace(/\n/g, ' ').slice(0, 90));
  ck('E1 无异常', errors.length === 0);
  await ctx.close();
}

// 反向：last_update.request_id 不匹配 → 未确认
{
  const { ctx, page, errors } = await run('mismatch');
  const chip = page.locator('[data-testid="node-variant-chip-high"]');
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1500); }
  const t = await sheetText(page);
  ck('E2 update_id 不匹配 → 未确认', /未确认/.test(t), (t.match(/已接受[^\n]*/) ?? t.slice(0, 60))[0]);
  ck('E2 无异常', errors.length === 0);
  await ctx.close();
}

const fail = results.filter(r => !r.ok).length;
console.log('DETAIL ' + JSON.stringify({ fail, total: results.length }));
await browser.close();
process.exit(fail ? 1 : 0);
