// 修改密码 + 弱密码横幅(#653),在 web 导出里端到端跑。不连任何真实 hub、不用真账号:
//   手机 390×844(安卓 UA):本目录 mock-hub.mjs(127.0.0.1 随机端口,行为照 hub 的 /api/auth/login、/api/auth/password);
//   桌面 1200×850:tests/test-layout-sweep/harness.mjs 的 Tauri 桩(页内应答,不起进程),设置窗口按桩记下的 URL 另开一页。
//
//   WEB_DIR=<expo export dir> OUT=<png dir> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-change-password/drive.mjs
//
// 手机:
//   1  弱密码登录(hub 回 must_change_password)→ 会话页顶上出现「当前密码过于简单，请修改」横幅;整宽、≥44 高、在 tab 首页内容最上面
//   2  点横幅 → 设置 → 账号 → 修改密码 三级页(标题、三个输入框、标签左边缘对齐、卡片左右 16)
//   3  新密码太简单 → 本地提示,不发请求;两次不一致 → 本地提示,不发请求
//   4  当前密码错 → hub 400 → 「当前密码不对」
//   5  成功 → 「密码已修改」toast;仍在登录状态(hub 已吊销旧令牌,app 换上新令牌后读取照常 200);回到会话页横幅消失;刷新后仍登录、仍无横幅
// 桌面:
//   6  标记在 → 主窗口右侧内容栏顶上一条横幅(36 高,左边缘 = 内容栏左边缘)
//   7  点横幅 → 设置窗口直接落在「修改密码」(URL detail=changePassword),右栏表单:标签在上、强度提示、按钮在右下
//   8  当前密码错 → 错误;成功 → toast、页面回到账号;主窗口横幅经 storage 事件消失
// 截图写到 OUT。任何一条断言失败 exit 1。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA, TEST_LOCALE, openStubWindow } from '../test-layout-sweep/harness.mjs';
import { startMockHub } from './mock-hub.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB);

// Placeholder credentials for the mock only.
const USER = 'admin';
const WEAK_PW = 'anethub';
const NEW_PW = 'Plac3holder-Strong-9';
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
}
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox().catch(() => null); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height) }; };
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

