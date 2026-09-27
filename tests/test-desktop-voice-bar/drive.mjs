// 桌面语音录音条(src/desktop-voice-bar-model.ts)—— 真应用(expo web 导出 + Tauri 桥桩)里点真按钮、量真框。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据(示例-A …),
// 不起 hub 进程、不占端口、不碰 HOME。麦克风 = Chromium 假设备;识别 = 桩(发往 https://mock-asr.invalid 的
// plugin:http 请求在页内直接回 { result: { text } },并计数)。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-desktop-voice-bar/drive.mjs
//
// 1200×800 桌面工作区。检查:
//   overlay  点 🎤 → 没有任何手机浮层 / 遮罩 / 手势提示(voice-overlay、「上滑」「松开」文字都不在)
//   layout   录音条在输入框的盒子里;红点 / 电平 / 计时 / 提示 / 取消 / 完成 中线差 ≤1px;条与原工具栏同高 ±1px,
//            换上来输入框不跳(输入框盒子高度不变)
//   done     「明天|去公司开会」点 🎤 说「上午」点 完成 → 插到光标处、光标 4、焦点在输入框
//   cancel   点 取消 → 草稿不变、0 次识别
//   toggle   再点 🎤 = 完成
//   keys     Enter = 完成(不发送);Esc = 取消
//   short    立刻点完成 → 提示「录音太短,没有识别」(不是手机的「说话时间太短」)
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

