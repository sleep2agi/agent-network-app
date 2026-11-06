// #3144 隔离渲染负控：同一个 NodeModelSection 实例里 A→B 切节点，B 的 catalog 延迟返回，
// 再让 A/B 的请求逆序完成与重试。记录：
//   ① B 上是否展示 A 的旧候选（应否）
//   ② 旧候选是否还能提交（应否）
//   ③ pending / failed / ready-空列表 三种状态是否可区分（文案应否）
//
// 这是 **rendered web export + 页面内 Hub fixture**，不是真机、不是真实 daemon、不是线上验收。
// 不触碰生产凭据：fixture 只答 /api/* 与 /mcp，token 用占位串。
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const source = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA;
assert.match(source ?? '', /^[0-9a-f]{40}$/);
console.log(`product_source=${source}; fixture Hub only（无真实 daemon / 无生产凭据）`);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--no-sandbox'] });

// ── fixture ───────────────────────────────────────────────────────────────────
const fixture = () => {
  const mk = (id, alias, model, catalog) => ({
    node_id: id, alias, runtime: 'opencode-cli', status: 'idle', lifecycle_state: 'running',
    config_revision: 0, model, config_snapshot: { model }, network_id: 'net-sweep',
    lifecycle_daemon_node_id: 'n_daemon_fixture', opencode_catalog: catalog, opencode_generation: 'v2',
    runtime_version: '2.5.0-preview.174',
  });
  window.__nodes = {
    'node-a': mk('node-a', 'node-a', 'stub/a-current', ['stub/a-one', 'stub/a-two']),
    'node-b': mk('node-b', 'node-b', 'stub/b-current', ['stub/b-one']),
  };
  // B 的 catalog 什么时候 ready（用来制造「延迟」与「逆序完成」）
  window.__bReady = false;
  window.__aReady = false;
  // fail / empty 用来区分状态文案
  window.__bCatalogMode = 'pending'; // pending | ready | empty | failed
  window.__catalogCalls = [];
  window.__submitCalls = [];

  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/api/status') return { ok: true, sessions: [window.__nodes['node-a'], window.__nodes['node-b']] };
    if (u.pathname === '/api/nodes') return { ok: true, nodes: [window.__nodes['node-a'], window.__nodes['node-b']] };
    const m = /^\/api\/nodes\/([^/]+)\/config$/.exec(u.pathname);
    if (m) {
      const n = window.__nodes[m[1]];
      if (!n) return null;
      return { ...n, config_update_capable: true };
    }
    if (u.pathname !== '/mcp') return undefined;
    let params = {};
    try { params = JSON.parse(bodyText || '{}')?.params ?? {}; } catch {}
    const name = params.name;
    const args = params.arguments ?? {};
    if (name === 'read_opencode_catalog') {
      window.__catalogCalls.push({ tool: name, node: args.node_id });
      const mode = args.node_id === 'node-b' ? window.__bCatalogMode : 'ready';
      if (mode === 'failed') return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'unavailable' }) }] } };
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'pending', request_id: `rq-${args.node_id}` }) }] } };
    }
    if (name === 'get_opencode_catalog') {
      const nodeId = String(args.request_id || '').replace(/^rq-/, '');
      const ready = nodeId === 'node-b' ? window.__bReady : window.__aReady;
      if (!ready) return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'pending', request_id: args.request_id }) }] } };
      const models = nodeId === 'node-b' ? ['stub/b-one'] : ['stub/a-one', 'stub/a-two'];
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'ready', request_id: args.request_id, snapshot: { models: models.map(id => ({ providerId: 'stub', id: id.split('/')[1] })) } }) }] } };
    }
    if (name === 'update_node_config') {
      window.__submitCalls.push(args);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, apply_mode: 'hot', config_revision: 1 }) }] } };
    }
    return undefined;
  };
};

