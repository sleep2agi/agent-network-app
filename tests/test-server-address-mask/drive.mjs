// 服务器页 Hub 地址打码(看板 #649)—— 真应用(expo web 导出 + Tauri 桥桩)里量真框、点真按钮。
// Hub 是页内假数据(harness 的 http://mock-hub.invalid),不起 hub 进程、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-server-address-mask/drive.mjs
//
// 布局:桌面 1200×850(桌面工作区,带服务器侧栏)与窄屏 390×844(安卓 UA),浅色 / 深色各一遍。
// 检查:
//   mask    默认:地址行、标题下副标题、桌面侧栏都显示 m****.invalid;整页文字里没有完整主机名
//   eye     眼睛按钮在地址行内、在值的右边、在复制图标左边;图标颜色 = 主题 accent
//   reveal  点眼睛 → 地址行和副标题显示完整 mock-hub.invalid;侧栏仍打码
//   copy    展开前点地址行 → 剪贴板里是完整 http://mock-hub.invalid(不是打码值)
//   leave   离开服务器页再回来 → 回到打码
//   fit     窄屏:地址行右边缘不超出视口、文档没有横向滚动
// 任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const FULL_HOST = 'mock-hub.invalid';
const FULL_URL = `http://${FULL_HOST}`;
const MASKED = 'm****.invalid';
const ACCENT = { light: 'rgb(27, 101, 219)', dark: 'rgb(94, 155, 255)' };

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

const text = (page, id) => page.locator(`[data-testid="${id}"]`).first().innerText({ timeout: 5000 }).catch(() => null);
const box = (page, sel) => page.locator(sel).first().boundingBox({ timeout: 5000 }).catch(() => null);

for (const layout of ['desktop', 'phone']) {
  for (const theme of ['light', 'dark']) {
    const tag = `${layout}-${theme}`;
    const phone = layout === 'phone';
    const ctx = await browser.newContext({
      viewport: phone ? { width: 390, height: 844 } : { width: 1200, height: 850 },
      deviceScaleFactor: 1,
      colorScheme: theme,
      locale: TEST_LOCALE,
      ...(phone ? { userAgent: ANDROID_UA } : {}),
    });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(initScript, { theme });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
    await page.locator('[data-testid="server-connection"]').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="server-connection"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // mask
    const addr = await text(page, 'server-address');
    ck(`${tag}: 地址行默认打码`, addr === MASKED, JSON.stringify(addr));
    const sub = await text(page, 'server-subtitle');
    ck(`${tag}: 副标题默认打码`, sub === MASKED, JSON.stringify(sub));
    if (!phone) {
      const side = await text(page, 'server-sidebar-host');
      ck(`${tag}: 桌面侧栏打码`, side === MASKED, JSON.stringify(side));
    }
    const body = await page.locator('body').innerText();
    ck(`${tag}: 整页文字里没有完整主机名`, !body.includes(FULL_HOST));
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-masked.png` });

    // eye geometry + colour
    const rowSel = '[data-testid="server-connection"] [aria-label="复制地址"]';
    const row = await box(page, rowSel);
    const val = await box(page, '[data-testid="server-address"]');
    const eye = await box(page, '[data-testid="server-address-reveal"]');
    ck(`${tag}: 眼睛按钮存在`, !!eye);
    ck(`${tag}: 眼睛在地址行内`, !!(row && eye) && eye.y >= row.y - 1 && eye.y + eye.height <= row.y + row.height + 1 && eye.x + eye.width <= row.x + row.width + 1, JSON.stringify({ row, eye }));
    ck(`${tag}: 眼睛在值的右边`, !!(val && eye) && eye.x >= val.x + val.width - 1, JSON.stringify({ val, eye }));
    ck(`${tag}: 眼睛与地址值垂直居中对齐(±2px)`, !!(val && eye) && Math.abs((eye.y + eye.height / 2) - (val.y + val.height / 2)) <= 2, JSON.stringify({ val, eye }));
    const eyeColor = await page.locator('[data-testid="server-address-reveal"]').first().evaluate(el => {
      const all = [el, ...el.querySelectorAll('*')].map(n => getComputedStyle(n).color);
      return all;
    }).catch(() => []);
    ck(`${tag}: 眼睛图标 = 主题 accent`, eyeColor.includes(ACCENT[theme]), JSON.stringify(eyeColor));
    if (phone) {
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
      ck(`${tag}: 没有横向滚动`, w.doc <= w.vw, JSON.stringify(w));
      ck(`${tag}: 地址行右边缘在视口内`, !!row && row.x + row.width <= 390 + 0.5, JSON.stringify(row));
    }

    // copy (masked state) → full value
    await page.locator(rowSel).first().click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(e => `ERR ${e}`);
    ck(`${tag}: 打码状态下复制的是完整地址`, clip === FULL_URL, JSON.stringify(clip));
    const stillMasked = await text(page, 'server-address');
    ck(`${tag}: 点行复制不会展开`, stillMasked === MASKED, JSON.stringify(stillMasked));

    // reveal
    await page.locator('[data-testid="server-address-reveal"]').first().click();
    await page.waitForTimeout(200);
    const shown = await text(page, 'server-address');
    ck(`${tag}: 点眼睛后地址行显示完整值`, shown === FULL_HOST, JSON.stringify(shown));
    const subShown = await text(page, 'server-subtitle');
    ck(`${tag}: 点眼睛后副标题显示完整值`, subShown === FULL_HOST, JSON.stringify(subShown));
    const label = await page.locator('[data-testid="server-address-reveal"]').first().getAttribute('aria-label');
    ck(`${tag}: 展开后按钮读作「隐藏地址」`, label === '隐藏地址', String(label));
    if (!phone) {
      const side = await text(page, 'server-sidebar-host');
      ck(`${tag}: 展开后侧栏仍打码`, side === MASKED, JSON.stringify(side));
    }
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-revealed.png` });

    // leave + come back
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'server' }));
    await page.locator('[data-testid="server-connection"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    const back = await text(page, 'server-address');
    ck(`${tag}: 离开再回来回到打码`, back === MASKED, JSON.stringify(back));

    ck(`${tag}: 没有页面错误`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

await browser.close();
web.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
