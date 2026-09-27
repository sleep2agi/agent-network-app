// 设置 → 语音输入 → 麦克风(桌面)—— 真应用(expo web 导出 + Tauri 桥桩)+ Chromium 假媒体设备。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据,
// 不起 hub 进程、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-mic-device-settings/drive.mjs
//
// 1200×800 + Tauri 桩 = 桌面工作区;--use-fake-ui-for-media-stream 自动通过授权,
// --use-fake-device-for-media-stream 给假麦克风(带测试音)。授权前的空设备名由 spyScript 模拟
// (fake-ui 一开始就给名字,真机不会)。
// 检查:
//   perm    首次进来设备名为空 → 只有「跟随系统默认」+「允许访问麦克风」;点了 → 设备名出现、按钮消失
//   meter   电平表 aria-valuenow 在假设备测试音下 > 0
//   pick    选一台 → 存进 localStorage;电平表按 deviceId exact 重开流
//   record  「测试语音识别」录音走所选设备(deviceId exact)
//   removed 选中的设备从枚举里消失 + devicechange → 下拉框回到默认、行内提示、存盘改为 ''
//   release 离开语音输入页 → 所有开过的音轨都 ended
//   layout  下拉框左边缘 = 本页其它控件左边缘(±1px);电平表与下拉框垂直中心差 ≤ 1px
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

// 桩外再包一层:给「测试」按钮一份假凭据(接口指向不存在的地址,识别失败无所谓,只看开流约束),
// 记录每次 getUserMedia 的约束和开出来的音轨。
const spyScript = () => {
  const inner = window.__TAURI_INTERNALS__;
  if (inner) {
    const invoke = inner.invoke;
    inner.invoke = async (cmd, args) => {
      if (cmd === 'load_voice_credentials') return JSON.stringify({ accessToken: 'placeholder-key', endpoint: 'https://asr.invalid/flash' });
      return invoke(cmd, args);
    };
  }
  window.__gum = []; window.__tracks = [];
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    window.__gum.push(JSON.parse(JSON.stringify(c)));
    const s = await gum(c);
    window.__tracks.push(...s.getTracks());
    return s;
  };
  const enumerate = md.enumerateDevices.bind(md);
  window.__hide = new Set();
  // --use-fake-ui-for-media-stream 让 Chromium 一开始就给设备名;真 WKWebView / WebView2 授权前是空名
  // 空 id。这里按真机行为:还没 getUserMedia 过就把名字和 id 抹掉(WebKit 同样)。
  md.enumerateDevices = async () => (await enumerate())
    .filter(d => !window.__hide.has(d.deviceId))
    .map(d => window.__gum.length ? d : { deviceId: '', groupId: '', kind: d.kind, label: '' });
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(initScript, { theme: 'light' });
await page.addInitScript(spyScript);
await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });

const bbox = async (sel) => page.locator(sel).first().boundingBox();
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
const select = page.locator('[data-testid="voice-mic-select"]');
const optionTexts = () => select.locator('option').allInnerTexts();
const meterNow = () => page.locator('[data-testid="voice-mic-meter"]').getAttribute('aria-valuenow').then(Number);
const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };
const stored = () => page.evaluate(() => localStorage.getItem('voice_mic_device_v1'));

