// 聊天输入框的画出来的尺寸 —— flex:0 清扫(flex-zero-rule.test.ts)把 ChatScreen / DmChatScreen 的 inputInWrap
// 从 flex:0 改成 flex:-1。web 上 flex:0 = `0 1 0%`(列表标题就是这样 0 宽的,#581),所以量一遍输入框在各个宽度下
// 是不是真的有宽有高,不看 textContent / value。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-composer-input-size/drive.mjs
//
// Agent 会话(chat)与人与人私信(dm),键盘模式:
//   手机 320 / 360 / 390 / 430,折叠屏 / 平板 700 / 1000 / 1280(安卓 UA),桌面 1000 / 1320(桌面有自己的输入区,一并量)
//   width  : 输入框画出来的宽 ≥ 120px,且占视口宽的 ≥ 25%(手机)
//   height : 空 ≥ 30px(桌面输入区 ≥ 18px);打 4 行后比空的高(私信与 agent 会话同样长高);打 20 行后封顶(手机 / 平板 maxHeight 120+1;桌面输入区 ≤ 半屏)
//   no-x   : 没有横向页面滚动
// Exit 1 when any check fails or a screen could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const rows = [];
let failures = 0;
const r1 = (n) => Math.round(n * 10) / 10;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
// The composer's text field: the visible textarea (the only multiline input on a chat screen).
const field = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('textarea')].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { w: b.width, h: b.height };
});

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const VIEWPORTS = [
  ...[320, 360, 390, 430].map(w => ({ w, h: 844, kind: 'phone' })),
  ...[700, 1000, 1280].map(w => ({ w, h: 800, kind: 'tablet' })),
  { w: 1000, h: 700, kind: 'desktop' }, { w: 1320, h: 754, kind: 'desktop' },
];
const SCREENS = [
  { name: 'chat', screen: { name: 'chat', alias: '示例-A' } },
  { name: 'dm', screen: { name: 'dm', alias: 'peer-demo', userId: 'u_peer_demo', displayName: '示例同事' } },
];
for (const v of VIEWPORTS) for (const sc of SCREENS) {
  const vp = `${v.kind} ${v.w}x${v.h} ${sc.name}`;
  const touch = v.kind !== 'desktop';
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'light', deviceScaleFactor: 1, locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(() => { try { localStorage.setItem('voice_composer_input_mode_v1', 'keyboard'); } catch { /* default mode */ } });
  await page.addInitScript(initScript, { theme: 'light' });
  let empty;
  try {
    await page.goto(`${url}?safeAreaSim=0,0,0,0`);  // the sim flag also exposes __anetLayoutSweep on desktop
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate((s) => window.__anetLayoutSweep.setScreen(s), sc.screen);
    await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(e => e.getClientRects().length), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    empty = await field(page);
  } catch (e) {
    record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] });
    await ctx.close();
    continue;
  }
  const ta = page.locator('textarea').filter({ visible: true }).first();
  await ta.click();
  await ta.fill('第一行\n第二行\n第三行\n第四行');
  await page.waitForTimeout(300);
  const four = await field(page);
  await ta.fill(Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行`).join('\n'));
  await page.waitForTimeout(300);
  const twenty = await field(page);
  if (OUT) await page.screenshot({ path: join(OUT, `${v.kind}-${v.w}-${sc.name}.png`) });
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  record(vp, 'composer', {
    width: !!empty && empty.w >= 120 && (v.kind !== 'phone' || empty.w >= v.w * 0.25),
    height: !!empty && empty.h >= (v.kind === 'desktop' ? 18 : 30),
    // 手机 / 平板的私信输入框在 web 上是 web 专用的固定一行高(DmChatScreen 那一行的 height),本来就不长 —— 与 flex 无关、修前修后一样。
    grows: !!four && !!empty && four.h > empty.h,
    // 桌面输入区有自己的上限(可拖高的 composerHeight / 私信 6 行),不是手机输入框的 maxHeight 120:只要求封顶在半屏内。
    capped: !!twenty && twenty.h >= four.h && twenty.h <= (v.kind === 'desktop' ? v.h / 2 : 121),
    noOverflow: overflow <= 0,
  }, { empty: empty && `${r1(empty.w)}x${r1(empty.h)}`, four: four && r1(four.h), twenty: twenty && r1(twenty.h) });
  await ctx.close();
}
await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
if (failures) process.exit(1);
