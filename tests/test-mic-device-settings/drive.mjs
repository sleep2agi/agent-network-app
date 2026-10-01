// 设置 → 语音输入 → 麦克风(桌面)—— 真应用(expo web 导出 + Tauri 桥桩)+ Chromium 假媒体设备。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据,
// 不起 hub 进程、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-mic-device-settings/drive.mjs
//
// 两种尺寸 × 浅色 / 深色:
//   1440×900 + Tauri 桩 = 桌面设置窗口(?settings=1&category=voice;AppSelect 行 + 自绘浮层)
//   390×844  + Tauri 桩 = 窄的桌面窗口,设置子页(微信设置行 + 底部动作面板)
// --use-fake-ui-for-media-stream 自动通过授权,--use-fake-device-for-media-stream 给假麦克风(带测试音)。
// 授权前的空设备名由 spyScript 模拟(fake-ui 一开始就给名字,真机不会)。
// 检查(桌面浅色跑全套行为,其余三种跑几何 + 选择):
//   perm     首次进来设备名为空 → 只有「跟随系统默认」+「允许访问麦克风」、不画电平条;点了 → 设备名出现
//   native   页面上没有 DOM <select>
//   meter    电平条 ≥4px 高、可见、在选择行下面;假设备测试音下 aria-valuenow > 0
//   layout   选择行左右边缘 = 本页其它控件左右边缘(±1px);说明一行、不压下一栏
//   keyboard 焦点描边;↓ 打开且高亮当前项;↓ + 回车选中;Esc 关且焦点回到行;点外面关;选中项 aria-checked
//   popover  浮层 / 底部面板整个在窗口里
//   pick     选一台 → 存进 localStorage;电平表按 deviceId exact 重开流
//   record   「测试语音识别」录音走所选设备(deviceId exact)
//   removed  选中的设备从枚举里消失 + devicechange → 回到默认、行内提示、存盘改为 ''
//   release  离开语音输入页 → 所有开过的音轨都 ended
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
const f1 = (n) => (n == null ? 'null' : n.toFixed(1));