// ── 手机 ───────────────────────────────────────────────────────────────────────────────────────
{
  const vp = 'phone';
  const hub = await startMockHub({ username: USER, password: WEAK_PW });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, deviceScaleFactor: 2, locale: TEST_LOCALE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator(tid('login-screen')).waitFor({ timeout: 30000 });
  await page.getByLabel('服务器地址', { exact: true }).fill(hub.url);
  await page.getByLabel('用户名', { exact: true }).fill(USER);
  await page.getByLabel('密码', { exact: true }).fill(WEAK_PW);
  await page.locator(tid('login-submit')).click();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 15000 });

  // 1
  await page.locator(tid('weak-password-banner')).waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(500);
  await page.screenshot({ path: join(OUT, 'phone-banner.png') });
  const banner = await box(page, tid('weak-password-banner'));
  const header = await box(page, tid('agents-header') + ',' + tid('agents-screen'));
  record(vp, '1 weak login → banner on the 会话 tab', {
    shown: !!banner, text: (await text(page, tid('weak-password-banner-text'))) === '当前密码过于简单，请修改',
    fullWidth: !!banner && banner.x === 0 && Math.abs(banner.w - 390) <= 1, tall: !!banner && banner.h >= 44, top: !!banner && banner.y <= 1,
    aboveContent: !header || (!!banner && banner.b <= header.y + 1),
  }, { banner, header });

  // 2
  await page.locator(tid('weak-password-banner')).click();
  await page.locator(tid('change-password-current')).waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'phone-page.png') });
  const title = await text(page, tid('settings-subpage-title'));
  const fields = await Promise.all(['current', 'new', 'confirm'].map(k => box(page, tid(`change-password-${k}-row`))));
  const labels = await Promise.all(['current', 'new', 'confirm'].map(k => box(page, tid(`change-password-${k}-row-label`))));
  const inputs = await Promise.all(['current', 'new', 'confirm'].map(k => box(page, tid(`change-password-${k}`))));
  const submitBox = await box(page, tid('change-password-submit'));
  record(vp, '2 banner opens 设置 → 账号 → 修改密码 (three fields, aligned, 16 gutter)', {
    title: title === '修改密码', threeFields: fields.every(Boolean),
    labelsAligned: labels.every(l => l && Math.abs(l.x - labels[0].x) <= 0.5), inputsAligned: inputs.every(i => i && Math.abs(i.x - inputs[0].x) <= 0.5),
    rows48: fields.every(f => f && f.h >= 48), gutter: fields.every(f => f && Math.abs(f.x - 16) <= 1 && Math.abs(390 - f.r - 16) <= 1),
    button: !!submitBox && Math.abs(submitBox.x - 16) <= 1 && Math.abs(390 - submitBox.r - 16) <= 1 && submitBox.h >= 48,
    noTabBar: !(await visible(page, tid('mobile-tab-bar'))), noBannerHere: !(await visible(page, tid('weak-password-banner'))),
  }, { title, fields, labels, inputs, submitBox });

  // 3
  const passwordCalls = () => hub.calls().filter(c => c.what === 'password').length;
  await page.locator(tid('change-password-current')).fill(WEAK_PW);
  await page.locator(tid('change-password-new')).fill('password123');
  const weakHint = await text(page, tid('change-password-card') + ' ' + tid('settings-kit-footer'));
  await page.locator(tid('change-password-confirm')).fill('password123');
  await page.screenshot({ path: join(OUT, 'phone-page-weak-hint.png') });
  await page.locator(tid('change-password-submit')).click();
  await sleep(300);
  const weakErr = await text(page, tid('change-password-error'));
  await page.locator(tid('change-password-new')).fill(NEW_PW);
  await page.locator(tid('change-password-confirm')).fill(NEW_PW + 'x');
  const mismatchHint = await text(page, tid('change-password-card') + ' ' + tid('settings-kit-footer'));
  await page.locator(tid('change-password-submit')).click();
  await sleep(300);
  const mismatchErr = await text(page, tid('change-password-error'));
  record(vp, '3 weak / mismatch: inline hint + error, nothing sent', {
    weakHint: weakHint.includes('常见密码'), weakErr: weakErr.includes('新密码太简单'), mismatchHint: mismatchHint.includes('不一致'), mismatchErr: mismatchErr.includes('两次输入的新密码不一致'), noRequest: passwordCalls() === 0,
  }, { weakHint, weakErr, mismatchHint, mismatchErr });

  // 4
  await page.locator(tid('change-password-current')).fill('wrong-placeholder');
  await page.locator(tid('change-password-confirm')).fill(NEW_PW);
  await page.locator(tid('change-password-submit')).click();
  await page.locator(tid('change-password-error')).waitFor({ timeout: 5000 }).catch(() => {});
  await sleep(300);
  const wrongErr = await text(page, tid('change-password-error'));
  const currentAfter = await page.locator(tid('change-password-current')).inputValue().catch(() => '?');
  await page.screenshot({ path: join(OUT, 'phone-page-wrong-current.png') });
  record(vp, '4 wrong current password → hub 400 → says so, clears that field', { sent: passwordCalls() === 1, err: wrongErr.includes('当前密码不对'), cleared: currentAfter === '' }, { wrongErr });

  // 5
  await page.locator(tid('change-password-current')).fill(WEAK_PW);
  await page.locator(tid('change-password-submit')).click();
  await page.locator(tid('account-toast')).waitFor({ timeout: 8000 }).catch(() => {});
  const toast = await text(page, tid('account-toast'));
  await page.screenshot({ path: join(OUT, 'phone-done.png') });
  const backOnAccount = await visible(page, tid('settings-subpage-account')) && !(await visible(page, tid('change-password-current')));
  const unauthorizedBefore = hub.calls().filter(c => c.what === 'unauthorized').length;
  // back to the 会话 tab: reads go through with the new token, banner gone
  for (let i = 0; i < 3 && await visible(page, tid('settings-back')); i++) { await page.locator(tid('settings-back')).click(); await sleep(200); }
  await page.locator(tid('mobile-tab-agents')).click().catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: join(OUT, 'phone-after.png') });
  const bannerGone = !(await visible(page, tid('weak-password-banner')));
  const stillIn = !(await visible(page, tid('login-screen'))) && await visible(page, tid('mobile-tab-bar'));
  const unauthorizedAfter = hub.calls().filter(c => c.what === 'unauthorized').length;
  await page.reload();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const afterReload = await visible(page, tid('mobile-tab-bar')) && !(await visible(page, tid('login-screen'))) && !(await visible(page, tid('weak-password-banner')));
  record(vp, '5 success → toast 密码已修改, still signed in on the new token, banner gone (also after reload)', {
    toast: toast.includes('密码已修改'), backOnAccount, bannerGone, stillIn, no401: unauthorizedAfter === unauthorizedBefore, afterReload,
    hubRotated: hub.state().tokens >= 1 && !hub.state().mustChange, noPageErrors: errors.length === 0,
  }, { toast, unauthorizedBefore, unauthorizedAfter, errors: errors.slice(0, 3) });
  await ctx.close();
  hub.close();
}

