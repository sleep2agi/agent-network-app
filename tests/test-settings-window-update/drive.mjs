// 设置窗里的「软件更新」—— 真应用(expo web 导出 + Tauri 桥桩),不起 hub、不占端口、不碰 HOME。
// owner 0.2.145:设置独立成窗(#483)后,关于 → 软件更新显示「发现新版本 · 点击查看并安装」,点了没反应。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-settings-window-update/drive.mjs
//
// 桩:窗口 label 按场景改(settings / main / chat-*),plugin:updater|check 按场景回「有新版本」或 null,
// download_and_install / stop_local_hub / plugin:process|restart 只记录调用顺序。
// 场景:
//   settings  label=settings ?settings=1:不自动检查、不弹;点「软件更新」→ 弹窗;居中、不裁切(1200×800 /
//             960×720 窗口默认 / 720×520 最小);点「立即更新并重启」→ 下载安装 → 停本地 Hub → 重启
//   main-auto 主窗口启动自动检查有新版本 → 弹(原行为)
//   main-row  主窗口自动检查没新版本 → 主窗口内联设置(开窗失败的回退)点「软件更新」→ 查到 → 弹
//   chat      分离聊天窗:不检查、不弹
// 任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// 在 harness 桩外再包一层:改窗口 label,接管 updater / process / 本地 Hub 命令。
const updaterStub = ({ label, answers }) => {
  const inner = window.__TAURI_INTERNALS__;
  inner.metadata = { currentWindow: { label }, currentWebview: { windowLabel: label, label } };
  window.__calls = [];
  let n = 0;
  const invoke = inner.invoke;
  inner.invoke = async (cmd, args) => {
    if (cmd === 'plugin:updater|check') {
      window.__calls.push(cmd);
      const available = answers[Math.min(n++, answers.length - 1)];
      return available ? { rid: 7, currentVersion: '0.2.145', version: '0.2.146', date: null, body: "What's new in 0.2.146:\n- 示例更新说明", rawJson: {} } : null;
    }
    if (cmd === 'plugin:updater|download_and_install' || cmd === 'stop_local_hub' || cmd === 'plugin:process|restart') { window.__calls.push(cmd); return null; }
    return invoke(cmd, args);
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });
const errors = [];
const open = async ({ label, query = '', answers, viewport = { width: 1200, height: 800 } }) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${label}: ${e}`));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(updaterStub, { label, answers });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0${query}`);
  return { page, ctx };
};
const calls = (page) => page.evaluate(() => window.__calls.slice());
const waitFor = async (page, fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };
const card = (page) => page.locator('[data-testid="desktop-update-card"]');
// 按按钮文字判「弹没弹」(不依赖 testID,旧导出上也能跑同一个判据做对照)。
const cardShown = (page) => page.getByText('立即更新并重启', { exact: true }).first().isVisible().catch(() => false);

const measure = async (page, vp, tag) => {
  const c = await card(page).boundingBox();
  const b = await page.locator('[data-testid="desktop-update-install"]').boundingBox();
  const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
  console.log(`  ${tag.padEnd(14)} viewport ${vp.width}×${vp.height}  card x=${c.x.toFixed(1)} y=${c.y.toFixed(1)} w=${c.width.toFixed(1)} h=${c.height.toFixed(1)}  centre Δx=${(cx - vp.width / 2).toFixed(2)} Δy=${(cy - vp.height / 2).toFixed(2)}  button y=${b.y.toFixed(1)}..${(b.y + b.height).toFixed(1)}`);
  ck(`${tag}: card centred horizontally ±1px`, Math.abs(cx - vp.width / 2) <= 1, `Δx=${(cx - vp.width / 2).toFixed(2)}`);
  ck(`${tag}: card centred vertically ±1px`, Math.abs(cy - vp.height / 2) <= 1, `Δy=${(cy - vp.height / 2).toFixed(2)}`);
  ck(`${tag}: card fully inside the window`, c.x >= 0 && c.y >= 0 && c.x + c.width <= vp.width && c.y + c.height <= vp.height);
  ck(`${tag}: install button inside the card and the window`, b.y >= c.y && b.y + b.height <= c.y + c.height && b.y + b.height <= vp.height);
};

