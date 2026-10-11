// Actual exported app and mobile storage path; fake Hub/credentials, no password mutation.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = await serveExport(process.env.WEB_DIR);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
try {
  if (process.env.STALE_BADGE_ONLY === '1') {
    const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript({ content: `(${initScript.toString()})({theme:'light'});` });
    await page.addInitScript(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      const profile = { serverUrl: 'http://mock-hub.invalid', token: 'placeholder-token', username: 'tester', profileId: 'p-sweep', networkId: 'net-sweep' };
      window.__badgeRequiresReauth = true; window.__badgeMarks = []; window.__badgeAuthReads = 0;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if (cmd === 'list_desktop_profiles') return JSON.stringify({ schema_version: 1, active_profile_id: 'p-sweep', profiles: [
          { ...profile, requiresReauth: window.__badgeRequiresReauth, createdAt: 1, updatedAt: 1 },
          { ...profile, profileId: 'p-other', username: 'other', requiresReauth: true, createdAt: 1, updatedAt: 1 },
        ] });
        if (cmd === 'load_desktop_profile') return JSON.stringify(profile);
        if (cmd === 'mark_desktop_profile_requires_reauth') { window.__badgeMarks.push(args); if (args.profileId === 'p-sweep') window.__badgeRequiresReauth = args.required; return null; }
        if (cmd === 'plugin:http|fetch' && new URL(args.clientConfig.url).pathname === '/api/auth/me') window.__badgeAuthReads++;
        return original(cmd, args);
      };
    });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep);
    await page.getByText('示例-A', { exact: true }).first().waitFor();
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'settings' }));
    const row = page.getByTestId('settings-profile-p-sweep'); await row.waitFor();
    await page.waitForFunction(() => window.__badgeRequiresReauth === false, undefined, { timeout: 5000 });
    assert(!(await row.innerText()).includes('需要重新登录'), 'freshly valid current account must not retain the warning');
    assert.equal(await page.evaluate(() => window.__badgeAuthReads >= 2), true, 'verification must bypass the warm auth cache');
    assert.deepEqual(await page.evaluate(() => window.__badgeMarks), [{ profileId: 'p-sweep', required: false }]);
    assert((await page.getByTestId('settings-profile-p-other').innerText()).includes('需要重新登录'), 'other account remains unverified');
    assert.equal(await page.getByTestId('login-screen').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS current-account stale badge6/6: fresh verification, persisted clear, real settings row, other account unchanged');
    await ctx.close();
  } else {
  const ctx = await browser.newContext({ locale: TEST_LOCALE, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript({ content: `(${initScript.toString()})({theme:'light'});` });
  await page.addInitScript(() => {
    const bridge = window.__TAURI_INTERNALS__;
    delete window.__TAURI_INTERNALS__;
    localStorage.setItem('hub_config_v1', JSON.stringify({ serverUrl: 'http://mock-hub.invalid', token: 'TEST-ONLY-old', username: 'tester', networkId: 'net-sweep' }));
    window.__late401 = [];
    window.__reauthReads = [];
    window.fetch = async (input, init = {}) => {
      const url = String(input), path = new URL(url).pathname;
      const headers = [...new Headers(init.headers).entries()];
      const token = new Headers(init.headers).get('authorization');
      window.__reauthReads.push({ path, token });
      if (token === 'Bearer TEST-ONLY-old' && ['/api/status', '/api/nodes'].includes(path) && window.__late401.length < 2) {
        return await new Promise(resolve => window.__late401.push(() => resolve(new Response('{"ok":false,"error":"token_expired"}', { status: 401 }))));
      }
      if (path === '/api/auth/login') return new Response(JSON.stringify({ ok: true, token: 'TEST-ONLY-new', username: 'tester', network_id: 'net-sweep' }), { status: 200 });
      const rid = await bridge.invoke('plugin:http|fetch', { clientConfig: { url, method: init.method || 'GET', headers, data: init.body ? [...new TextEncoder().encode(init.body)] : undefined } });
      const meta = await bridge.invoke('plugin:http|fetch_send', { rid });
      const bytes = await bridge.invoke('plugin:http|fetch_read_body', { rid: meta.rid });
      return new Response(new Uint8Array(bytes.slice(0, -1)), { status: meta.status, headers: meta.headers });
    };
  });
  await page.goto(web.url);
  await page.waitForFunction(() => window.__late401.length === 2);
  await page.evaluate(() => window.__late401[0]());
  await page.getByTestId('login-screen').waitFor();
  assert.equal(await page.getByLabel('用户名', { exact: true }).inputValue(), 'tester');
  await page.getByLabel('密码', { exact: true }).fill('TEST-ONLY-password');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('nav-shell').waitFor();
  await page.getByText('示例-A', { exact: true }).first().waitFor();
  await page.evaluate(() => window.__late401[1]());
  await page.waitForFunction(() => window.__reauthReads.some(r => r.token === 'Bearer TEST-ONLY-new' && r.path === '/api/status'));
  // Let the old response's async failure handler settle, not a network timeout.
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('login-screen').count(), 0, 'late old401 cannot kick a successful login');
  assert.equal(await page.getByTestId('nav-shell').count(), 1);
  const state = await page.evaluate(() => ({ cfg: JSON.parse(localStorage.getItem('hub_config_v1')), index: JSON.parse(localStorage.getItem('hub_sessions_v2')) }));
  assert.equal(state.cfg.token, 'TEST-ONLY-new');
  assert.equal(state.index.sessions.length, 1, 're-login must not create a second account');
  assert.equal(state.index.sessions[0].requiresReauth, undefined, 'new saved account must not retain the warning');
  assert.deepEqual(errors, []);
  console.log('PASS exported mobile reauth8/8: old401→login→new persisted credential→late old401 ignored; clean account flag/no duplicate/no page errors');
  await ctx.close();
  }
} finally { await browser.close(); web.close(); }
