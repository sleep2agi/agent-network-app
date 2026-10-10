// 登录设备 + 登录过期(安全审计 2026-09-29), end to end on the web export against mock hubs (tests/test-login-devices/mock-hub.mjs).
// Not in CI: needs Playwright + Chromium and a web export. Never touches a real hub.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-login-devices/drive.mjs
//
// For phone 390×844 (Android UA) and wide 1200×800:
//   1  login sends a client_label
//   2  设置 → 账号 has a 登录设备 entry that lines up with the rows around it (boundingBox)
//   3  the page lists this device first with 本机, others with 最近使用 …; long lists stop at 20 + 显示全部
//      geometry: labels share one left edge, 退出 / 本机 share one right edge, rows ≥ 48 (phone);
//      wide: icon / label columns aligned, header rule at the same y as a normal pane title
//   4  退出 one device: confirm dialog → DELETE → row gone
//   5  退出其他所有设备: confirm → POST revoke-others → only 本机 left
//   6  token_expired 401 → login page says 登录已过期，请重新登录 (and signing in again works)
//   7  a hub without the API (200 text/plain help page) → no entry at all
//   8  switcher: a saved account whose token expired shows as needing re-login when the switcher opens
// Screenshots go to OUT. Exit 1 when any assertion fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';
import { startMockHub } from './mock-hub.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB);

const H = 3600_000, D = 86400_000;
const others = [
  { label: 'Android · 0.2.150', usedAgo: 2 * H },
  { label: 'Windows · 0.2.140', usedAgo: 3 * D },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', usedAgo: 5 * D },
  { ua: 'node', usedAgo: 9 * D },
  { usedAgo: null, createdAgo: 20 * D },
  ...Array.from({ length: 19 }, (_, i) => ({ label: `iOS · 0.2.${100 + i}`, usedAgo: (10 + i) * D })),
  // 分组(2026-09-30):同名的两条再加进「Windows · 0.2.140」(→ 一组 3 个);40 条 label 与 UA 都为空的脚本登录
  // (加上上面那条 → 「未命名(多为脚本 / 命令行)」一组 41 个)。共 67 条,顶层 25 项。
  { label: 'Windows · 0.2.140', usedAgo: 4 * D }, { label: 'Windows · 0.2.140', usedAgo: 6 * D },
  ...Array.from({ length: 40 }, (_, i) => ({ usedAgo: (30 + i) * D, createdAgo: (31 + i) * D })),
];
const TOTAL = others.length + 1; // + 本机
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
}
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn().catch(() => null); if (v) return v; await sleep(150); } return v; };
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height) }; };
const same = (vals, tol = 1) => vals.length > 0 && vals.every(v => v != null && Math.abs(v - vals[0]) <= tol);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

async function login(page, hub, user, pw, { reauth = false } = {}) {
  await page.locator(tid('login-screen')).waitFor({ timeout: 30000 });
  if (!reauth) {
    await page.getByLabel('Hub 地址', { exact: true }).fill(hub.url);
    await page.getByLabel('用户名', { exact: true }).fill(user);
  }
  await page.getByLabel('密码', { exact: true }).fill(pw);
  await page.locator(tid('login-submit')).click();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 15000 });
}
async function openSettings(page) {
  await page.locator(tid('mobile-tab-settings')).click();
  // 手机上设置记得上次停在哪个子页(settings-model 的 viewMemory):先退回列表。
  await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane') + ',' + tid('settings-back')).first().waitFor({ timeout: 8000 });
  for (let i = 0; i < 3 && await page.locator(tid('settings-back')).isVisible().catch(() => false); i++) { await page.locator(tid('settings-back')).click(); await sleep(200); }
  await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane')).first().waitFor({ timeout: 8000 });
}
async function openAccount(page, wide) {
  await openSettings(page);
  if (!wide) {
    await page.locator(tid('settings-row-account')).click();
    await page.locator(tid('settings-subpage-account')).waitFor({ timeout: 5000 });
  }
  await sleep(600);
}
const entry = (wide) => tid(wide ? 'settings-login-devices-row' : 'settings-login-devices');
const rowSel = '[data-testid^="login-device-"]:not([data-testid$="-label"]):not([data-testid$="-value"]):not([data-testid$="-accessory"]):not([data-testid$="-signout"]):not([data-testid$="-badge"])';
// 顶层条目 = 单条的行 + 组头(login-devices-group-*,不含它的 -label / -subtitle / -count / -value / -accessory / -show-all)。
const groupSel = '[data-testid^="login-devices-group-"]:not([data-testid$="-label"]):not([data-testid$="-subtitle"]):not([data-testid$="-count"]):not([data-testid$="-value"]):not([data-testid$="-accessory"]):not([data-testid$="-show-all"])';
const itemSel = `${rowSel}, ${groupSel}`;

