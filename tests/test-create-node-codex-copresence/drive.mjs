// 新建节点向导 ×「Codex（TUI 共存）」(agent-network 看板 #595,配合 agent-network #2410)。
// web export + tests/test-layout-sweep 的页内 Tauri 桩,不起 hub、不占端口、不碰 HOME;nothing touches 127.0.0.1:9200。
// 占位数据:守护 示例-守护,节点名 demo_agent。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-create-node-codex-copresence/drive.mjs
//
// 每个视口(桌面 1200×800、手机 390×844):
//   (1) 选「Codex（TUI 共存）」提交 → create_node 的 node_spec.runtime=codex-app-server 且 flags.copresence === true
//   (2) 选 Claude Agent SDK 提交 → flags 里没有 copresence 键
//   (3) Hub 回 {ok:false,error:"flag_key_unknown",field:"copresence"}(老 Hub)→ 画出「版本太旧…升级到最新预览版」
//   (4) Hub 接单,创建请求轮询回 runtime_capability_check_failed(目标机缺 tmux/codex/登录)→ 画出说明 + 服务器原话
// 任一断言失败或页面打不开 → exit 1。先对改动前的 export 跑:必须红。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const DAEMON = { daemon_node_id: 'd_sweep_1', alias: '示例-守护', hostname: 'host-d', online: true, runtimes_supported: ['claude-agent-sdk', 'codex-app-server'], can_create_nodes: true };
const VIEWPORTS = [{ name: 'desktop-1200x800', w: 1200, h: 800 }, { name: 'phone-390x844', w: 390, h: 844, mobile: true }];
// 与 src/create-node-request.ts 同文(那边改了这边要跟着改 —— 这里量的是用户真正看到的字)
const TOO_OLD = '这台机器的 Hub 或 daemon 版本太旧，还不支持建 Codex 共存节点。请先把 Hub 和 agent-node 升级到最新预览版，再重新创建。';
const MISSING = '目标机器起不来 Codex 共存节点：它需要装好 tmux 和 codex，并且已经登录 codex（在那台机器上运行 codex login）。';
const DETAIL = "child died within 5000ms post-spawn (likely missing runtime binary or auth for runtime='codex-app-server'): kill ESRCH";

let fails = 0;
const ck = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// 页内:拦 /mcp 的 create_node(记下 arguments)与 /api/node-create-requests,按 window.__createMode 回。
const overrideScript = () => {
  window.__createCalls = [];
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/mcp') {
      let params = {};
      try { params = JSON.parse(bodyText || '{}')?.params ?? {}; } catch {}
      if (params.name !== 'create_node') return undefined;
      window.__createCalls.push(params.arguments);
      const mode = window.__createMode || 'ok';
      const payload = mode === 'old_hub'
        ? { ok: false, error: 'flag_key_unknown', field: 'copresence' }
        : { ok: true, request_id: 'cr_drive_1' };
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } };
    }
    if (u.pathname === '/api/node-create-requests') {
      if (window.__createMode !== 'cap_failed') return { ok: true, request: { request_id: 'cr_drive_1', status: 'delivered' } };
      return { ok: true, request: { request_id: 'cr_drive_1', status: 'runtime_capability_check_failed', runtime: 'codex-app-server',
        error: "child died within 5000ms post-spawn (likely missing runtime binary or auth for runtime='codex-app-server'): kill ESRCH" } };
    }
    return undefined;
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

async function submit(page, runtimeLabel, mode) {
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
  await page.evaluate((m) => { window.__createMode = m; window.__createCalls = []; }, mode);
  // 先切到别的页,保证向导重新挂载、从第一步开始
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
  await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), DAEMON);
  await page.getByPlaceholder('例如 my-agent-1').fill('demo_agent');
  await page.getByText('下一步', { exact: true }).click();
  await page.getByText(runtimeLabel, { exact: true }).first().click();
  // #614:没有可选项的步骤(共存 runtime 的 模型 / 参数)不出现 —— 按「下一步」走到出现「创建节点」为止。
  const submitBtn = page.locator('[data-testid="create-node-submit"]');
  for (let i = 0; i < 4 && !(await submitBtn.count()); i++) await page.getByText('下一步', { exact: true }).click();
  await submitBtn.click();
  await page.waitForFunction(() => (window.__createCalls || []).length > 0, null, { timeout: 5000 });
  return page.evaluate(() => window.__createCalls[0]);
}

const paintedMsg = async (page, text, timeout = 8000) => {
  const t0 = Date.now();
  let p = null;
  while (Date.now() - t0 < timeout) {
    p = await paintedText(page, ':not(:has(*))', text);
    if (p?.painted) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const vw = page.viewportSize().width;
  return [!!p?.painted && p.w >= 8 && p.w <= vw, p ? `painted ${Math.round(p.w)}×${Math.round(p.h)}` : 'not painted'];
};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(overrideScript);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  try {
    const a = await submit(page, 'Codex（TUI 共存）', 'ok');
    ck(`${vp.name}: Codex（TUI 共存） → runtime codex-app-server, flags.copresence === true`,
      a?.node_spec?.runtime === 'codex-app-server' && a?.node_spec?.flags?.copresence === true, JSON.stringify(a?.node_spec));
    // #591:codex-app-server 不读 permissionMode → 不再发,flags 只剩 copresence。
    ck(`${vp.name}: co-presence request sends only flags.copresence, no model`,
      JSON.stringify(a?.node_spec?.flags) === '{"copresence":true}' && !('model' in (a?.node_spec ?? {})));

    const b = await submit(page, 'Claude Agent SDK', 'ok');
    ck(`${vp.name}: Claude Agent SDK → no copresence key`, b?.node_spec?.runtime === 'claude-agent-sdk' && !('copresence' in (b?.node_spec?.flags ?? {})), JSON.stringify(b?.node_spec?.flags));

    await submit(page, 'Codex（TUI 共存）', 'old_hub');
    const [oldOk, oldP] = await paintedMsg(page, `创建失败：${TOO_OLD}`);
    ck(`${vp.name}: old hub flag_key_unknown:copresence → upgrade copy painted`, oldOk, oldP);
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-old-hub.png` });

    await submit(page, 'Codex（TUI 共存）', 'cap_failed');
    const [capOk, capP] = await paintedMsg(page, `创建失败:${MISSING}\n服务器原话：${DETAIL}`);
    ck(`${vp.name}: runtime_capability_check_failed → tmux/codex/login copy + server detail painted`, capOk, capP);
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-capability-failed.png` });
  } catch (e) {
    ck(`${vp.name}: case ran`, false, String(e?.message || e).split('\n')[0]);
    if (OUT) await page.screenshot({ path: `${OUT}/${vp.name}-crash.png` }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
web.close();
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
