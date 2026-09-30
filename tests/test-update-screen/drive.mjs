// 更新页(安卓全屏「新版本」页 + 桌面卡片)的截图与几何量。owner 2026-09-30「更新的窗口太丑了,
// 这是每次都要发社交媒体的……最好是能够全屏去看」。真应用的 web 导出 + UpdatePromptFixtureScreen
// 夹具(不起 hub、不占端口、不碰 HOME)。
//
//   WEB_DIR=<expo web 导出目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-update-screen/drive.mjs
//
// 手机(390×844、360×800;模拟 Android 安全区 顶 32 / 底 24)× 浅 / 深 × 有新版本 / 下载中 44% / 下载失败,
// 外加「落后三版」的多版本分组;桌面 1280×800 浅 / 深 × 有新版本 / 下载中,另量最小窗 720×520。
// 断言:
//   phone  (a) 主按钮 / 进度条整块在屏内、在底部安全区之上
//          (b) 左右 16px 边距:说明卡片、底部按钮
//          (c) 说明没有被截断:每条的文字高度 ≤ 它的盒子;说明区能滚到最后一条,最后一条整条在底栏之上
//          (d) 没有英文标题「What's new」、没有行首「- 」;只出现比已装版本新的版本
//          (e) ✕(稍后)在左上角、在状态栏带之下;下载中不显示 ✕
//   desktop 卡片居中 ±1px、整块在窗口内;按钮在卡片内;说明区在卡片内滚动
// 任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync } from 'node:fs';
import { serveExport, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const r1 = (n) => Math.round(n * 10) / 10;

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });
const errors = [];
const INSET = { top: 32, bottom: 24 };