async function run(vp, viewport, ua, wide) {
  const hubA = await startMockHub({ name: `a${vp}`, username: 'alice', password: 'pw-a', networkId: 'net_mock_a', agents: ['alpha-agent'], others });
  const hubB = await startMockHub({ name: `b${vp}`, username: 'bob', password: 'pw-b', networkId: 'net_mock_b', agents: ['bravo-agent'] });
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);

  // 1
  await login(page, hubA, 'alice', 'pw-a');
  const loginCall = hubA.calls().find(c => c.what === 'login');
  record(vp, '1 login sends client_label', { label: /^Web · \d+\.\d+\.\d+$/.test(loginCall?.client_label ?? '') }, { client_label: loginCall?.client_label });

  // 2 entry geometry
  await openAccount(page, wide);
  await page.locator(entry(wide)).waitFor({ timeout: 8000 });
  await page.screenshot({ path: join(OUT, `${vp}-account.png`) });
  if (!wide) {
    const dev = await box(page, entry(false));
    const add = await box(page, tid('settings-add-account'));
    const devLabel = await box(page, tid('settings-login-devices-label'));
    const addLabel = await box(page, tid('settings-add-account-label'));
    const devAcc = await box(page, tid('settings-login-devices-accessory'));
    const addAcc = await box(page, tid('settings-add-account-accessory'));
    const value = await page.locator(tid('settings-login-devices-value')).innerText().catch(() => '');
    record(vp, '2 phone: 登录设备 row lines up with 添加账号', {
      sameX: Math.abs(dev.x - add.x) <= 0.5, sameW: Math.abs(dev.w - add.w) <= 0.5, below: dev.y >= add.b,
      labelX: Math.abs(devLabel.x - addLabel.x) <= 0.5, chevronRight: Math.abs(devAcc.r - addAcc.r) <= 0.5,
      minH: dev.h >= 48, gutter16: Math.abs(dev.x - 16) <= 1 && Math.abs(viewport.width - dev.r - 16) <= 1,
      count: value === `${TOTAL} 个登录`,
    }, { dev, add, devLabel, addLabel, devAcc, addAcc, value });
  } else {
    const dev = await box(page, entry(true));
    const add = await box(page, tid('settings-add-account-row'));
    const sw = await box(page, tid('settings-switch-account-row'));
    const devLabel = await box(page, `${entry(true)} >> text=登录设备`);
    const swLabel = await box(page, `${tid('settings-switch-account-row')} >> text=切换账号`);
    record(vp, '2 wide: 登录设备 row between 添加账号 and 切换账号, same column', {
      order: add.b <= dev.y && dev.b <= sw.y, sameX: Math.abs(dev.x - sw.x) <= 0.5 && Math.abs(dev.x - add.x) <= 0.5,
      sameW: Math.abs(dev.w - sw.w) <= 0.5, labelX: Math.abs(devLabel.x - swLabel.x) <= 0.5,
    }, { add, dev, sw, devLabel, swLabel });
  }
  const titleBefore = wide ? await box(page, `${tid('settings-pane')} > div:first-child`) : null;

  // 3 the list
  await page.locator(entry(wide)).click();
  await page.locator(tid('login-device-current')).waitFor({ timeout: 8000 });
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${vp}-devices.png`), fullPage: false });
  const rows = await page.locator(itemSel).evaluateAll(els => els.filter(e => e.getBoundingClientRect().height > 0).map(e => e.getAttribute('data-testid')));
  const firstText = await page.locator(tid('login-device-current')).innerText();
  const secondText = await page.locator(tid(rows[1])).innerText();
  const showAll = await page.locator(tid('login-devices-show-all')).isVisible().catch(() => false);
  // 本机 (phone: row value, wide: badge) must be painted, not only in textContent (title-blank: 0px wide, text still right)
  const thisDevice = await paintedText(page, `${tid('login-device-current')} :not(:has(*))`, '本机');
  const content = { current: rows[0] === 'login-device-current', twenty: rows.length === 20, showAll, currentSaysThisDevice: firstText.includes('本机'), thisDevicePainted: !!thisDevice?.painted && thisDevice.w >= 8, secondIsAndroid: /Android · 0\.2\.150/.test(secondText) && /最近使用 2 小时前/.test(secondText) };
  if (!wide) {
    const title = await page.locator(tid('settings-subpage-title')).innerText();
    const titlePaint = await paintedText(page, tid('settings-subpage-title'), '登录设备');
    const g = await page.evaluate((ids) => {
      const out = [];
      for (const id of ids) {
        const row = document.querySelector(`[data-testid="${id}"]`);
        const lab = document.querySelector(`[data-testid="${id}-label"]`);
        const val = document.querySelector(`[data-testid="${id}-value"]`);
        if (!row || !lab || !val) continue;
        const rb = row.getBoundingClientRect(), lb = lab.getBoundingClientRect(), vb = val.getBoundingClientRect();
        if (rb.bottom > window.innerHeight || rb.top < 0) continue; // only what is on screen
        const acc = document.querySelector(`[data-testid="${id}-accessory"]`)?.getBoundingClientRect();
        out.push({ id, group: id.startsWith('login-devices-group-'), accR: acc?.right, rowX: rb.x, rowR: rb.right, h: rb.height, labelX: lb.x, valueR: vb.right, valueCy: vb.y + vb.height / 2, rowCy: rb.y + rb.height / 2 });
      }
      return out;
    }, rows);
    record(vp, '3 phone: list content + geometry', {
      ...content, title: title === '登录设备', titlePainted: !!titlePaint?.painted && titlePaint.w >= 8, visibleRows: g.length >= 8,
      labelsAligned: same(g.map(x => x.labelX), 0.5), valuesRightAligned: same(g.filter(x => !x.group).map(x => x.valueR), 0.5),
      groupChevronsAtValueEdge: g.filter(x => x.group).every(x => Math.abs(x.accR - g.find(y => !y.group).valueR) <= 0.5),
      rowsSameWidth: same(g.map(x => x.rowR - x.rowX), 0.5), rows48: g.every(x => x.h >= 48),
      valueVCentred: g.every(x => Math.abs(x.valueCy - x.rowCy) <= 1),
      gutter16: g.every(x => Math.abs(x.rowX - 16) <= 1 && Math.abs(viewport.width - x.rowR - 16) <= 1),
    }, { rows: rows.length, sample: g.slice(0, 3).map(x => ({ labelX: r1(x.labelX), valueR: r1(x.valueR), h: r1(x.h) })), thisDevice, titlePaint });
  } else {
    const header = await box(page, tid('settings-devices-header'));
    const g = await page.evaluate((ids) => ids.map(id => {
      const row = document.querySelector(`[data-testid="${id}"]`);
      const lab = document.querySelector(`[data-testid="${id}-label"]`);
      const icon = row?.firstElementChild;
      const btn = document.querySelector(`[data-testid="${id}-signout"]`);
      if (!row || !lab || !icon) return null;
      const rb = row.getBoundingClientRect();
      if (rb.bottom > window.innerHeight) return null;
      const ib = icon.getBoundingClientRect(), lb = lab.getBoundingClientRect(), bb = btn?.getBoundingClientRect();
      return { id, iconX: ib.x, iconCy: ib.y + ib.height / 2, labelX: lb.x, btnR: bb ? bb.right : null, btnCy: bb ? bb.y + bb.height / 2 : null, rowCy: rb.y + rb.height / 2, rowR: rb.right };
    }).filter(Boolean), rows);
    const withBtn = g.filter(x => x.btnR != null);
    record(vp, '3 wide: list content + geometry', {
      ...content, headerRuleSameY: !!titleBefore && Math.abs(header.b - titleBefore.b) <= 1, headerSameX: !!titleBefore && Math.abs(header.x - titleBefore.x) <= 0.5 && Math.abs(header.w - titleBefore.w) <= 0.5,
      iconsAligned: same(g.map(x => x.iconX), 0.5), labelsAligned: same(g.map(x => x.labelX), 0.5),
      signOutRightAligned: same(withBtn.map(x => x.btnR), 0.5), currentHasNoSignOut: g[0]?.btnR == null,
      iconsVCentred: g.every(x => Math.abs(x.iconCy - x.rowCy) <= 1), buttonsVCentred: withBtn.every(x => Math.abs(x.btnCy - x.rowCy) <= 1),
      badge: await page.locator(tid('login-device-current-badge')).isVisible(),
    }, { header, titleBefore, sample: g.slice(0, 3), thisDevice });
  }
  await page.locator(tid('login-devices-show-all')).click();
  await sleep(300);
  const allRows = await page.locator(itemSel).count();
  record(vp, '3 显示全部 shows all 25 top-level items', { all: allRows === 25 }, { allRows });

  // 3b groups: 「未命名（多为脚本 / 命令行）」 with its count; a named group (Windows × 3); expanding lists members, 20 + 显示全部
  const UG = 'login-devices-group-unnamed';
  const ug = tid(UG), ugPart = (suffix) => tid(`${UG}-${suffix}`);
  await page.locator(ug).scrollIntoViewIfNeeded();
  const ugLabel = await page.locator(ugPart('label')).innerText();
  const ugPaint = await paintedText(page, ugPart('label'), '未命名（多为脚本 / 命令行）');
  // wide: the count is in the subtitle (「41 个登录 · 最近使用 …」); phone: the value on the right (「41 个登录」), subtitle = 最近使用 …
  const ugCount = wide ? await page.locator(ugPart('subtitle')).innerText() : await page.locator(ugPart('value')).innerText();
  const ugSub = await page.locator(ug).innerText();
  const winGroup = await page.locator(groupSel).filter({ hasText: 'Windows · 0.2.140' }).count();
  const winSingle = await page.locator(rowSel).filter({ hasText: 'Windows · 0.2.140' }).count();
  await page.screenshot({ path: join(OUT, `${vp}-devices-groups.png`) });
  await page.locator(ug).click();
  await sleep(400);
  const groupAll = await page.locator(ugPart('show-all')).isVisible().catch(() => false);
  const mg = await page.evaluate(({ UG }) => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const head = q(UG), hl = q(`${UG}-label`), all = q(`${UG}-show-all`);
    const hb = head.getBoundingClientRect(), ab = all?.getBoundingClientRect();
    // the group's members = session rows laid out between the group head and its own 显示全部
    const ms = [...document.querySelectorAll('[data-testid^="login-device-tok_"]')]
      .filter(e => !/-(label|value|accessory|signout|badge)$/.test(e.getAttribute('data-testid')))
      .map(e => ({ e, b: e.getBoundingClientRect() }))
      .filter(x => x.b.height > 0 && x.b.top >= hb.bottom - 0.5 && (!ab || x.b.bottom <= ab.top + 0.5));
    const m = ms[0];
    const ml = m && document.querySelector(`[data-testid="${m.e.getAttribute('data-testid')}-label"]`);
    return { count: ms.length, headLabelX: hl.getBoundingClientRect().x, memberLabelX: ml?.getBoundingClientRect().x, headR: hb.right, memberR: m?.b.right, memberH: m?.b.height, memberText: m?.e.innerText };
  }, { UG });
  await page.screenshot({ path: join(OUT, `${vp}-devices-group-open.png`) });
  record(vp, '3b groups: 未命名 group with count, named group, expand → members', {
    unnamedLabel: ugLabel === '未命名（多为脚本 / 命令行）', unnamedPainted: !!ugPaint?.painted && ugPaint.w >= 8,
    unnamedCount: wide ? /^41 个登录 · 最近使用 /.test(ugCount) : ugCount === '41 个登录', countSaidOnce: (ugSub.match(/41 个登录/g) ?? []).length === 1, saysLastUsed: /最近使用 \d+ 天前/.test(ugSub),
    windowsIsOneGroup: winGroup === 1 && winSingle === 0,
    twentyMembers: mg.count === 20, groupShowAll: groupAll, memberSaysWhen: /最近使用/.test(mg.memberText ?? '') && /登录于/.test(mg.memberText ?? ''),
    memberSameRight: Math.abs(mg.memberR - mg.headR) <= 0.5,
    memberLabelAligned: Math.abs(mg.memberLabelX - mg.headLabelX) <= 0.5, memberH48: mg.memberH >= 48,
  }, { ugCount, ugSub, mg, ugPaint });
  await page.locator(ug).click();
  await sleep(300);

  // 4 revoke one
  const victim = rows[1];
  if (wide) await page.locator(tid(`${victim}-signout`)).click(); else await page.locator(tid(victim)).click();
  await page.locator(tid('login-devices-confirm')).waitFor({ timeout: 5000 });
  await sleep(500); // Modal fades in
  await page.screenshot({ path: join(OUT, `${vp}-confirm-one.png`) });
  const confirmText = await page.locator(tid('login-devices-confirm')).innerText();
  await page.locator(tid('login-devices-confirm-ok')).click();
  const gone = await waitFor(async () => !(await page.locator(tid(victim)).isVisible()));
  record(vp, '4 退出 one device', { confirmNamesIt: confirmText.includes('Android · 0.2.150') && confirmText.includes('退出这台设备'), deleteCalled: hubA.calls().some(c => c.what === `DELETE /api/auth/sessions/${victim.replace('login-device-', '')}`), gone: !!gone, left: hubA.sessionCount() === TOTAL - 1 });

  // 5 revoke others
  await page.locator(tid('login-devices-revoke-others')).scrollIntoViewIfNeeded();
  if (!wide) {
    const btn = await box(page, tid('login-devices-revoke-others'));
    record(vp, '5 phone: 退出其他所有设备 button is full card width', { gutter16: Math.abs(btn.x - 16) <= 1 && Math.abs(viewport.width - btn.r - 16) <= 1, h48: btn.h >= 48 }, { btn });
  }
  await page.locator(tid('login-devices-revoke-others')).click();
  await page.locator(tid('login-devices-confirm')).waitFor({ timeout: 5000 });
  const confirmOthers = await page.locator(tid('login-devices-confirm')).innerText();
  await sleep(500);
  const okBtn = await page.evaluate((sel) => { const e = document.querySelector(sel); const cs = getComputedStyle(e); const t = e.querySelector('*:not(:has(*))') ?? e; return { bg: cs.backgroundColor, color: getComputedStyle(t).color, text: e.innerText, ...(() => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; })() }; }, tid('login-devices-confirm-ok'));
  const cancelBtn = await box(page, tid('login-devices-confirm-cancel'));
  const okBox = await box(page, tid('login-devices-confirm-ok'));
  const card = await box(page, tid('login-devices-confirm'));
  await page.screenshot({ path: join(OUT, `${vp}-confirm-others.png`) });
  await page.locator(tid('login-devices-confirm-ok')).click();
  const onlyMe = await waitFor(async () => (await page.locator(rowSel).count()) === 1);
  await sleep(300);
  await page.screenshot({ path: join(OUT, `${vp}-after-revoke-others.png`) });
  const body = await page.evaluate(() => document.body.innerText);
  const others2 = TOTAL - 2; // 本机 + 第 4 步退出的那台
  const toast = await paintedText(page, ':not(:has(*))', `已退出 ${others2} 个登录`); // the leaf that holds the text, not a full-width wrapper
  record(vp, '5 退出其他所有设备', { confirmCount: confirmOthers.includes(`将退出其他 ${others2} 个登录，包括脚本和 agent 使用的登录，它们需要重新登录。`), okSaysCount: okBtn.text.trim() === `退出 ${others2} 个登录`, okFilledRed: okBtn.bg === 'rgb(220, 38, 38)' && okBtn.color === 'rgb(255, 255, 255)', buttonsSameRow: Math.abs(okBox.y - cancelBtn.y) <= 0.5 && Math.abs(okBox.h - cancelBtn.h) <= 0.5 && okBox.x > cancelBtn.r, okInsideCard: okBox.r <= card.r + 0.5 && okBox.b <= card.b + 0.5, called: hubA.calls().some(c => c.what === 'POST /api/auth/sessions/revoke-others'), onlyMe: !!onlyMe, serverKeptOne: hubA.sessionCount() === 1, message: body.includes(`已退出 ${others2} 个登录`), messagePainted: !!toast?.painted && toast.w >= 8, noButtonLeft: !(await page.locator(tid('login-devices-revoke-others')).isVisible().catch(() => false)) }, { toast, okBtn, okBox, cancelBtn, card });

  // 6 token_expired → login page says so
  await fetch(`${hubA.url}/__expire`, { method: 'POST' });
  if (!wide) await page.locator(tid('settings-back')).click().catch(() => {});
  await page.locator(tid('mobile-tab-agents')).click().catch(() => {});
  const expiredShown = await waitFor(async () => page.locator(tid('login-expired-title')).isVisible(), 30000);
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${vp}-expired-login.png`) });
  const expiredTitle = expiredShown ? await page.locator(tid('login-expired-title')).innerText() : '';
  await login(page, hubA, 'alice', 'pw-a', { reauth: true });
  record(vp, '6 token_expired → 登录已过期，请重新登录 → sign in again', { shown: !!expiredShown, title: expiredTitle === '登录已过期，请重新登录', backIn: await page.locator(tid('mobile-tab-bar')).isVisible() }, { expiredTitle });

  // 8 switcher shows an expired saved account
  await openSettings(page);
  await page.locator(tid(wide ? 'settings-switch-account-row' : 'settings-switch-account-block')).click();
  await page.locator(tid('account-switch-add')).click();
  await login(page, hubB, 'bob', 'pw-b');
  await fetch(`${hubA.url}/__expire`, { method: 'POST' }); // A's saved token (the re-login one) now expires
  await openSettings(page);
  await page.locator(tid(wide ? 'settings-switch-account-row' : 'settings-switch-account-block')).click();
  await page.locator(tid(wide ? 'account-switch-dialog' : 'account-switch-sheet')).waitFor({ timeout: 5000 });
  const flagged = await waitFor(async () => (await page.locator(`[data-testid^="account-switch-row-"]:has-text("alice @")`).innerText()).includes('登录已失效'), 10000);
  await page.screenshot({ path: join(OUT, `${vp}-switcher-expired.png`) });
  const bobRow = await page.locator(`[data-testid^="account-switch-row-"]:has-text("bob @")`).innerText();
  const tag = await paintedText(page, '[data-testid^="account-switch-row-"] :not(:has(*))', '登录已失效，点一下重新验证');
  record(vp, '8 switcher: expired saved account shows as needing re-login', { aliceFlagged: !!flagged, tagPainted: !!tag?.painted && tag.w >= 8, bobCurrentNotFlagged: !bobRow.includes('登录已失效') }, { tag });
  await page.keyboard.press('Escape').catch(() => {});
  await ctx.close();
  hubA.close(); hubB.close();

  // 7 old hub
  const hubL = await startMockHub({ name: `l${vp}`, username: 'lee', password: 'pw-l', networkId: 'net_mock_l', agents: ['legacy-agent'], legacy: true });
  const ctx2 = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2 });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page2.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await login(page2, hubL, 'lee', 'pw-l');
  await openAccount(page2, wide);
  await sleep(1500);
  await page2.screenshot({ path: join(OUT, `${vp}-old-hub-account.png`) });
  record(vp, '7 old hub (200 text/plain): no 登录设备 entry', { hidden: !(await page2.locator(entry(wide)).isVisible().catch(() => false)), otherRowsThere: await page2.locator(tid(wide ? 'settings-switch-account-row' : 'settings-add-account')).isVisible() });
  await ctx2.close();
  hubL.close();
}

await run('phone-390', { width: 390, height: 844 }, ANDROID_UA, false);
await run('wide-1200', { width: 1200, height: 800 }, MAC_UA, true);
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
