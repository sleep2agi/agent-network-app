// 切换账号(Vincent 2026-09-29), end to end on the web export against TWO mock hubs on two ports.
// Not in CI: needs Playwright + Chromium and a web export. Starts its own mock hubs (tests/test-account-switch/mock-hub.mjs),
// never touches a real hub.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-account-switch/drive.mjs
//
// For phone 390×844 (Android UA) and wide 1200×800:
//   1  log in to hub A
//   2  设置 → 切换账号 → 添加账号 → log in to hub B (A is not signed out)
//   3  switch B→A→B from the switcher: no login page / password prompt in between
//   4  after every switch the agent list and the task list show only that account's data
//   5  after every switch the previous hub's user SSE is closed and the new hub's is open
//   6  reload: both accounts are still saved, the last one is still active
//   7  geometry: phone — the 切换账号 block lines up with 退出登录; wide — 切换账号 is a row in the same column as
//      添加 Hub / 账号 and the isolated 移除当前账号 button sits under them with its label centred (settings v1, #648)
//   8  phone shows a bottom sheet; wide shows a centred dialog
// Screenshots go to OUT. Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockHub } from './mock-hub.mjs';
import { paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

const hubA = await startMockHub({ name: 'a', username: 'alice', password: 'pw-a', token: 'utok_mock_alice', networkId: 'net_mock_a', agents: ['alpha-agent-a1', 'alpha-agent-a2'], tasks: ['task-only-in-hub-A'] });
const hubB = await startMockHub({ name: 'b', username: 'bob', password: 'pw-b', token: 'utok_mock_bob', networkId: 'net_mock_b', agents: ['bravo-agent-b1'], tasks: ['task-only-in-hub-B'] });
// #649 打码后的 loopback Hub 地址:http://127.0.0.1:PORT → 127.***.***.1:PORT。写死这一种形状并在不是 loopback 时直接抛,
// 不在测试里再实现一遍打码规则(规则本身由 src/mask-hub-address.test.ts 钉)。
const maskedLoopback = (url) => {
  const m = /^http:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(url);
  if (!m) throw new Error(`expected a loopback hub url, got ${url}`);
  return `127.***.***.1:${m[1]}`;
};
const HUBS = { A: { hub: hubA, user: 'alice', pw: 'pw-a', agent: 'alpha-agent-a1', task: 'task-only-in-hub-A' }, B: { hub: hubB, user: 'bob', pw: 'pw-b', agent: 'bravo-agent-b1', task: 'task-only-in-hub-B' } };

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe() });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
const results = [];
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail };
  results.push(row);
  console.log(JSON.stringify(row));
}
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(150); } return v; };
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }; };

async function login(page, who) {
  const h = HUBS[who];
  await page.locator(tid('login-screen')).waitFor({ timeout: 30000 });
  await page.getByLabel('服务器地址', { exact: true }).fill(h.hub.url);
  await page.getByLabel('用户名', { exact: true }).fill(h.user);
  await page.getByLabel('密码', { exact: true }).fill(h.pw);
  await page.locator(tid('login-submit')).click();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 15000 });
}
async function openSettings(page) {
  await page.locator(tid('mobile-tab-settings')).click();
  await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane')).first().waitFor({ timeout: 8000 });
}
const switchEntry = (wide) => tid(wide ? 'settings-switch-account-row' : 'settings-switch-account-block');
async function openSwitcher(page, wide) {
  await openSettings(page);
  await page.locator(switchEntry(wide)).click();
  await page.locator(tid(wide ? 'account-switch-dialog' : 'account-switch-sheet')).waitFor({ timeout: 5000 });
}

// Which account is showing: agent list (Agents tab) + task list (任务 tab).
async function accountData(page) {
  await page.locator(tid('mobile-tab-agents')).click();
  await sleep(1500);
  const agents = await bodyText(page);
  await page.locator(tid('mobile-tab-tasks')).click();
  await sleep(1500);
  let tasks = await bodyText(page);
  if (!/task-only-in-hub/.test(tasks)) {
    // The 任务 page opens on the requirement board; the dispatched-task rows are under 派发记录.
    const seg = page.getByText('派发记录', { exact: true }).first();
    if (await seg.isVisible().catch(() => false)) { await seg.click(); await sleep(1500); tasks = await bodyText(page); }
  }
  await page.locator(tid('mobile-tab-agents')).click();
  return {
    agentsA: agents.includes(HUBS.A.agent), agentsB: agents.includes(HUBS.B.agent),
    tasksA: tasks.includes(HUBS.A.task), tasksB: tasks.includes(HUBS.B.task),
  };
}
const sseOk = async (active) => waitFor(async () => {
  const a = hubA.sse(), b = hubB.sse();
  return (active === 'A' ? a.open === 1 && b.open === 0 : b.open === 1 && a.open === 0) ? { a, b } : null;
}, 10000) || { a: hubA.sse(), b: hubB.sse(), timeout: true };