const open = async ({ platform, state, theme, viewport, current, phone }) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 3 : 2, ...(phone ? { userAgent: ANDROID_UA, isMobile: false } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${platform}/${state}/${theme}: ${e}`));
  const sim = phone ? `&safeAreaSim=${INSET.top},0,${INSET.bottom},0` : '&safeAreaSim=0,0,0,0';
  await page.goto(`${web.url}?fixture=update-prompt&platform=${platform}&state=${state}&theme=${theme}${current ? `&current=${current}` : ''}${sim}`);
  return { page, ctx };
};
const box = (page, id) => page.locator(`[data-testid="${id}"]`).last().boundingBox();

const phoneCase = async ({ vp, theme, state, current, tag }) => {
  const { page, ctx } = await open({ platform: 'android', state, theme, viewport: vp, current, phone: true });
  const name = `phone ${vp.width}×${vp.height} ${theme} ${tag}`;
  try {
    await page.locator('[data-testid="android-update-prompt"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600); // slide-in animation
    const promptBox = await box(page, 'android-update-prompt');
    ck(`${name}: full-screen page (covers the window)`, !!promptBox && Math.abs(promptBox.width - vp.width) <= 1 && Math.abs(promptBox.height - vp.height) <= 1, promptBox && `${r1(promptBox.width)}×${r1(promptBox.height)}`);

    // (a) primary / progress fully visible above the bottom inset
    const primaryId = state === 'downloading' ? 'android-update-progress' : state === 'error' ? 'android-update-retry' : 'android-update-download';
    const b = await box(page, primaryId);
    ck(`${name}: ${primaryId} fully on screen, above the bottom safe area`, !!b && b.y >= 0 && b.y + b.height <= vp.height - INSET.bottom + 0.5, b && `y=${r1(b.y)}..${r1(b.y + b.height)} limit ${vp.height - INSET.bottom}`);
    // (b) 16px gutters
    ck(`${name}: button 16px gutters`, !!b && Math.abs(b.x - 16) <= 1 && Math.abs(vp.width - (b.x + b.width) - 16) <= 1, b && `left=${r1(b.x)} right=${r1(vp.width - b.x - b.width)}`);
    const g = await box(page, 'update-notes-group-0');
    ck(`${name}: notes card 16px gutters`, !!g && Math.abs(g.x - 16) <= 1 && Math.abs(vp.width - (g.x + g.width) - 16) <= 1, g && `left=${r1(g.x)} right=${r1(vp.width - g.x - g.width)}`);
    // (e) ✕ top-left, below the status bar band; hidden while downloading
    const close = (await page.locator('[data-testid="android-update-later"]').count()) ? await box(page, 'android-update-later') : null;
    if (state === 'downloading') ck(`${name}: no ✕ while downloading`, !close);
    else ck(`${name}: ✕ top-left, below the status bar`, !!close && close.x < 40 && close.y >= INSET.top - 0.5 && close.y < INSET.top + 20, close && `x=${r1(close.x)} y=${r1(close.y)}`);
    if (state === 'downloading') {
      const txt = await page.locator('[data-testid="android-update-progress"]').last().innerText();
      ck(`${name}: progress shows % and MB`, /44%/.test(txt) && /MB/.test(txt), JSON.stringify(txt));
      const browserLink = await box(page, 'android-update-browser');
      ck(`${name}: 在浏览器中下载 is a small text link (≤ 24px tall), not a button`, !!browserLink && browserLink.height <= 24, browserLink && `h=${r1(browserLink.height)}`);
    }

    // (d) content: no raw markdown / English heading; only versions newer than installed
    const text = await page.locator('[data-testid="android-update-prompt"]').last().innerText();
    ck(`${name}: no "What's new" / leading "- "`, !/What's new/i.test(text) && !/^\s*- /m.test(text));
    const titles = await page.locator('[data-testid^="update-notes-group-"]').evaluateAll(els => els.map(e => e.innerText.split('\n')[0]));
    const want = current === '0.2.153' ? ['v0.2.157 更新内容', 'v0.2.156 更新内容', 'v0.2.155 更新内容', 'v0.2.154 更新内容'] : ['v0.2.157 更新内容'];
    ck(`${name}: groups = versions newer than installed, newest first`, JSON.stringify(titles) === JSON.stringify(want), JSON.stringify(titles));

    if (OUT) await page.screenshot({ path: `${OUT}/phone-${vp.width}x${vp.height}-${theme}-${tag}.png` });

    // (c) no truncation: each item's text fits its box; scrolling reaches the last item above the footer
    const clipped = await page.locator('[data-testid="update-note-item"]').evaluateAll(els => els.map(e => {
      const t = e.lastElementChild; return t ? { sh: t.scrollHeight, ch: t.clientHeight, ell: getComputedStyle(t).textOverflow } : null;
    }).filter(x => x && (x.sh > x.ch + 1 || x.ell === 'ellipsis')));
    ck(`${name}: no note item is clipped / ellipsised`, clipped.length === 0, JSON.stringify(clipped.slice(0, 3)));
    const scroller = page.locator('[data-testid="android-update-notes"]').last();
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(200);
    const items = page.locator('[data-testid="update-note-item"]');
    const last = await items.nth((await items.count()) - 1).boundingBox();
    const footer = await box(page, 'android-update-footer');
    ck(`${name}: scrolled to the end, the last item is fully above the footer`, !!last && !!footer && last.y + last.height <= footer.y + 0.5 && last.y >= 0, last && footer && `last ends ${r1(last.y + last.height)} footer ${r1(footer.y)}`);
    if (OUT && tag === 'available' && vp.width === 390) await page.screenshot({ path: `${OUT}/phone-${vp.width}x${vp.height}-${theme}-${tag}-scrolled.png` });
    console.log(`  ${name}: button ${b && `${r1(b.x)},${r1(b.y)} ${r1(b.width)}×${r1(b.height)}`}  card ${g && `${r1(g.x)}..${r1(g.x + g.width)}`}  footer.y ${footer && r1(footer.y)}`);
  } catch (e) {
    ck(`${name}: ran`, false, e?.message || String(e));
  }
  await ctx.close();
};

const desktopCase = async ({ vp, theme, state, current, tag }) => {
  const { page, ctx } = await open({ platform: 'desktop', state, theme, viewport: vp, current });
  const name = `desktop ${vp.width}×${vp.height} ${theme} ${tag}`;
  try {
    await page.locator('[data-testid="desktop-update-card"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const c = await box(page, 'desktop-update-card');
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
    ck(`${name}: card centred ±1px`, Math.abs(cx - vp.width / 2) <= 1 && Math.abs(cy - vp.height / 2) <= 1, `Δx=${r1(cx - vp.width / 2)} Δy=${r1(cy - vp.height / 2)}`);
    ck(`${name}: card inside the window`, c.x >= 0 && c.y >= 0 && c.x + c.width <= vp.width && c.y + c.height <= vp.height);
    const bid = state === 'downloading' ? 'desktop-update-progress' : 'desktop-update-install';
    const b = await box(page, bid);
    ck(`${name}: ${bid} inside the card`, !!b && b.y >= c.y && b.y + b.height <= c.y + c.height && b.x + b.width <= c.x + c.width, b && `y=${r1(b.y)}..${r1(b.y + b.height)} card ${r1(c.y)}..${r1(c.y + c.height)}`);
    const text = await page.locator('[data-testid="desktop-update-card"]').last().innerText();
    ck(`${name}: no "What's new" / leading "- "`, !/What's new/i.test(text) && !/^\s*- /m.test(text));
    ck(`${name}: notes rendered (still there while downloading)`, (await page.locator('[data-testid="update-note-item"]').count()) > 0);
    if (state === 'downloading') ck(`${name}: progress shows % and MB`, /44%/.test(text) && /MB/.test(text));
    const clipped = await page.locator('[data-testid="update-note-item"]').evaluateAll(els => els.filter(e => { const t = e.lastElementChild; return t && t.scrollHeight > t.clientHeight + 1; }).length);
    ck(`${name}: no note item is clipped`, clipped === 0);
    const footerCut = await page.locator('[data-testid="desktop-update-footer"]').last().evaluate(f => [...f.querySelectorAll('div')].filter(d => d.children.length === 0 && d.scrollWidth > d.clientWidth + 1).map(d => d.textContent));
    ck(`${name}: footer text not cut off (no ellipsis)`, footerCut.length === 0, JSON.stringify(footerCut));
    if (OUT) await page.screenshot({ path: `${OUT}/desktop-${vp.width}x${vp.height}-${theme}-${tag}.png` });
    console.log(`  ${name}: card ${r1(c.x)},${r1(c.y)} ${r1(c.width)}×${r1(c.height)}  button ${b && `${r1(b.x)},${r1(b.y)} ${r1(b.width)}×${r1(b.height)}`}`);
  } catch (e) {
    ck(`${name}: ran`, false, e?.message || String(e));
  }
  await ctx.close();
};

try {
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    for (const theme of ['light', 'dark']) {
      for (const state of ['available', 'downloading', 'error']) await phoneCase({ vp, theme, state, tag: state });
      await phoneCase({ vp, theme, state: 'available', current: '0.2.153', tag: 'multi-version' });
    }
  }
  for (const theme of ['light', 'dark']) {
    for (const state of ['available', 'downloading']) await desktopCase({ vp: { width: 1280, height: 800 }, theme, state, tag: state });
    await desktopCase({ vp: { width: 1280, height: 800 }, theme, state: 'available', current: '0.2.153', tag: 'multi-version' });
  }
  await desktopCase({ vp: { width: 720, height: 520 }, theme: 'light', state: 'available', current: '0.2.153', tag: 'min-window' });
} catch (e) {
  failures.push(`threw: ${e?.message || e}`);
  console.log(`FAIL: threw ${e?.stack || e}`);
}
if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
await browser.close();
web.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length || errors.length || pass === 0) process.exit(1);