try {
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '设置分类 语音输入' }).click();
  await page.locator('[data-testid="voice-mic"]').waitFor({ timeout: 10000 });

  // ── perm ───────────────────────────────────────────────────────────────────
  const before = await optionTexts();
  ck('perm: 授权前只有「跟随系统默认」', before.length === 1 && before[0] === '跟随系统默认', JSON.stringify(before));
  ck('perm: 授权前显示「允许访问麦克风」', await page.locator('[data-testid="voice-mic-allow"]').isVisible());
  ck('perm: 授权前不开流(不偷偷点亮麦克风)', (await page.evaluate(() => window.__gum.length)) === 0);
  await shot('mic-before-permission');
  await page.locator('[data-testid="voice-mic-allow"]').click();
  ck('perm: 点了 → 设备名出现', await waitFor(async () => (await optionTexts()).length > 1));
  const opts = await optionTexts();
  console.log('options:', JSON.stringify(opts));
  ck('perm: 第一项仍是「跟随系统默认」,其余都有名字', opts[0] === '跟随系统默认' && opts.slice(1).every(o => o.trim().length > 0));
  ck('perm: 授权后按钮消失', await waitFor(async () => !(await page.locator('[data-testid="voice-mic-allow"]').isVisible())));
  ck('perm: 授权那次开的流已关掉', (await page.evaluate(() => window.__tracks[0]?.readyState)) === 'ended');

  // ── meter ──────────────────────────────────────────────────────────────────
  let peak = 0;
  ck('meter: 假设备测试音下电平 > 0', await waitFor(async () => { peak = Math.max(peak, await meterNow()); return peak > 0; }), `peak=${peak}`);
  await shot('mic-settings');

  // ── layout ─────────────────────────────────────────────────────────────────
  const sel = await bbox('[data-testid="voice-mic-select"]');
  const meter = await bbox('[data-testid="voice-mic-meter"]');
  const refs = [];
  for (const [name, s] of [['识别模型 选项', '[data-testid="voice-mode-flash"]'], ['API Key 输入框', '[data-testid="voice-api-key"]'], ['保存 按钮', '[data-testid="voice-save"]']]) {
    const b = await bbox(s);
    if (b) refs.push({ name, x: b.x });
  }
  const selMid = sel.y + sel.height / 2, meterMid = meter.y + meter.height / 2;
  console.log('\ncontrol                 left     top   height   midY');
  console.log(`麦克风 下拉框        ${sel.x.toFixed(1).padStart(7)} ${sel.y.toFixed(1).padStart(7)} ${sel.height.toFixed(1).padStart(6)} ${selMid.toFixed(1).padStart(7)}`);
  console.log(`电平表               ${meter.x.toFixed(1).padStart(7)} ${meter.y.toFixed(1).padStart(7)} ${meter.height.toFixed(1).padStart(6)} ${meterMid.toFixed(1).padStart(7)}`);
  for (const r of refs) console.log(`${r.name.padEnd(18)} ${r.x.toFixed(1).padStart(7)}`);
  ck('layout: 找到 3 个参照控件', refs.length === 3, refs.map(r => r.name).join(','));
  const worstX = refs.reduce((m, r) => Math.max(m, Math.abs(r.x - sel.x)), 0);
  ck('layout: 下拉框左边缘 = 其它控件左边缘 ±1px', worstX <= 1, `worst Δx=${worstX.toFixed(2)}`);
  ck('layout: 电平表与下拉框垂直居中 ≤1px', Math.abs(meterMid - selMid) <= 1, `Δ=${(meterMid - selMid).toFixed(2)}`);
  const sectionRight = (await bbox('[data-testid="voice-mic"]'));
  ck('layout: 电平表右边缘不超出本栏', meter.x + meter.width <= sectionRight.x + sectionRight.width + 0.5, `${(meter.x + meter.width).toFixed(1)} vs ${(sectionRight.x + sectionRight.width).toFixed(1)}`);

  // ── pick ───────────────────────────────────────────────────────────────────
  const ids = await select.locator('option').evaluateAll(els => els.map(e => e.value));
  const pick = ids[ids.length - 1];
  ck('pick: 有真实设备可选(非默认)', !!pick);
  const gumBefore = await page.evaluate(() => window.__gum.length);
  await select.selectOption(pick);
  ck('pick: 选择存进本地偏好', (await stored()) === pick, String(await stored()));
  ck('pick: 电平表按 deviceId exact 重开流', await waitFor(async () => (await page.evaluate(() => window.__gum)).slice(gumBefore).some(c => c.audio?.deviceId?.exact === pick)));
  await shot('mic-picked');

  // ── record ─────────────────────────────────────────────────────────────────
  const gumRec = await page.evaluate(() => window.__gum.length);
  await page.locator('[data-testid="voice-test"]').click();
  ck('record: 「测试语音识别」录音走所选设备', await waitFor(async () => (await page.evaluate(() => window.__gum)).slice(gumRec).some(c => c.audio?.deviceId?.exact === pick)));
  await page.waitForTimeout(3600); // 等 3 s 录音结束

  // ── removed ────────────────────────────────────────────────────────────────
  await page.evaluate((id) => { window.__hide.add(id); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); }, pick);
  ck('removed: 提示「已改回跟随系统默认」', await waitFor(async () => (await page.locator('[data-testid="voice-mic-notice"]').isVisible().catch(() => false))));
  ck('removed: 下拉框回到默认', (await select.inputValue()) === '');
  ck('removed: 存盘改为默认', (await stored()) === '');
  ck('removed: 被拔掉的设备不在列表里', !(await select.locator('option').evaluateAll(els => els.map(e => e.value))).includes(pick));
  await shot('mic-removed');

  // ── release ────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: '设置分类 外观' }).click();
  ck('release: 离开语音输入页后所有音轨 ended', await waitFor(async () => page.evaluate(() => window.__tracks.length > 0 && window.__tracks.every(t => t.readyState === 'ended'))), String(await page.evaluate(() => window.__tracks.map(t => t.readyState).join(','))));
} catch (e) {
  ck(`driver threw: ${e?.message ?? e}`, false);
}

ck('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
web.close();
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('FAILED:', failures.join('; ')); process.exit(1); }