const asrScript = () => {
  window.__asr = { calls: 0, next: '' };
  const inner = window.__TAURI_INTERNALS__;
  const invoke = inner.invoke;
  const mine = new Map(); let rid = 1e6;
  inner.invoke = async (cmd, args) => {
    if (cmd === 'load_voice_credentials') return JSON.stringify({ appId: '', accessToken: 'placeholder-api-key-0000', endpoint: 'https://mock-asr.invalid/flash' });
    if (cmd === 'plugin:http|fetch' && String(args?.clientConfig?.url ?? '').startsWith('https://mock-asr.invalid')) {
      const id = ++rid; mine.set(id, { req: true }); window.__asr.calls++; return id;
    }
    if (cmd === 'plugin:http|fetch_send' && mine.has(args?.rid)) {
      const id = ++rid;
      mine.set(id, { buf: new TextEncoder().encode(JSON.stringify({ result: { text: window.__asr.next } })), sent: false });
      return { status: 200, statusText: 'OK', url: 'https://mock-asr.invalid/flash', headers: [['content-type', 'application/json'], ['x-api-status-code', '20000000']], rid: id };
    }
    if (cmd === 'plugin:http|fetch_read_body' && mine.has(args?.rid)) {
      const b = mine.get(args.rid);
      if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
      return [1];
    }
    return invoke(cmd, args);
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
await page.addInitScript(initScript, { theme: 'light' });
await page.addInitScript(asrScript);
await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };

try {
  await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
  const input = page.locator('textarea[placeholder^="Message 示例-A"]').first();
  await input.waitFor({ timeout: 10000 });
  const mic = page.locator('[data-testid="voice-mic"]');
  await mic.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const composer = input.locator('xpath=..');
  const state = () => input.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement }));
  const caretTo = async (i) => { await input.click(); await input.evaluate((el, a) => el.setSelectionRange(a, a), i); await page.waitForTimeout(100); };
  const say = (text) => page.evaluate(t => { window.__asr.next = t; }, text);
  const calls = () => page.evaluate(() => window.__asr.calls);
  const bar = page.locator('[data-testid="voice-bar"]');
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  const toolbarBox = await page.locator('[data-testid="composer-desktop-plus"]').locator('xpath=..').boundingBox();
  const composerBefore = await composer.boundingBox();
  const inputBefore = await input.boundingBox();
  await shot('0-idle');

  // ── overlay + layout + done ──
  await input.fill('明天去公司开会');
  await caretTo(2);
  await say('上午');
  let c0 = await calls();
  await mic.click();
  await bar.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1300);
  ck('overlay: 没有手机浮层(voice-overlay)', (await page.locator('[data-testid="voice-overlay"]').count()) === 0);
  const fullPane = await page.evaluate(() => [...document.querySelectorAll('div')].filter(d => {
    const r = d.getBoundingClientRect(); const cs = getComputedStyle(d);
    return (cs.position === 'absolute' || cs.position === 'fixed') && r.width > 500 && r.height > 300 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && /rgba\(0, 0, 0, 0\.\d+\)/.test(cs.backgroundColor);
  }).length);
  ck('overlay: 没有半透明遮罩盖住聊天区', fullPane === 0, String(fullPane));
  const bodyText = await page.evaluate(() => document.body.innerText);
  ck('overlay: 页面上没有手机手势提示(上滑 / 松开 / 请说话)', !/上滑|松开|请说话/.test(bodyText));
  ck('layout: 工具栏换成录音条(＋ / 发送 不在)', (await page.locator('[data-testid="composer-desktop-plus"]').count()) === 0 && await bar.isVisible());
  const cb = await composer.boundingBox();
  const bb = await bar.boundingBox();
  ck('layout: 录音条在输入框盒子里', bb.x >= cb.x - 0.5 && bb.x + bb.width <= cb.x + cb.width + 0.5 && bb.y >= cb.y - 0.5 && bb.y + bb.height <= cb.y + cb.height + 0.5, `bar=${JSON.stringify(bb)} composer=${JSON.stringify(cb)}`);
  ck('layout: 输入框盒子高度不变、输入区不跳', Math.abs(cb.height - composerBefore.height) <= 1 && Math.abs((await input.boundingBox()).height - inputBefore.height) <= 1, `${composerBefore.height}→${cb.height}`);
  ck('layout: 录音条与原工具栏同高 ±1px、同一底边', Math.abs(bb.height - toolbarBox.height) <= 1 && Math.abs((bb.y + bb.height) - (toolbarBox.y + toolbarBox.height)) <= 1, `bar h=${bb.height} toolbar h=${toolbarBox.height}`);
  const parts = ['voice-bar-dot', 'voice-bar-level', 'voice-bar-elapsed', 'voice-bar-hint', 'voice-bar-cancel', 'voice-bar-done'];
  const mids = {};
  for (const id of parts) { const b = await page.locator(`[data-testid="${id}"]`).boundingBox(); mids[id] = { x: b.x, w: b.width, mid: b.y + b.height / 2 }; }
  const midVals = Object.values(mids).map(m => m.mid);
  const spread = Math.max(...midVals) - Math.min(...midVals);
  console.log('\n| part | x | width | centre y |');
  console.log('|---|---:|---:|---:|');
  for (const [id, m] of Object.entries(mids)) console.log(`| ${id} | ${m.x.toFixed(1)} | ${m.w.toFixed(1)} | ${m.mid.toFixed(2)} |`);
  console.log(`| composer box | ${cb.x.toFixed(1)} | ${cb.width.toFixed(1)} | y ${cb.y.toFixed(1)}–${(cb.y + cb.height).toFixed(1)} |`);
  console.log(`| bar | ${bb.x.toFixed(1)} | ${bb.width.toFixed(1)} | y ${bb.y.toFixed(1)}–${(bb.y + bb.height).toFixed(1)} |\n`);
  ck('layout: 红点 / 电平 / 计时 / 提示 / 取消 / 完成 同一中线 ≤1px', spread <= 1, `spread=${spread.toFixed(2)}`);
  ck('layout: 完成在最右、取消在它左边', mids['voice-bar-done'].x > mids['voice-bar-cancel'].x && mids['voice-bar-cancel'].x > mids['voice-bar-hint'].x);
  ck('layout: 右边缘与原发送按钮右边缘对齐 ±1px', Math.abs((mids['voice-bar-done'].x + mids['voice-bar-done'].w) - (toolbarBox.x + toolbarBox.width)) <= 1);
  const elapsed = await page.locator('[data-testid="voice-bar-elapsed"]').innerText();
  ck('recording: 计时在走', /^00:0[1-9]$/.test(elapsed), elapsed);
  ck('recording: 提示「正在录音 · Enter 完成 · Esc 取消」', (await page.locator('[data-testid="voice-bar-hint"]').innerText()) === '正在录音 · Enter 完成 · Esc 取消');
  ck('recording: 录音中输入框焦点不丢、没被改', JSON.stringify(await state()) === JSON.stringify({ value: '明天去公司开会', start: 2, end: 2, focused: true }));
  await shot('1-recording-bar');
  if (OUT) await page.screenshot({ path: `${OUT}/1-recording-bar-composer-crop.png`, clip: { x: cb.x - 8, y: cb.y - 8, width: cb.width + 16, height: cb.height + 16 } });
  await page.locator('[data-testid="voice-bar-done"]').click();
  await settle();
  let s = await state();
  ck('done: 完成 → 插到光标处', s.value === '明天上午去公司开会', s.value);
  ck('done: 光标在插入文字之后(4)、焦点在输入框', s.start === 4 && s.end === 4 && s.focused, `${s.start} focused=${s.focused}`);
  ck('done: 识别 1 次、工具栏回来了', (await calls()) - c0 === 1 && (await page.locator('[data-testid="composer-desktop-plus"]').count()) === 1);
  await shot('2-after-done');

  // ── cancel ──
  await input.fill('明天去公司开会');
  await caretTo(2);
  await say('不该出现');
  c0 = await calls();
  await mic.click();
  await bar.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="voice-bar-cancel"]').click();
  await settle();
  s = await state();
  ck('cancel: 取消 → 草稿不变、0 次识别', s.value === '明天去公司开会' && (await calls()) === c0, `${s.value} +${(await calls()) - c0}`);

  // ── toggle:再点 🎤(录音条里没有 🎤;工具栏换走了)→ 用快捷方式确认 🎤 只在空闲时出现 ──
  ck('toggle: 录音结束后 🎤 回到工具栏', await mic.isVisible());

  // ── keys ──
  await input.fill('hello world');
  await caretTo(5);
  await say('big');
  c0 = await calls();
  await mic.click();
  await bar.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await settle();
  s = await state();
  ck('keys: Enter = 完成(插入,不发送)', s.value === 'hello big world' && (await calls()) - c0 === 1, JSON.stringify(s.value));
  await input.fill('明天去公司开会');
  await caretTo(2);
  c0 = await calls();
  await mic.click();
  await bar.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await settle();
  s = await state();
  ck('keys: Esc = 取消', s.value === '明天去公司开会' && (await calls()) === c0);

  // ── short ──
  c0 = await calls();
  await mic.click();
  await bar.waitFor({ timeout: 5000 });
  await page.waitForTimeout(150);
  await page.locator('[data-testid="voice-bar-done"]').click();
  await settle();
  const shortText = await page.evaluate(() => document.body.innerText);
  ck('short: 太短的提示是桌面说法「录音太短,没有识别」,不是「说话时间太短」', shortText.includes('录音太短,没有识别') && !shortText.includes('说话时间太短'));
  ck('short: 没有识别请求', (await calls()) === c0);
  await shot('3-too-short');
} catch (e) {
  ck(`driver threw: ${String(e?.message ?? e).split('\n')[0]}`, false);
}
ck('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
web.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