async function run({ W, H, theme, full }) {
  const phone = W < 600;
  const tag = `${phone ? 'phone' : 'desktop'}-${W}x${H}-${theme}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, locale: 'zh-CN', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(initScript, { theme });
  // 桌面的设置是独立的设置窗口(desktop-settings-window.ts):直接按那个窗口的 label + URL 打开。
  if (!phone) await page.addInitScript(() => { window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'settings' }, currentWebview: { windowLabel: 'settings', label: 'settings' } }; });
  await page.addInitScript(spyScript);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0${phone ? '' : '&settings=1&category=voice'}`);

  const bbox = async (sel) => page.locator(sel).first().boundingBox();
  const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${tag}-${name}.png` }); };
  const row = page.locator('[data-testid="voice-mic-select"]');
  const menu = page.locator('[data-testid="voice-mic-select-menu"]');
  const optionLoc = () => menu.locator('[data-testid^="voice-mic-select-menu-opt-"]:not([data-testid$="-label"])');
  const openMenu = async () => { await row.click(); await menu.waitFor({ timeout: 3000 }); await page.waitForTimeout(phone ? 450 : 50); };
  const closeMenu = async () => {
    if (!(await menu.isVisible().catch(() => false))) return;
    if (phone) await page.locator('[data-testid="voice-mic-select-menu-cancel"]').click();
    else await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  };
  const optionTexts = async () => { await openMenu(); const t = (await menu.locator('[data-testid$="-label"]').allInnerTexts()).map(s => s.trim()); await closeMenu(); return t; };
  const currentLabel = async () => (await page.locator('[data-testid="voice-mic-select-value"]').innerText()).trim();
  const meterNow = () => page.locator('[data-testid="voice-mic-meter"]').getAttribute('aria-valuenow').then(Number);
  const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(100); } return false; };
  const stored = () => page.evaluate(() => localStorage.getItem('voice_mic_device_v1'));

  try {
    if (phone) {
      await page.getByText('示例-A', { exact: true }).first().waitFor({ timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
      await page.locator('[data-testid="settings-row-voice"]').click();
      await page.locator('[data-testid="settings-subpage-voice"]').waitFor({ timeout: 8000 });
    } else {
      await page.getByRole('button', { name: '设置分类 语音输入' }).click({ timeout: 20000 });
    }
    await page.locator('[data-testid="voice-mic"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);

    ck(`${tag} native: 页面上没有 DOM <select>`, (await page.locator('select').count()) === 0);

    // ── perm ─────────────────────────────────────────────────────────────────
    const before = await optionTexts();
    ck(`${tag} perm: 授权前只有「跟随系统默认」`, before.length === 1 && before[0] === '跟随系统默认', JSON.stringify(before));
    ck(`${tag} perm: 授权前显示「允许访问麦克风」`, await page.locator('[data-testid="voice-mic-allow"]').isVisible());
    ck(`${tag} perm: 授权前不画电平条`, (await page.locator('[data-testid="voice-mic-meter"]').count()) === 0);
    if (full) ck(`${tag} perm: 授权前不开流(不偷偷点亮麦克风)`, (await page.evaluate(() => window.__gum.length)) === 0);
    await shot('before-permission');
    await page.locator('[data-testid="voice-mic-allow"]').click();
    ck(`${tag} perm: 授权后按钮消失`, await waitFor(async () => !(await page.locator('[data-testid="voice-mic-allow"]').isVisible())));
    let opts = [];
    ck(`${tag} perm: 点了 → 设备名出现`, await waitFor(async () => { opts = await optionTexts(); return opts.length > 1; }));
    console.log('options:', JSON.stringify(opts));
    ck(`${tag} perm: 第一项仍是「跟随系统默认」,其余都有名字`, opts[0] === '跟随系统默认' && opts.slice(1).every(o => o.length > 0));
    if (full) ck(`${tag} perm: 授权那次开的流已关掉`, (await page.evaluate(() => window.__tracks[0]?.readyState)) === 'ended');

    // ── meter ────────────────────────────────────────────────────────────────
    let peak = 0;
    ck(`${tag} meter: 假设备测试音下电平 > 0`, await waitFor(async () => { peak = Math.max(peak, await meterNow()); return peak > 0; }), `peak=${peak}`);
    const meter = await bbox('[data-testid="voice-mic-meter"]');
    const sel = await bbox('[data-testid="voice-mic-select"]');
    const fill = await page.locator('[data-testid="voice-mic-meter"] > div').first().evaluate(el => ({ bg: getComputedStyle(el).backgroundColor }));
    const track = await page.locator('[data-testid="voice-mic-meter"]').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, vis: getComputedStyle(el).visibility }));
    ck(`${tag} meter: 电平条 ≥ 4px 高`, meter && meter.height >= 4, `h=${f1(meter?.height)}`);
    ck(`${tag} meter: 电平条 ≥ 120px 宽(不是一根细线)`, meter && meter.width >= 120, `w=${f1(meter?.width)}`);
    ck(`${tag} meter: 电平条在选择行下面`, meter && sel && meter.y >= sel.y + sel.height, `meterY=${f1(meter?.y)} rowBottom=${f1(sel && sel.y + sel.height)}`);
    ck(`${tag} meter: 可见(visibility、底色非透明)`, track.vis === 'visible' && track.bg !== 'rgba(0, 0, 0, 0)' && fill.bg !== 'rgba(0, 0, 0, 0)', `${track.bg} / ${fill.bg}`);
    ck(`${tag} meter: 有麦克风图标`, (await page.locator('[data-testid="voice-mic-level"]').innerText().catch(() => '')) !== null && (await page.locator('[data-testid="voice-mic-level"] > *').count()) >= 2);
    ck(`${tag} meter: 在窗口里`, meter && meter.x >= 0 && meter.x + meter.width <= W && meter.y + meter.height <= H + 2000);
    await shot('settings');

    // ── layout ───────────────────────────────────────────────────────────────
    const hint = phone ? await page.locator('[data-testid="voice-mic"] [data-testid="settings-kit-footer"]').boundingBox() : await bbox('[data-testid="voice-mic-hint"]');
    const nextTop = phone ? (await bbox('[data-testid="voice-test"]'))?.y : (await page.getByText('测试语音识别', { exact: true }).first().boundingBox())?.y;
    if (phone) {
      const refs = [];
      for (const s of ['[data-testid="voice-api-key-row"]', '[data-testid="voice-console-link"]', '[data-testid="voice-test"]']) { const b = await bbox(s); if (b) refs.push(b); }
      console.log(`\n${tag} row x/right: mic ${f1(sel.x)} / ${f1(sel.x + sel.width)}; refs ${refs.map(b => `${f1(b.x)}/${f1(b.x + b.width)}`).join(', ')}`);
      ck(`${tag} layout: 找到 3 个参照行`, refs.length === 3);
      ck(`${tag} layout: 麦克风行左右边缘 = 其它设置行 ±1px`, refs.every(b => Math.abs(b.x - sel.x) <= 1 && Math.abs(b.x + b.width - sel.x - sel.width) <= 1));
      ck(`${tag} layout: 行高 ≥ 48`, sel.height >= 47.5, f1(sel.height));
      const lbl = await bbox('[data-testid="voice-mic-select-label"]');
      const refLbl = await bbox('[data-testid="voice-api-key-row-label"]');
      ck(`${tag} layout: 标签左边缘 = 其它行标签 ±1px`, lbl && refLbl && Math.abs(lbl.x - refLbl.x) <= 1, `${f1(lbl?.x)} vs ${f1(refLbl?.x)}`);
    } else {
      const refs = [];
      // #427 v2:识别模型改成设置积木的单选行(整卡宽的行,不是卡片里的表单控件),不再拿来比;
      // 选择框和 API Key 输入框 / 保存按钮都在卡片内容区(左右 16),仍然要对齐。
      for (const [name, s] of [['API Key 输入框', '[data-testid="voice-api-key"]']]) { const b = await bbox(s); if (b) refs.push({ name, b }); }
      console.log(`\n${tag} control              left    right   height`);
      console.log(`麦克风 选择行          ${f1(sel.x).padStart(7)} ${f1(sel.x + sel.width).padStart(7)} ${f1(sel.height).padStart(6)}`);
      for (const r of refs) console.log(`${r.name.padEnd(18)} ${f1(r.b.x).padStart(7)} ${f1(r.b.x + r.b.width).padStart(7)} ${f1(r.b.height).padStart(6)}`);
      ck(`${tag} layout: 找到参照控件(API Key 输入框)`, refs.length === 1);
      ck(`${tag} layout: 选择行左边缘 = 其它控件 ±1px`, refs.every(r => Math.abs(r.b.x - sel.x) <= 1));
      ck(`${tag} layout: 选择行右边缘 = 其它控件 ±1px`, refs.every(r => Math.abs(r.b.x + r.b.width - sel.x - sel.width) <= 1));
      const save = await bbox('[data-testid="voice-save"]');
      ck(`${tag} layout: 选择行左边缘 = 保存按钮 ±1px`, save && Math.abs(save.x - sel.x) <= 1);
    }
    // 手机 footer 自带 paddingTop 6(settings-kit):一行 = 6 + 18。
    ck(`${tag} layout: 说明一行`, hint && hint.height <= (phone ? 26 : 20), `h=${f1(hint?.height)}`);
    ck(`${tag} layout: 说明在电平条下面`, hint && hint.y >= meter.y + meter.height, `${f1(hint?.y)} vs ${f1(meter.y + meter.height)}`);
    ck(`${tag} layout: 说明不压下一栏(间距 ≥ 8)`, hint && nextTop != null && nextTop - (hint.y + hint.height) >= 8, `gap=${f1(nextTop - (hint.y + hint.height))}`);

    // ── keyboard / popover ──────────────────────────────────────────────────
    if (!phone) {
      await row.focus();
      await page.keyboard.press('Shift'); // 键盘来源的焦点
      const outline = await row.evaluate(el => { const s = getComputedStyle(el); return `${s.outlineStyle} ${s.outlineWidth}`; });
      ck(`${tag} keyboard: 焦点描边可见`, /^solid [12]/.test(outline), outline);
      await shot('focus');
      await page.keyboard.press('ArrowDown');
      ck(`${tag} keyboard: ↓ 打开浮层`, await waitFor(async () => menu.isVisible()));
      const checked = await optionLoc().evaluateAll(els => els.map(e => e.getAttribute('aria-checked')));
      ck(`${tag} keyboard: 当前项 aria-checked(✓)`, checked[0] === 'true' && checked.slice(1).every(c => c === 'false'), JSON.stringify(checked));
      const m = await menu.boundingBox();
      ck(`${tag} popover: 浮层整个在窗口里`, m && m.x >= 0 && m.y >= 0 && m.x + m.width <= W && m.y + m.height <= H, JSON.stringify(m && [f1(m.x), f1(m.y), f1(m.width), f1(m.height)]));
      ck(`${tag} popover: 浮层左边缘 = 选择行 ±1px、在行下面`, m && Math.abs(m.x - sel.x) <= 1 && m.y >= sel.y + sel.height);
      await shot('menu-open');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      ck(`${tag} keyboard: ↓ + 回车选中第二项`, await waitFor(async () => (await currentLabel()) === opts[1]), await currentLabel());
      ck(`${tag} keyboard: 选完浮层关掉`, !(await menu.isVisible().catch(() => false)));
      ck(`${tag} keyboard: 选完焦点回到行上`, await waitFor(async () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'voice-mic-select')));
      await page.keyboard.press('ArrowDown');
      await menu.waitFor({ timeout: 3000 });
      await page.keyboard.press('Escape');
      ck(`${tag} keyboard: Esc 关`, await waitFor(async () => !(await menu.isVisible().catch(() => false))));
      ck(`${tag} keyboard: Esc 后焦点回到行上`, await waitFor(async () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'voice-mic-select')));
      await openMenu();
      await page.mouse.click(W - 10, H - 10);
      ck(`${tag} popover: 点外面关`, await waitFor(async () => !(await menu.isVisible().catch(() => false))));
    } else {
      await openMenu();
      const m = await menu.boundingBox();
      ck(`${tag} popover: 底部面板在窗口里、贴底`, m && m.x >= 0 && m.y >= 0 && m.x + m.width <= W + 0.5 && Math.abs(m.y + m.height - H) <= 1, JSON.stringify(m && [f1(m.x), f1(m.y), f1(m.width), f1(m.height)]));
      const checked = await optionLoc().evaluateAll(els => els.map(e => e.getAttribute('aria-checked')));
      ck(`${tag} sheet: 当前项 aria-checked(✓)`, checked[0] === 'true' && checked.slice(1).every(c => c === 'false'), JSON.stringify(checked));
      const optH = (await optionLoc().first().boundingBox())?.height ?? 0;
      ck(`${tag} sheet: 选项行高 ≥ 48`, optH >= 47.5, f1(optH));
      ck(`${tag} sheet: 有「取消」`, await page.locator('[data-testid="voice-mic-select-menu-cancel"]').isVisible());
      await shot('sheet-open');
      await optionLoc().nth(1).click();
      ck(`${tag} sheet: 点一项选中并关掉`, await waitFor(async () => (await currentLabel()) === opts[1] && !(await menu.isVisible().catch(() => false))), await currentLabel());
      await openMenu();
      await page.mouse.click(W / 2, 40);
      ck(`${tag} sheet: 点遮罩关`, await waitFor(async () => !(await menu.isVisible().catch(() => false))));
    }

    if (full) {
      // ── pick ───────────────────────────────────────────────────────────────
      await openMenu();
      const n = await optionLoc().count();
      const gumBefore = await page.evaluate(() => window.__gum.length);
      await optionLoc().nth(n - 1).click();
      const pick = await stored();
      ck(`${tag} pick: 有真实设备可选(非默认)`, !!pick && (await currentLabel()) === opts[n - 1], `${pick} ${await currentLabel()}`);
      ck(`${tag} pick: 电平表按 deviceId exact 重开流`, await waitFor(async () => (await page.evaluate(() => window.__gum)).slice(gumBefore).some(c => c.audio?.deviceId?.exact === pick)));

      // ── record ─────────────────────────────────────────────────────────────
      const gumRec = await page.evaluate(() => window.__gum.length);
      await page.locator('[data-testid="voice-test"]').click();
      ck(`${tag} record: 「测试语音识别」录音走所选设备`, await waitFor(async () => (await page.evaluate(() => window.__gum)).slice(gumRec).some(c => c.audio?.deviceId?.exact === pick)));
      await page.waitForTimeout(3600); // 等 3 s 录音结束

      // ── removed ────────────────────────────────────────────────────────────
      await page.evaluate((id) => { window.__hide.add(id); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); }, pick);
      ck(`${tag} removed: 提示「已改回跟随系统默认」`, await waitFor(async () => (await page.locator('[data-testid="voice-mic-notice"]').isVisible().catch(() => false))));
      ck(`${tag} removed: 选择回到默认`, (await currentLabel()) === '跟随系统默认');
      ck(`${tag} removed: 存盘改为默认`, (await stored()) === '');
      ck(`${tag} removed: 被拔掉的设备不在列表里`, !(await optionTexts()).includes(opts[n - 1]));
      await shot('removed');

      // ── release ────────────────────────────────────────────────────────────
      await page.getByRole('button', { name: '设置分类 外观' }).click();
      ck(`${tag} release: 离开语音输入页后所有音轨 ended`, await waitFor(async () => page.evaluate(() => window.__tracks.length > 0 && window.__tracks.every(t => t.readyState === 'ended'))), String(await page.evaluate(() => window.__tracks.map(t => t.readyState).join(','))));
    }
  } catch (e) {
    ck(`${tag} driver threw: ${e?.message ?? e}`, false);
  }
  ck(`${tag} no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await run({ W: 1440, H: 900, theme: 'light', full: true });
await run({ W: 1440, H: 900, theme: 'dark', full: false });
await run({ W: 390, H: 844, theme: 'light', full: false });
await run({ W: 390, H: 844, theme: 'dark', full: false });

await browser.close();
web.close();
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('FAILED:', failures.join('; ')); process.exit(1); }
