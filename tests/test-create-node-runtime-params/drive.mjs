// 新建节点向导第 4 步「参数」按 runtime 显示(agent-network 看板 #591,父 #583)。
// web export + tests/test-layout-sweep 的页内 Tauri 桩,不起 hub、不占端口、不碰 HOME;nothing touches 127.0.0.1:9200。
// 占位数据:守护 示例-守护,节点名 demo_agent。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-create-node-runtime-params/drive.mjs
//
// 每个视口(桌面 1200×800、手机 390×844)× 主题(浅、深):
//   (1) Claude Agent SDK:第 4 步有 permissionMode / maxTurns / budget,没有 timeout、没有「没有额外参数」那行;
//       maxTurns 与 budget 两格铺满一行(左右边各贴内容区 ±1px,不留被删掉那格的空位)
//   (2) Codex（TUI 共存）、Grok:三项都没有 ⇒ #614 起整个「参数」步不出现(Runtime 之后下一步直接是确认页),
//       确认页上一行「参数：这个 runtime 没有额外参数」,页面上没有 permissionMode / maxTurns / budget / timeout
//   (3) 请求体:Claude → flags {permissionMode, maxTurns, budget};先在 Claude 下填了值再切到 Codex 共存 →
//       flags 为 copresence + 默认 yolo(自动执行开);取消「自动执行」后仅 {copresence:true};Grok → 没有 flags 键
// 任一断言失败或页面打不开 → exit 1。先对改动前的 export 跑:必须红。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const DAEMON = { daemon_node_id: 'd_sweep_1', alias: '示例-守护', hostname: 'host-d', online: true, runtimes_supported: ['claude-agent-sdk', 'codex-app-server', 'grok-build-acp'], can_create_nodes: true };
const VIEWPORTS = [{ name: 'desktop-1200x800', w: 1200, h: 800 }, { name: 'phone-390x844', w: 390, h: 844, mobile: true }];
const THEMES = ['light', 'dark'];
const NONE = '参数：这个 runtime 没有额外参数';
const CODEX_YOLO_FLAGS_JSON = '{"copresence":true,"approvalPolicy":"never","sandboxMode":"danger-full-access","skipGitRepoCheck":true,"copresenceFullAccess":true}';
const CODEX_COPRESENCE_ONLY_JSON = '{"copresence":true}';

let fails = 0;
const ck = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const r1 = (n) => Math.round(n * 10) / 10;

const overrideScript = () => {
  window.__createCalls = [];
  window.__routeOverride = (u, bodyText) => {
    if (u.pathname === '/mcp') {
      let params = {};
      try { params = JSON.parse(bodyText || '{}')?.params ?? {}; } catch {}
      if (params.name !== 'create_node') return undefined;
      window.__createCalls.push(params.arguments);
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, request_id: 'cr_drive_1' }) }] } };
    }
    if (u.pathname === '/api/node-create-requests') return { ok: true, request: { request_id: 'cr_drive_1', status: 'delivered' } };
    return undefined;
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const next = (page) => page.getByText('下一步', { exact: true }).click();