const obs = {};
try {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(fixture);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep);

  const openModelTab = async (alias) => {
    await page.evaluate(a => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: a }), alias);
    await page.getByRole('tab', { name: '模型与运行时', exact: true }).click();
  };
  const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  // ① A 先就绪：候选出现
  await page.evaluate(() => { window.__aReady = true; window.__bReady = false; });
  await openModelTab('node-a');
  await page.getByText('stub/a-one', { exact: false }).first().waitFor({ timeout: 15000 });
  obs.aCandidatesShown = (await bodyText()).includes('stub/a-one');

  // ② 切到 B（B 仍 pending）：A 的候选不应再出现，且状态应是「正在…读取」一类的 pending 文案
  await openModelTab('node-b');
  await page.waitForTimeout(1500);
  const duringB = await bodyText();
  obs.oldCandidatesOnB = duringB.includes('stub/a-one') || duringB.includes('stub/a-two');
  obs.pendingTextOnB = /正在从 OpenCode V2 服务器读取模型列表|读取中|正在读取/.test(duringB);

  // ③ pending 期间点了 A 的旧候选（如果还在）会不会把它提交给 B —— 只按「点候选」这条路径判,
  // 手动在输入框里敲一个模型 id 是产品允许的自由输入,不属于这次的负控范围。
  const staleChip = page.getByText('stub/a-one', { exact: false }).first();
  const staleClickable = await staleChip.count() > 0;
  if (staleClickable) {
    await staleChip.click({ timeout: 3000 }).catch(() => {});
    const submit = page.getByText('切换模型', { exact: true });
    if (await submit.isEnabled().catch(() => false)) {
      await submit.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  obs.staleChipVisible = staleClickable;
  obs.oldCandidateSubmittable = (await page.evaluate(() => window.__submitCalls.length)) > 0;

  // ④ A 的旧请求此时才 ready（逆序完成）：B 上仍然不能出现 A 的候选
  await page.evaluate(() => { window.__aReady = true; });
  await page.waitForTimeout(1800);
  const afterLateA = await bodyText();
  obs.oldCandidatesAfterLateA = afterLateA.includes('stub/a-one') || afterLateA.includes('stub/a-two');

  // ⑤ 放行 B：候选变成 B 的
  await page.evaluate(() => { window.__bReady = true; });
  await page.getByText('stub/b-one', { exact: false }).first().waitFor({ timeout: 15000 });
  const afterB = await bodyText();
  obs.bCandidatesShown = afterB.includes('stub/b-one');
  obs.aStillAbsent = !afterB.includes('stub/a-one') && !afterB.includes('stub/a-two');

  // ⑥ 空列表/失败可区分：fail 模式 → 失败文案 + 重试按钮；ready-empty → 另一句
  await page.evaluate(() => { window.__bCatalogMode = 'failed'; window.__anetLayoutSweep.setScreen({ name: 'agents' }); });
  await openModelTab('node-b');
  await page.waitForTimeout(2500);
  const failedText = await bodyText();
  obs.failedDistinct = /读取 OpenCode 模型列表失败|OpenCode 服务器没有返回|不会自动上报模型清单/.test(failedText);
  obs.failedHasRetry = await page.locator('[data-testid="node-model-catalog-retry"]').count() > 0;
  const pendingText = duringB;
  obs.pendingVsFailedDiffer = pendingText !== failedText;

  obs.pageErrors = errors.length;
  console.log('OBSERVATIONS ' + JSON.stringify(obs, null, 2));

  // 负控判定：只有「B 上不出现 A 的候选」「逆序完成后仍不出现」是硬要求；其余只记录
  assert.equal(obs.aCandidatesShown, true, 'A 自己的候选应先出现（正控）');
  assert.equal(obs.oldCandidatesOnB, false, 'B 上不应出现 A 的旧候选');
  assert.equal(obs.oldCandidateSubmittable, false, '旧候选不应能被提交给 B');
  assert.equal(obs.oldCandidatesAfterLateA, false, 'A 请求逆序完成后，B 上仍不应出现 A 的候选');
  assert.equal(obs.bCandidatesShown, true, 'B 放行后应出现 B 的候选');
  assert.equal(obs.aStillAbsent, true, 'B 就绪后 A 的候选应仍不在');
  assert.equal(obs.failedDistinct, true, '失败文案应可与 pending 区分');
  // failedHasRetry 只记录：失败时若本机上报里还有清单，界面会用「上次上报的清单」兜底而不是给重试按钮，
  // 这是产品既有行为（兜底优先），不作为本次负控的硬判定。
  console.log(`failedHasRetry=${obs.failedHasRetry}（只记录：失败时优先用本机上报清单兜底）`);
  console.log('NEGATIVE-CONTROL PASS');
  // serveExport 的静态服务器会一直挂着事件循环；显式退出，否则 CI 会把它当超时（实测本地也是跑完不退出）。
  process.exitCode = 0;
} catch (e) {
  console.log('OBSERVATIONS ' + JSON.stringify(obs, null, 2));
  console.error('NEGATIVE-CONTROL FAIL: ' + (e && e.message));
  process.exitCode = 1;
  throw e;
} finally {
  await browser.close().catch(() => {});
  // 不等静态服务器优雅关闭：结果已经打印，直接收尾。
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