try {
  // ── settings window ────────────────────────────────────────────────────────
  for (const vp of [{ width: 1200, height: 800 }, { width: 960, height: 720 }, { width: 720, height: 520 }]) {
    const tag = `settings ${vp.width}×${vp.height}`;
    const { page, ctx } = await open({ label: 'settings', query: '&settings=1&category=about', answers: [true], viewport: vp });
    const row = page.locator('[data-testid="settings-update-row"]');
    await row.waitFor({ timeout: 20000 });
    await page.waitForTimeout(3500); // past the 2.5s startup timer
    ck(`${tag}: no startup auto check in the settings window`, (await calls(page)).length === 0, JSON.stringify(await calls(page)));
    ck(`${tag}: no prompt before the click`, !(await cardShown(page)));
    await row.click();
    ck(`${tag}: click → prompt appears`, await waitFor(page, () => cardShown(page)));
    const label = await page.locator('[data-testid="settings-update-label"]').innerText();
    console.log(`  row label: ${label}`);
    await measure(page, vp, tag);
    if (OUT) await page.screenshot({ path: `${OUT}/settings-${vp.width}x${vp.height}.png` });
    if (vp.width === 1200) {
      await page.locator('[data-testid="desktop-update-install"]').click();
      const want = ['plugin:updater|check', 'plugin:updater|download_and_install', 'stop_local_hub', 'plugin:process|restart'];
      ck('settings: install → download_and_install → stop_local_hub → restart, from this window', await waitFor(page, async () => JSON.stringify(await calls(page)) === JSON.stringify(want)), JSON.stringify(await calls(page)));
    }
    await ctx.close();
  }

  // ── main window, startup auto check finds an update (unchanged) ─────────────
  {
    const { page, ctx } = await open({ label: 'main', answers: [true] });
    await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
    ck('main-auto: startup check prompts in the main window', await waitFor(page, () => cardShown(page), 8000), JSON.stringify(await calls(page)));
    await measure(page, { width: 1200, height: 800 }, 'main-auto');
    if (OUT) await page.screenshot({ path: `${OUT}/main-auto.png` });
    await ctx.close();
  }

  // ── main window, nothing at startup, then the row in main's own settings ────
  {
    const { page, ctx } = await open({ label: 'main', answers: [false, true] });
    await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
    ck('main-row: startup check ran and found nothing', await waitFor(page, async () => (await calls(page)).length === 1, 8000));
    ck('main-row: no prompt', !(await cardShown(page)));
    // 桌面上设置本来开独立窗;这里走「开窗失败 → 主窗口内联设置」那条回退(App.tsx setScreen({ name: 'settings' }))。
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    await page.getByText(/^(About|关于)$/).first().click();
    const row = page.locator('[data-testid="settings-update-row"]');
    await row.waitFor({ timeout: 10000 });
    await row.click();
    ck('main-row: click in main\'s settings → prompt appears', await waitFor(page, () => cardShown(page)), JSON.stringify(await calls(page)));
    if (OUT) await page.screenshot({ path: `${OUT}/main-row.png` });
    await ctx.close();
  }

  // ── detached chat window ───────────────────────────────────────────────────
  {
    const { page, ctx } = await open({ label: 'chat-sweep', query: `&chat=${encodeURIComponent('示例-A')}`, answers: [true] });
    await page.waitForTimeout(5000);
    ck('chat: no update check in a detached chat window', (await calls(page)).length === 0, JSON.stringify(await calls(page)));
    ck('chat: no prompt', !(await cardShown(page)));
    await ctx.close();
  }
} catch (e) {
  failures.push(`threw: ${e?.message || e}`);
  console.log(`FAIL: threw ${e?.stack || e}`);
}
if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
await browser.close();
web.close();
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failures:\n  ' + failures.join('\n  ')); process.exit(1); }