async function openWizard(page) {
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
  await page.evaluate(() => { window.__createCalls = []; });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
  await page.evaluate((d) => window.__anetLayoutSweep.setScreen({ name: 'wizard', daemon: d }), DAEMON);
  await page.getByPlaceholder('例如 my-agent-1').fill('demo_agent');
  await next(page);
}
// 从 Runtime 步选一个没有参数的 runtime,下一步 —— #614:应直接到确认页(参数步被跳过)
async function toConfirmSkippingParams(page, runtimeLabel) {
  await page.getByText(runtimeLabel, { exact: true }).first().click();
  await next(page);
  await page.locator('[data-testid="create-node-submit"]').waitFor({ timeout: 5000 });
}
async function submitFromConfirm(page) {
  await page.locator('[data-testid="create-node-submit"]').click();
  await page.waitForFunction(() => (window.__createCalls || []).length > 0, null, { timeout: 5000 });
  return page.evaluate(() => window.__createCalls[0]);
}
// 从第 2 步(Runtime)选 runtime 并走到第 4 步(参数)
async function toParams(page, runtimeLabel) {
  await page.getByText(runtimeLabel, { exact: true }).first().click();
  await next(page); await next(page);
  await page.locator('[data-testid="create-params-step"]').waitFor();
}
async function submitFromParams(page) {
  await next(page);
  await page.locator('[data-testid="create-node-submit"]').click();
  await page.waitForFunction(() => (window.__createCalls || []).length > 0, null, { timeout: 5000 });
  return page.evaluate(() => window.__createCalls[0]);
}
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null;
}, sel);
// 第 4 步里看得见的字段 —— 按画出来的标签字认(不靠 testID,这样改动前的 export 也能如实量出「多显示了什么」)
const visibleFields = (page) => page.evaluate((none) => {
  const leaves = [...document.querySelectorAll('div, span')].filter(e => {
    if (e.children.length) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).map(e => (e.textContent || '').trim());
  return {
    permissionMode: leaves.includes('permissionMode'),
    maxTurns: leaves.includes('maxTurns'),
    budget: leaves.some(t => /^budget/.test(t)),
    timeout: leaves.includes('timeout'),
    none: [...document.querySelectorAll('[data-testid="create-skipped-note"]')].some(e => (e.textContent || '').includes(none)),
    paramsStep: !!document.querySelector('[data-testid="create-params-step"]'),
  };
}, NONE);
const limitInput = (page, i) => page.locator('input[placeholder="—"]').nth(i);
async function step(name, fn) {
  try { await fn(); } catch (e) { ck(`${name}: case ran`, false, String(e?.message || e).split('\n')[0]); }
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const tag = `${vp.name}-${theme}`;
    const ctx = await browser.newContext({ locale: TEST_LOCALE, colorScheme: theme, viewport: { width: vp.w, height: vp.h }, ...(vp.mobile ? { userAgent: ANDROID_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage();
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(overrideScript);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await step(`${tag} Claude`, async () => {
      await openWizard(page);
      await toParams(page, 'Claude Agent SDK');
      const fc = await visibleFields(page);
      ck(`${tag}: Claude step 4 shows permissionMode + maxTurns + budget, no timeout, no none-line`,
        fc.permissionMode && fc.maxTurns && fc.budget && !fc.timeout && !fc.none, JSON.stringify(fc));
      const sec = await box(page, '[data-testid="create-params-step"]');
      const perm = await box(page, '[data-testid="create-param-permissionMode"]');
      const mt = await box(page, '[data-testid="create-param-maxTurns"]');
      const bg = await box(page, '[data-testid="create-param-budget"]');
      ck(`${tag}: maxTurns/budget fill the row edge to edge (no hole where timeout was)`,
        !!(perm && mt && bg) && near(mt.x, perm.x) && near(bg.r, perm.r) && near(mt.y, bg.y) && near(mt.w, bg.w),
        perm && mt && bg ? `row ${r1(perm.x)}..${r1(perm.r)} · maxTurns ${r1(mt.x)}..${r1(mt.r)} · budget ${r1(bg.x)}..${r1(bg.r)}` : 'missing');
      ck(`${tag}: params section ends at the limits row`, !!(sec && bg) && near(sec.b, bg.b), sec && bg ? `section bottom ${r1(sec.b)} vs row bottom ${r1(bg.b)}` : 'missing');
      if (OUT) await page.screenshot({ path: `${OUT}/${tag}-claude-step4.png` });
      await limitInput(page, 0).fill('7');
      await limitInput(page, 1).fill('2.5');
      const a = await submitFromParams(page);
      ck(`${tag}: Claude request flags = {permissionMode, maxTurns:7, budget:2.5}`,
        a?.node_spec?.runtime === 'claude-agent-sdk' && JSON.stringify(a?.node_spec?.flags) === '{"permissionMode":"default","maxTurns":7,"budget":2.5}', JSON.stringify(a?.node_spec?.flags));
    });
    // ── Claude 填过值,再退回去换 Codex（TUI 共存） ──
    await step(`${tag} Codex`, async () => {
      await openWizard(page);
      await toParams(page, 'Claude Agent SDK');
      await limitInput(page, 0).fill('9');
      await page.getByText('上一步', { exact: true }).click();
      await page.getByText('上一步', { exact: true }).click();
      await toConfirmSkippingParams(page, 'Codex（TUI 共存）');
      const fx = await visibleFields(page);
      ck(`${tag}: Codex co-presence skips the params step; confirm page says so in one line, no param fields`,
        !fx.paramsStep && !fx.permissionMode && !fx.maxTurns && !fx.budget && !fx.timeout && fx.none, JSON.stringify(fx));
      if (OUT) await page.screenshot({ path: `${OUT}/${tag}-codex-confirm.png` });
      const b = await submitFromConfirm(page);
      ck(`${tag}: Codex co-presence request flags = copresence + yolo defaults (stale maxTurns not sent)`,
        b?.node_spec?.runtime === 'codex-app-server' && JSON.stringify(b?.node_spec?.flags) === CODEX_YOLO_FLAGS_JSON, JSON.stringify(b?.node_spec?.flags));
    });
    if (tag === 'desktop-1200x800-light') {
      await step(`${tag} Codex auto-exec off`, async () => {
        await openWizard(page);
        await page.getByText('Codex（TUI 共存）', { exact: true }).first().click();
        const consent = page.getByTestId('codex-auto-execute-consent');
        await consent.waitFor({ timeout: 5000 });
        if (await consent.getAttribute('aria-checked') === 'true') await consent.click();
        ck(`${tag}: auto-exec checkbox off before submit`, await consent.getAttribute('aria-checked') === 'false');
        await next(page);
        await page.locator('[data-testid="create-node-submit"]').waitFor({ timeout: 5000 });
        const c = await submitFromConfirm(page);
        ck(`${tag}: Codex with auto-exec off → flags only {copresence:true}`,
          c?.node_spec?.runtime === 'codex-app-server' && JSON.stringify(c?.node_spec?.flags) === CODEX_COPRESENCE_ONLY_JSON, JSON.stringify(c?.node_spec?.flags));
      });
    }
    await step(`${tag} Grok`, async () => {
      await openWizard(page);
      await toConfirmSkippingParams(page, 'Grok');
      const fg = await visibleFields(page);
      ck(`${tag}: Grok skips the params step; confirm page says so in one line`, !fg.paramsStep && !fg.permissionMode && !fg.maxTurns && !fg.budget && !fg.timeout && fg.none, JSON.stringify(fg));
      const g = await submitFromConfirm(page);
      ck(`${tag}: Grok request has no flags key`, g?.node_spec?.runtime === 'grok-build-acp' && !('flags' in (g?.node_spec ?? {})), JSON.stringify(g?.node_spec));
    });
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