async function run(vp, viewport, ua, wide) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  let loginPrompts = 0;
  await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);

  // 1. A
  await login(page, 'A');
  let d = await accountData(page);
  let s = await sseOk('A');
  record(vp, '1 logged in to A', { agentsA: d.agentsA, noAgentsB: !d.agentsB, tasksA: d.tasksA, noTasksB: !d.tasksB, sseA: !s.timeout }, { sse: s });

  // 7/8. settings geometry + switcher shape (1 account)
  await openSettings(page);
  await sleep(500);
  await page.screenshot({ path: join(OUT, `${vp}-settings.png`) });
  if (!wide) {
    const sw = await box(page, tid('settings-switch-account-block'));
    const lo = await box(page, tid('settings-logout-block'));
    const grp = await box(page, tid('settings-group-0') + ' > div:last-child');
    const swText = await page.locator(tid('settings-switch-account-block')).evaluate(e => { const r = e.firstElementChild.getBoundingClientRect(); const b = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, bcx: b.x + b.width / 2, cy: r.y + r.height / 2, bcy: b.y + b.height / 2 }; });
    record(vp, '7 phone: 切换账号 block geometry', {
      aboveLogout: sw.y + sw.h <= lo.y,
      sameLeft: Math.abs(sw.x - lo.x) <= 0.5, sameWidth: Math.abs(sw.w - lo.w) <= 0.5, sameHeight: Math.abs(sw.h - lo.h) <= 0.5,
      gapEqualsLogoutGap: Math.abs((lo.y - (sw.y + sw.h)) - 16) <= 1,
      alignedWithRowBlocks: !!grp && Math.abs(grp.x - sw.x) <= 0.5 && Math.abs(grp.w - sw.w) <= 0.5,
      labelCentred: Math.abs(swText.cx - swText.bcx) <= 1 && Math.abs(swText.cy - swText.bcy) <= 1,
    }, { switch: sw, logout: lo, rowBlock: grp, label: swText });
    await page.locator(tid('settings-switch-account-block')).screenshot({ path: join(OUT, `${vp}-switch-row.png`) });
  } else {
    const sw = await box(page, tid('settings-switch-account-row'));
    const add = await box(page, tid('settings-add-account-row'));
    const lo = await box(page, tid('settings-logout-row'));
    const label = await box(page, `${tid('settings-switch-account-row')} >> text=切换账号`);
    const loLabel = await box(page, `${tid('settings-logout-row')} >> text=移除当前账号`);
    // #427 (settings v1, #648): 切换账号 is a kit row in the 安全 card (same column as 添加 Hub / 账号); 移除当前账号 is
    // the isolated full-width red button under every card (its 1px border makes it 1px wider on each side), label centred.
    record(vp, '7 wide: 切换账号 row geometry', {
      betweenAddAndLogout: add.y + add.h <= sw.y && sw.y + sw.h <= lo.y,
      sameLeftAsAdd: Math.abs(sw.x - add.x) <= 0.5, sameWidthAsAdd: Math.abs(sw.w - add.w) <= 0.5,
      atLeast52: sw.h >= 51.5 && add.h >= 51.5,
      logoutSameColumn: Math.abs(lo.x - sw.x) <= 1.5 && Math.abs((lo.x + lo.w) - (sw.x + sw.w)) <= 1.5,
      logoutLabelCentred: Math.abs((loLabel.x + loLabel.w / 2) - (lo.x + lo.w / 2)) <= 1,
    }, { add, switch: sw, logout: lo, label, logoutLabel: loLabel });
    await page.locator(tid('settings-switch-account-row')).screenshot({ path: join(OUT, `${vp}-switch-row.png`) });
  }

  // 2. add B
  await page.locator(switchEntry(wide)).click();
  await page.locator(tid(wide ? 'account-switch-dialog' : 'account-switch-sheet')).waitFor({ timeout: 5000 });
  await page.locator(tid('account-switch-add')).click();
  await page.locator(tid('login-add-account-title')).waitFor({ timeout: 5000 });
  const cancelShown = await page.locator(tid('login-cancel-add')).isVisible();
  await page.screenshot({ path: join(OUT, `${vp}-add-account-login.png`) });
  await login(page, 'B');
  d = await accountData(page);
  s = await sseOk('B');
  record(vp, '2 added B (login page in add mode, back button shown)', { cancelShown, agentsB: d.agentsB, noAgentsA: !d.agentsA, tasksB: d.tasksB, noTasksA: !d.tasksA, sseSwitched: !s.timeout }, { sse: s });

  // Switcher with two accounts: screenshot + shape
  await openSwitcher(page, wide);
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${vp}-switcher.png`) });
  const panel = await box(page, tid(wide ? 'account-switch-dialog' : 'account-switch-sheet'));
  const rowsText = await page.locator('[data-testid^="account-switch-label-"]').allInnerTexts();
  const labelPaint = []; for (const t of rowsText) labelPaint.push(await paintedText(page, '[data-testid^="account-switch-label-"]', t)); // painted, not only textContent
  const current = await page.locator(`[data-testid^="account-switch-row-"]:has(${tid('account-switch-current')})`).innerText();
  record(vp, '8 switcher shape', {
    variant: wide ? (panel.x > 100 && panel.y > 50 && panel.x + panel.w < viewport.width - 100) : (Math.abs(panel.y + panel.h - viewport.height) <= 1 && Math.abs(panel.w - viewport.width) <= 1),
    twoRows: rowsText.length === 2,
    // #649:行是「账号 @ 打码主机」。两台 Hub 都是 127.0.0.1:<port>,打码后 = 127.***.***.1:<port>(src/mask-hub-address.ts 的 IPv4 规则)。
    rowFormat: rowsText.some(t => t === `alice @ ${maskedLoopback(hubA.url)}`) && rowsText.some(t => t === `bob @ ${maskedLoopback(hubB.url)}`),
    rowNoFullHost: rowsText.length === 2 && rowsText.every(t => !t.includes(hubA.url.replace('http://', '')) && !t.includes(hubB.url.replace('http://', ''))),
    currentIsB: current.includes('bob @'),
    labelsPainted: labelPaint.length === 2 && labelPaint.every(p => !!p?.painted && p.w >= 8),
  }, { panel, rowsText, labelPaint });
  // 管理 → 移除 buttons appear (not pressed)
  await page.locator(tid('account-switch-manage')).click();
  await sleep(200);
  const removeButtons = await page.locator('[data-testid^="account-switch-remove-"]').count();
  await page.screenshot({ path: join(OUT, `${vp}-switcher-manage.png`) });
  await page.locator(tid('account-switch-manage')).click();
  record(vp, '8 管理 shows 移除 per account', { two: removeButtons === 2 }, { removeButtons });

  // 3. B → A → B without a password prompt
  const idA = (await page.locator(`[data-testid^="account-switch-row-"]:has-text("alice @")`).getAttribute('data-testid')).replace('account-switch-row-', '');
  const idB = (await page.locator(`[data-testid^="account-switch-row-"]:has-text("bob @")`).getAttribute('data-testid')).replace('account-switch-row-', '');
  for (const [to, id] of [['A', idA], ['B', idB], ['A', idA]]) {
    if (!(await page.locator(tid(wide ? 'account-switch-dialog' : 'account-switch-sheet')).isVisible().catch(() => false))) await openSwitcher(page, wide);
    await page.locator(tid(`account-switch-row-${id}`)).click();
    await sleep(800);
    if (await page.locator(tid('login-screen')).isVisible().catch(() => false)) loginPrompts++;
    await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 10000 });
    d = await accountData(page);
    s = await sseOk(to);
    const other = to === 'A' ? 'B' : 'A';
    record(vp, `3 switched to ${to} (no password)`, {
      noLoginPrompt: loginPrompts === 0,
      ownAgents: d[`agents${to}`], noOtherAgents: !d[`agents${other}`],
      ownTasks: d[`tasks${to}`], noOtherTasks: !d[`tasks${other}`],
      oldSseClosedNewOpen: !s.timeout,
    }, { sse: s });
  }
  // B→A→B→A above; one more to B so the reload check starts from B.
  await openSwitcher(page, wide);
  await page.locator(tid(`account-switch-row-${idB}`)).click();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 10000 });
  s = await sseOk('B');

  // 6. reload
  await page.reload();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 30000 });
  const loginAfterReload = await page.locator(tid('login-screen')).isVisible().catch(() => false);
  d = await accountData(page);
  s = await sseOk('B');
  await openSwitcher(page, wide);
  const afterReloadRows = await page.locator('[data-testid^="account-switch-label-"]').allInnerTexts();
  const tokensInIndex = await page.evaluate(() => localStorage.getItem('hub_sessions_v2') ?? '');
  record(vp, '6 reload keeps both accounts, B still active', {
    notLoggedOut: !loginAfterReload, bothSaved: afterReloadRows.length === 2, activeB: d.agentsB && !d.agentsA, sseB: !s.timeout,
    indexHasNoToken: !tokensInIndex.includes('utok_'),
  }, { afterReloadRows });
  await page.keyboard.press('Escape').catch(() => {});
  await ctx.close();
  // A closed page must close its stream too, before the next viewport starts.
  await waitFor(async () => hubA.sse().open === 0 && hubB.sse().open === 0, 5000);
}

try {
  await run('phone-390x844', { width: 390, height: 844 }, ANDROID_UA, false);
  await run('wide-1200x800', { width: 1200, height: 800 }, MAC_UA, true);
} catch (e) {
  failures++;
  console.error('DRIVER ERROR', e);
}
console.log(JSON.stringify({ unknownEndpointsA: hubA.unknown(), unknownEndpointsB: hubB.unknown() }));
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
hubA.close(); hubB.close(); web.close();
console.log(failures ? `FAILED: ${failures}` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
