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
//   settings (#649 类级)设置首页「服务器」行(手机)、账号页、退出确认框(手机)、切换账号面板:有打码值、没有完整主机名
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
const OTHER_FULL = 'other-hub.invalid';
const OTHER_MASKED = 'o****.invalid:9300';
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
    // 两个已保存账号(第二个是另一台 Hub),让「切换账号」面板 / 服务器页「切换服务器」有行可量。
    await page.addInitScript(() => {
      const inner = window.__TAURI_INTERNALS__;
      if (!inner) return;
      const base = inner.invoke;
      const profiles = [
        { profileId: 'p-sweep', serverUrl: 'http://mock-hub.invalid', username: 'tester', displayName: 'tester', networkId: 'net-sweep' },
        { profileId: 'p-other', serverUrl: 'https://other-hub.invalid:9300', username: 'tester2', networkId: 'net-other' },
      ];
      inner.invoke = async (cmd, args) => cmd === 'list_desktop_profiles'
        ? JSON.stringify({ schema_version: 2, active_profile_id: 'p-sweep', profiles })
        : base(cmd, args);
    });
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
    ck(`${tag}: 整页文字里没有完整主机名(含另一个已保存账号的 Hub)`, !body.includes(FULL_HOST) && !body.includes(OTHER_FULL));
    if (!phone) ck(`${tag}: 「切换服务器」列表里另一台 Hub 打码`, body.includes(OTHER_MASKED), '');
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

    // settings(#649 类级):设置首页 / 账号页 / 切换账号面板 / 退出确认框里同样只出现打码值。每一处都必须走到(找不到入口 = FAIL)。
    const openSettingsRoot = async () => {
      for (let i = 0; i < 3; i++) {
        const back = page.locator('[data-testid="settings-back"]').first();
        if (!(await back.isVisible().catch(() => false))) break;
        await back.click(); await page.waitForTimeout(300);
      }
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'agents' }));
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
      await page.locator('[data-testid="settings-phone-list"],[data-testid="settings-pane"]').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
    };
    const shows = async (what) => {
      const t = await page.locator('body').innerText();
      ck(`${tag}: ${what}:有打码地址`, t.includes(MASKED));
      ck(`${tag}: ${what}:没有完整主机名`, !t.includes(FULL_HOST) && !t.includes(OTHER_FULL));
    };
    const visible = (sel) => page.locator(sel).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    await openSettingsRoot();
    if (phone) {
      const serverRow = await text(page, 'settings-row-server');
      ck(`${tag}: 设置列表「服务器」行打码`, !!serverRow && serverRow.includes(MASKED) && !serverRow.includes(FULL_HOST), JSON.stringify(serverRow));
      if (OUT) await page.screenshot({ path: `${OUT}/${tag}-settings.png` });
      // 退出确认框(正文「地址 · 用户名」)只在手机设置首页
      const hasLogout = await visible('[data-testid="settings-logout-block"]');
      ck(`${tag}: 找到「退出登录」`, hasLogout);
      if (hasLogout) {
        await page.locator('[data-testid="settings-logout-block"]').first().click();
        const dlg = await visible('[data-testid="settings-logout-confirm"]');
        ck(`${tag}: 退出确认框打开`, dlg);
        await shows('退出确认框');
        if (OUT) await page.screenshot({ path: `${OUT}/${tag}-settings-logout.png` });
      }
      await openSettingsRoot();
      const acc = await visible('[data-testid="settings-row-account"]');
      ck(`${tag}: 找到「账号」分类`, acc);
      if (acc) { await page.locator('[data-testid="settings-row-account"]').first().click(); await page.waitForTimeout(500); }
    }
    await shows('设置·账号页');
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-settings-account.png` });
    // 切换账号面板(每行「账号 @ 服务器」)
    await openSettingsRoot();
    if (!phone) {
      const acc = page.locator('[data-testid="settings-row-account"]').first();
      if (await acc.isVisible().catch(() => false)) { await acc.click(); await page.waitForTimeout(300); }
    }
    const swSel = phone ? '[data-testid="settings-switch-account-block"]' : '[data-testid="settings-switch-account-row"]';
    const hasSwitch = await visible(swSel);
    ck(`${tag}: 找到「切换账号」`, hasSwitch);
    if (hasSwitch) {
      await page.locator(swSel).first().click();
      const sheet = await visible(phone ? '[data-testid="account-switch-sheet"]' : '[data-testid="account-switch-dialog"]');
      ck(`${tag}: 切换账号面板打开`, sheet);
      const sheetText = await page.locator(phone ? '[data-testid="account-switch-sheet"]' : '[data-testid="account-switch-dialog"]').first().innerText().catch(() => '');
      ck(`${tag}: 切换账号面板里「账号 @ 服务器」打码`, sheetText.includes(`@ ${MASKED}`) && sheetText.includes(`@ ${OTHER_MASKED}`) && !sheetText.includes(FULL_HOST) && !sheetText.includes(OTHER_FULL), JSON.stringify(sheetText.slice(0, 120)));
      if (OUT) await page.screenshot({ path: `${OUT}/${tag}-settings-switch.png` });
    }

    ck(`${tag}: 没有页面错误`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

await browser.close();
web.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
