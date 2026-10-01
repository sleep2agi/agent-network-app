// #431「连接较慢 · 数据可能稍有延迟」:切到后台时还在路上的读,回来才读完 —— 墙钟耗时把后台时间算进去,
// 不该凑成「连续 3 次慢读」。以及真的慢时,提示条第二行写出最近几次读(接口 · 耗时 · 大小)。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process,
// no port, no HOME touched). The link is degraded through the stub (window.__stubDelayMs); the app decides the state.
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-slow-read-suspend/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   suspend   Agent 页回到前台(每个轮询立刻跑一轮,一批读同时发出)→ 每个读晚 7 s 才回 → 马上又切到后台(document 隐藏 = RN-web 的 AppState
//             background)→ 后台里这批读读完 → 回到前台(读改成晚 2.5 s,不算慢)⇒ 回来后的 2 s 里不出「连接较慢」
//   real      前台里每个读都晚 6.5 s ⇒ 出「连接较慢」,点按 / 悬停的提示条第二行写出接口名和秒数
// Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const setVisible = (page, visible) => page.evaluate((v) => {
  window.__vis = v ? 'visible' : 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}, visible);
const visibilityShim = () => {
  // 数一数切走时有几个读在路上(Tauri http 插件桩的 fetch 调用)。
  const hook = () => { const inner = window.__TAURI_INTERNALS__; if (!inner) return setTimeout(hook, 10); const inv = inner.invoke; inner.invoke = async (cmd, args) => { if (cmd === 'plugin:http|fetch' && (args?.clientConfig?.method || 'GET') === 'GET') window.__reads = (window.__reads || 0) + 1; return inv(cmd, args); }; };
  hook();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis || 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => (window.__vis || 'visible') === 'hidden' });
};

const VIEWPORTS = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const slowNow = async () => (await page.locator(tid('connectivity-indicator-slow')).count()) > 0;
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(visibilityShim);
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.locator(tid('agents-list-head')).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(2500);
      const onlineFirst = !(await slowNow());

      // ── suspend ──
      // 回到前台那一下每个轮询都立刻跑一轮(usePoll):一批读同时发出,每个晚 7 s 才回;马上又切走。
      await page.evaluate(() => { window.__stubDelayMs = 7000; window.__reads = 0; });
      await setVisible(page, false);
      await page.waitForTimeout(100);
      await setVisible(page, true);
      await page.waitForTimeout(150);
      await setVisible(page, false);
      const inFlight = await page.evaluate(() => window.__reads);
      await page.waitForTimeout(9000); // 后台里那批读读完(每个 7 s)
      await page.evaluate(() => { window.__stubDelayMs = 2500; });
      await setVisible(page, true);
      let seenSlow = false;
      for (let i = 0; i < 10; i++) { if (await slowNow()) seenSlow = true; await page.waitForTimeout(200); }
      await shot('1-after-resume');
      record(where, 'suspend: reads that spanned the background do not count as slow', { onlineFirst, enoughReadsInFlight: inFlight >= 3, noSlowAfterResume: !seenSlow }, { inFlight });

      // ── real slow (visible) ──
      await page.evaluate(() => { window.__stubDelayMs = 6500; });
      const end = Date.now() + 60_000;
      while (Date.now() < end && !(await slowNow())) await page.waitForTimeout(500);
      const reached = await slowNow();
      let detail = '';
      if (reached) {
        const loc = page.locator(tid('connectivity-indicator')).first();
        if (V.ua) await loc.tap(); else await loc.hover();
        await page.waitForTimeout(300);
        detail = (await page.locator(tid('connectivity-indicator-detail')).count()) ? await page.locator(tid('connectivity-indicator-detail')).first().innerText() : '';
        await shot('2-real-slow-tip');
      }
      record(where, 'real slow: indicator + which reads were slow', {
        reached,
        detail: /\d+\.\d+s/.test(detail) && (detail.match(/\d+\.\d+s/g) || []).length === 3,
        noQuery: !detail.includes('?') && !detail.includes('net-'),
      }, { detail });
      await page.evaluate(() => { window.__stubDelayMs = 0; });
      record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
    } catch (e) {
      record(where, 'run', { ran: false }, { error: String(e).split('\n')[0] });
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