// ── 桌面 ───────────────────────────────────────────────────────────────────────────────────────
// harness 的桩外面再包一层:账号表 + 保存后的会话(换令牌后按 profileId 读回来的是新令牌)+ /api/auth/password 应答。
const desktopStub = () => {
  const inner = window.__TAURI_INTERNALS__;
  if (!inner) return;
  const invoke = inner.invoke;
  const key = 'stub.savedSession';
  const saved = () => { try { return localStorage.getItem(key); } catch { return null; } };
  inner.invoke = async (cmd, args) => {
    switch (cmd) {
      case 'list_desktop_profiles': return JSON.stringify({ schema_version: 1, active_profile_id: 'p-sweep', profiles: [{ profileId: 'p-sweep', serverUrl: 'http://mock-hub.invalid', username: 'tester', displayName: 'tester', networkId: 'net-sweep', createdAt: 0, updatedAt: 0 }] });
      case 'save_desktop_profile': try { localStorage.setItem(key, args.sessionJson); } catch {} (window.__savedSessions ||= []).push(JSON.parse(args.sessionJson).token); return args.sessionJson;
      case 'switch_desktop_profile': case 'load_desktop_profile': case 'load_active_desktop_profile': {
        const s = saved();
        if (s) return s;
        return invoke('load_active_desktop_profile', args);
      }
      default: return invoke(cmd, args);
    }
  };
  // hub /api/auth/password, same rules and words as the hub (the stub's status is always 200; the body carries ok:false).
  const prev = window.__routeOverride;
  window.__routeOverride = (u, bodyText, method) => {
    if (u.pathname === '/api/auth/password' && method === 'POST') {
      const b = JSON.parse(bodyText || '{}');
      (window.__passwordCalls ||= []).push(Object.keys(b).sort().join(','));
      if (!b.new_password || b.new_password.length < 8) return { ok: false, error: 'new password must be at least 8 characters' };
      if (b.old_password !== 'anethub') return { ok: false, error: 'incorrect current password' };
      return { ok: true, revoked: 3, token: 'utok_stub_rotated', token_id: 'tok_stub_rotated' };
    }
    return prev ? prev(u, bodyText, method) : undefined;
  };
};
const flagWeak = () => { try { if (!localStorage.getItem('stub.flagged')) { localStorage.setItem('anet.weakPassword.v1', JSON.stringify(['http://mock-hub.invalid\u0000tester'])); localStorage.setItem('stub.flagged', '1'); } localStorage.setItem('anet.language.v1', 'zh'); } catch {} };
{
  const vp = 'desktop';
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, colorScheme: 'light', deviceScaleFactor: 2, locale: TEST_LOCALE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  const scripts = [[initScript, { theme: 'light' }], [desktopStub], [flagWeak]];
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator(tid('desktop-rail')).waitFor({ timeout: 20000 });
  await page.locator(tid('weak-password-banner')).waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(600);
  await page.screenshot({ path: join(OUT, 'desktop-banner.png') });

  // 6
  const banner = await box(page, tid('weak-password-banner'));
  const rail = await box(page, tid('desktop-rail'));
  record(vp, '6 banner tops the content column (36 high, right of the list, full content width)', {
    shown: !!banner, text: (await text(page, tid('weak-password-banner-text'))) === '当前密码过于简单，请修改',
    height: !!banner && Math.abs(banner.h - 36) <= 1, top: !!banner && banner.y <= 1, rightOfRail: !!banner && !!rail && banner.x > rail.r, toRightEdge: !!banner && Math.abs(banner.r - 1200) <= 1,
  }, { banner, rail });

  // 7
  await page.locator(tid('weak-password-banner')).click();
  const win = await openStubWindow(page, 'settings', scripts);
  const opened = await page.evaluate(() => (window.__openedWindows || []).map(w => w.url));
  let ok7 = false;
  if (win) {
    win.on('pageerror', e => errors.push(String(e.message || e)));
    await win.setViewportSize({ width: 1200, height: 850 });
    await win.locator(tid('change-password-desktop')).waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(600);
    await win.screenshot({ path: join(OUT, 'desktop-page.png') });
    const labels = await Promise.all(['current', 'new', 'confirm'].map(k => box(win, tid(`change-password-${k}-label`))));
    const shells = await Promise.all(['current', 'new', 'confirm'].map(k => box(win, tid(`change-password-${k}-shell`))));
    const cancel = await box(win, tid('change-password-cancel'));
    const submit = await box(win, tid('change-password-submit'));
    const card = await box(win, tid('change-password-card') + ' ' + tid('settings-kit-card'));
    const titleText = await text(win, tid('settings-password-header'));
    ok7 = !!shells[0];
    record(vp, '7 banner opens the settings window straight on 修改密码 (labels above inputs, buttons bottom-right)', {
      url: opened.some(u => u.includes('detail=changePassword')), header: titleText.includes('修改密码') && titleText.includes('账号'),
      labelsAbove: labels.every((l, i) => l && shells[i] && l.b <= shells[i].y + 1 && Math.abs(l.x - shells[i].x) <= 1),
      sameColumn: shells.every(s => s && Math.abs(s.x - shells[0].x) <= 0.5 && Math.abs(s.w - shells[0].w) <= 0.5),
      buttonsRight: !!cancel && !!submit && !!card && submit.x > cancel.r && Math.abs(card.r - submit.r - 24) <= 2 && Math.abs(cancel.y - submit.y) <= 0.5,
      weakNotice: await visible(win, tid('change-password-weak-notice')),
    }, { opened, labels, shells, cancel, submit, card, titleText });

    // 8
    await win.locator(tid('change-password-new')).fill('abc');
    const shortHint = await text(win, tid('change-password-strength-text'));
    await win.locator(tid('change-password-new')).fill(NEW_PW);
    const okHint = await text(win, tid('change-password-strength-text'));
    await win.locator(tid('change-password-confirm')).fill(NEW_PW);
    await win.locator(tid('change-password-current')).fill('wrong-placeholder');
    await win.screenshot({ path: join(OUT, 'desktop-page-filled.png') });
    await win.locator(tid('change-password-submit')).click();
    await win.locator(tid('change-password-error')).waitFor({ timeout: 5000 }).catch(() => {});
    const wrongErr = await text(win, tid('change-password-error'));
    await win.screenshot({ path: join(OUT, 'desktop-page-wrong-current.png') });
    await win.locator(tid('change-password-current')).fill(WEAK_PW);
    await win.locator(tid('change-password-submit')).click();
    await win.locator(tid('account-toast')).waitFor({ timeout: 8000 }).catch(() => {});
    const toast = await text(win, tid('account-toast'));
    await sleep(300);
    await win.screenshot({ path: join(OUT, 'desktop-done.png') });
    const backOnAccount = await visible(win, tid('settings-section-account')) && !(await visible(win, tid('change-password-desktop')));
    const savedTokens = await win.evaluate(() => window.__savedSessions || []);
    await sleep(800);
    const mainBannerGone = !(await visible(page, tid('weak-password-banner')));
    await page.screenshot({ path: join(OUT, 'desktop-after.png') });
    const calls = await win.evaluate(() => window.__passwordCalls || []);
    record(vp, '8 wrong current → error; success → toast, new token saved, back on 账号, main-window banner gone', {
      shortHint: shortHint.includes('还差 5 个字符'), okHint: okHint === '密码强度符合要求', wrongErr: wrongErr.includes('当前密码不对'),
      toast: toast.includes('密码已修改'), savedNewToken: savedTokens.includes('utok_stub_rotated'), backOnAccount, mainBannerGone,
      bodyShape: calls.length === 2 && calls.every(c => c === 'new_password,old_password'), noPageErrors: errors.length === 0,
    }, { shortHint, okHint, wrongErr, toast, savedTokens, calls, errors: errors.slice(0, 3) });
  }
  if (!ok7) record(vp, '7 settings window opened on 修改密码', { opened: false }, { opened });
  await ctx.close();
}

await browser.close();
web.close();
console.log(failures ? `FAIL: ${failures} check group(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
