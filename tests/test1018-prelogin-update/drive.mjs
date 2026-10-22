// Real exported first-run/login UI; only native updater IPC is synthetic. No Hub login/network.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
try {
  const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => new URL(route.request().url()).host === new URL(web.url).host ? route.continue() : route.abort());
  await page.addInitScript({ content: `(${initScript.toString()})({theme:'light'});` });
  await page.addInitScript(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__updateReads = 0;
    window.__hubCalls = [];
    window.__updateOffline = false;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'load_active_desktop_profile') return null;
      if (cmd === 'plugin:updater|check') {
        window.__updateReads++;
        if (window.__updateOffline) throw new Error('network unreachable');
        if (window.__updateAvailable) return { rid: 1018, currentVersion: '0.2.241', version: '99.0.0', body: 'TEST ONLY update notes' };
        return null;
      }
      if (cmd === 'save_desktop_profile' || cmd.startsWith('plugin:http|')) window.__hubCalls.push(cmd);
      return original(cmd, args);
    };
  });
  await page.goto(web.url);
  await page.getByTestId('first-run-local-hub').waitFor();
  await page.getByTestId('prelogin-update-check').click();
  await page.getByTestId('prelogin-update-result').filter({ hasText: '已是最新版本' }).waitFor();
  assert.ok(await page.evaluate(() => window.__updateReads > 0));
  await page.getByText('使用已有 Hub 登录', { exact: true }).click();
  await page.getByTestId('login-screen').waitFor();
  for (const label of ['Hub 地址', '用户名', '密码']) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '');
  // RN Web renders this Pressable as a div: HTML isDisabled() does not describe it.
  // Assert behavior instead: even a DOM click with empty credentials sends nothing.
  await page.getByTestId('login-submit').evaluate(element => element.click());
  assert.deepEqual(await page.evaluate(() => window.__hubCalls), []);
  await page.evaluate(() => { window.__updateOffline = true; });
  await page.getByTestId('prelogin-update-check').click();
  await page.getByTestId('prelogin-update-result').filter({ hasText: '检查更新失败' }).waitFor();
  await page.evaluate(() => { window.__updateOffline = false; });
  await page.getByTestId('prelogin-update-check').click();
  await page.getByTestId('prelogin-update-result').filter({ hasText: '已是最新版本' }).waitFor();
  assert.equal(await page.getByTestId('login-screen').count(), 1);
  assert.deepEqual(await page.evaluate(() => window.__hubCalls), [], 'update checks must not log in or contact Hub');
  await page.evaluate(() => { window.__updateAvailable = true; });
  await page.getByTestId('prelogin-update-check').click();
  await page.getByTestId('desktop-update-card').waitFor();
  await page.getByTestId('desktop-update-versions').filter({ hasText: '99.0.0' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS exported UI: first-run check, empty login fields, disabled login, update error→retry, login retained, no Hub calls/page errors, available update opens existing installer prompt');
  await ctx.close();
} finally { await browser.close(); web.close(); }
