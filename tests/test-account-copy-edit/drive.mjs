// 设置 → 账号:每行的「复制」「编辑」(Vincent 2026-09-30「账号 支持一下复制 编辑」), end to end on the web export
// against mock hubs on throwaway ports (tests/test-account-switch/mock-hub.mjs). Never touches a real hub.
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-account-copy-edit/drive.mjs
//
// Wide 1320×754 (desktop rows: 复制 · 编辑 · 移除 at the end of each row) and phone 390×844 (Android UA: 管理账号 →
// tap a row → bottom action sheet). For each:
//   1  sign in to hub A, add hub B (current = B)
//   2  geometry of the row actions (wide) / the action sheet (phone), boundingBox
//   3  复制 → clipboard is exactly 「<hub> · <user> · <network>」, no token anywhere; 「已复制」 toast shows
//   4  编辑 a non-current account's label → saved in place, current account unchanged
//   5  编辑 the current account's Hub address: bad URL / unreachable / token rejected (+ 重新登录) / another user → not saved;
//      the moved hub → saved, the app reconnects to it (SSE moves from B to B2) and stays in settings
//   6  reload: still signed in to the edited account on the new address; the other account's credentials are byte-identical
// Screenshots go to OUT. Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { startMockHub } from '../test-account-switch/mock-hub.mjs';
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
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }; };
const cy = (b) => b.y + b.h / 2;
const cx = (b) => b.x + b.w / 2;

async function runViewport(vp, viewport, ua, wide) {
  // Fresh hubs per viewport so SSE counts start at zero.
  const hubA = await startMockHub({ name: 'a', username: 'alice', password: 'pw-a', token: 'utok_mock_alice', networkId: 'net_mock_a', agents: ['alpha-agent-a1'], tasks: ['task-only-in-hub-A'] });
  const hubB = await startMockHub({ name: 'b', username: 'bob', password: 'pw-b', token: 'utok_mock_bob', networkId: 'net_mock_b', agents: ['bravo-agent-b1'], tasks: ['task-only-in-hub-B'] });
  // B moved: same account (same token, same username) on a new address.
  const hubB2 = await startMockHub({ name: 'b2', username: 'bob', password: 'pw-b', token: 'utok_mock_bob', networkId: 'net_mock_b', agents: ['bravo-agent-b1-moved'], tasks: ['task-only-in-hub-B'] });
  // A hub that does not know B's token.
  const hubR = await startMockHub({ name: 'r', username: 'bob', password: 'pw-b', token: 'utok_other_hub', networkId: 'net_mock_r', agents: [], tasks: [] });
  // A hub where B's token is valid but belongs to someone else.
  const hubX = await startMockHub({ name: 'x', username: 'mallory', password: 'pw-x', token: 'utok_mock_bob', networkId: 'net_mock_x', agents: [], tasks: [] });
  const DEAD = 'http://127.0.0.1:1';

  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_URL });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);

  const login = async (hub, user, pw) => {
    await page.locator(tid('login-screen')).waitFor({ timeout: 30000 });
    await page.getByLabel('服务器地址', { exact: true }).fill(hub.url);
    await page.getByLabel('用户名', { exact: true }).fill(user);
    await page.getByLabel('密码', { exact: true }).fill(pw);
    await page.locator(tid('login-submit')).click();
    await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 15000 });
  };
  const openSettings = async () => {
    await page.locator(tid('mobile-tab-settings')).click();
    await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane')).first().waitFor({ timeout: 8000 });
  };
  const readStore = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('hub_')) o[k] = localStorage.getItem(k); } return o; });
  const profilesNow = async () => JSON.parse((await readStore()).hub_sessions_v2 ?? '{"sessions":[]}');

  // 1. A, then add B
  await login(hubA, 'alice', 'pw-a');
  await openSettings();
  await page.locator(tid(wide ? 'settings-switch-account-row' : 'settings-switch-account-block')).click();
  await page.locator(tid('account-switch-add')).click();
  await login(hubB, 'bob', 'pw-b');
  const idx = await profilesNow();
  const idA = idx.sessions.find(s => s.username === 'alice')?.id;
  const idB = idx.sessions.find(s => s.username === 'bob')?.id;
  record(vp, '1 two accounts, B current', { two: idx.sessions.length === 2, currentB: idx.active === idB, ids: !!idA && !!idB }, { idA, idB });

  // Page that shows the account actions.
  const openAccounts = async () => {
    await openSettings();
    if (!wide) {
      if (!(await page.locator(tid('settings-manage-accounts-list')).isVisible().catch(() => false))) {
        if (!(await page.locator(tid('settings-manage-accounts')).isVisible().catch(() => false))) await page.locator(tid('settings-row-account')).click();
        await page.locator(tid('settings-manage-accounts')).click();
        await page.locator(tid('settings-manage-accounts-list')).waitFor({ timeout: 5000 });
      }
    } else {
      const acct = page.locator(tid('settings-category-account'));
      if (await acct.isVisible().catch(() => false)) await acct.click();
      await page.locator(tid(`settings-copy-${idA}`)).waitFor({ timeout: 5000 });
    }
    await sleep(300);
  };
  const act = async (id, action) => {
    if (wide) { await page.locator(tid(`settings-${action}-${id}`)).click(); return; }
    await page.locator(tid(`settings-manage-${id}`)).click();
    await page.locator(tid('account-sheet')).waitFor({ timeout: 5000 });
    await sleep(350); // slide-in
    await page.locator(tid(`account-sheet-${action}`)).click();
  };

  // 2. geometry
  await openAccounts();
  await page.screenshot({ path: join(OUT, `${vp}-accounts.png`) });
  if (wide) {
    const rows = [];
    for (const id of [idA, idB]) {
      const copy = await box(page, tid(`settings-copy-${id}`));
      const edit = await box(page, tid(`settings-edit-${id}`));
      const rm = await box(page, tid(`settings-remove-${id}`));
      const row = await page.locator(tid(`settings-copy-${id}`)).evaluate(e => { const r = e.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const label = await page.locator(tid(`settings-copy-${id}`)).evaluate(e => { const r = e.parentElement.firstElementChild.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      rows.push({ id, copy, edit, rm, row, label });
    }
    const [a, b] = rows;
    const rowChecks = {};
    for (const [n, r] of [['A', a], ['B', b]]) {
      rowChecks[`${n}_buttonsCentredInRow`] = [r.copy, r.edit, r.rm].every(bb => bb && Math.abs(cy(bb) - (r.row.y + r.row.h / 2)) <= 1);
      rowChecks[`${n}_order_copy_edit_remove`] = r.copy.x + r.copy.w <= r.edit.x && r.edit.x + r.edit.w <= r.rm.x;
      rowChecks[`${n}_equalGaps`] = Math.abs((r.edit.x - (r.copy.x + r.copy.w)) - (r.rm.x - (r.edit.x + r.edit.w))) <= 1;
      rowChecks[`${n}_buttonsRightOfText`] = r.label.x + r.label.w <= r.copy.x;
    }
    rowChecks.sameColumnsAcrossRows = Math.abs(a.copy.x - b.copy.x) <= 0.5 && Math.abs(a.edit.x - b.edit.x) <= 0.5 && Math.abs(a.rm.x - b.rm.x) <= 0.5;
    // Row heights are not compared: a label with 「· 当前」 renders ~2px taller (CJK fallback line box) — that is the
    // pre-existing label, not the new buttons. The buttons are centred in their own row (checked above).
    record(vp, '2 wide: row actions geometry', rowChecks, { rows });
    await page.locator(tid(`settings-copy-${idB}`)).evaluate(e => e.parentElement.setAttribute('data-shot', 'rowB'));
    await page.locator('[data-shot="rowB"]').screenshot({ path: join(OUT, `${vp}-row-current.png`) });
  } else {
    const list = await box(page, tid('settings-manage-accounts-list'));
    const rA = await box(page, tid(`settings-manage-${idA}`));
    const rB = await box(page, tid(`settings-manage-${idB}`));
    await page.locator(tid(`settings-manage-${idA}`)).click();
    await page.locator(tid('account-sheet')).waitFor({ timeout: 5000 });
    await sleep(500);
    const sheet = await box(page, tid('account-sheet'));
    const btns = {};
    for (const k of ['copy', 'edit', 'remove', 'cancel']) btns[k] = await box(page, tid(`account-sheet-${k}`));
    const labelCentres = await page.locator('[data-testid^="account-sheet-"][role="button"]').evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); const t = e.firstElementChild.getBoundingClientRect(); return { dx: (t.x + t.width / 2) - (b.x + b.width / 2), dy: (t.y + t.height / 2) - (b.y + b.height / 2) }; }));
    record(vp, '2 phone: manage rows + action sheet geometry', {
      rowsSameColumn: Math.abs(rA.x - rB.x) <= 0.5 && Math.abs(rA.w - rB.w) <= 0.5,
      rowsSymmetricInset: Math.abs(rA.x - (viewport.width - rA.x - rA.w)) <= 0.5,
      rowsAtLeast48: rA.h >= 48 && rB.h >= 48,
      sheetAtBottom: Math.abs(sheet.y + sheet.h - viewport.height) <= 1,
      sheetFullWidth: Math.abs(sheet.w - viewport.width) <= 1 && sheet.x === 0,
      buttonsFullWidth: Object.values(btns).every(bb => Math.abs(bb.w - viewport.width) <= 1),
      buttonsAtLeast56: Object.values(btns).every(bb => bb.h >= 56),
      orderCopyEditRemoveCancel: btns.copy.y < btns.edit.y && btns.edit.y < btns.remove.y && btns.remove.y < btns.cancel.y,
      cancelSeparated: btns.cancel.y - (btns.remove.y + btns.remove.h) >= 7.5,
      labelsCentred: labelCentres.every(c => Math.abs(c.dx) <= 1 && Math.abs(c.dy) <= 1),
    }, { list, rowA: rA, rowB: rB, sheet, btns, labelCentres });
    await page.screenshot({ path: join(OUT, `${vp}-action-sheet.png`) });
    await page.locator(tid('account-sheet-cancel')).click();
    await sleep(400);
  }

  // 3. copy A
  await act(idA, 'copy');
  const toast = await waitFor(async () => (await page.locator(tid('account-toast')).isVisible().catch(() => false)) ? await box(page, tid('account-toast')) : null, 3000);
  await page.screenshot({ path: join(OUT, `${vp}-copied-toast.png`) });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const wantClip = `${hubA.url} · alice · net_mock_a`;
  record(vp, '3 复制 → clipboard line, no secrets, 已复制 toast', {
    exact: clip === wantClip,
    noToken: !/utok_|Bearer|pw-/.test(clip),
    toastShown: !!toast,
    toastText: toast ? (await page.locator(tid('account-toast')).innerText()) === '已复制' : false,
    toastCentred: !!toast && Math.abs(cx(toast) - viewport.width / 2) <= 1,
  }, { clip, toast });
  await sleep(1600);
  const toastGone = !(await page.locator(tid('account-toast')).isVisible().catch(() => false));
  record(vp, '3 toast goes away by itself', { toastGone });

  // 4. edit A's label (A is not current)
  const storeBefore = await readStore();
  await act(idA, 'edit');
  await page.locator(tid('account-edit-dialog')).waitFor({ timeout: 5000 });
  await sleep(300);
  // dialog geometry
  const dlg = await box(page, tid('account-edit-dialog'));
  const nameIn = await box(page, tid('account-edit-name'));
  const serverIn = await box(page, tid('account-edit-server'));
  const save = await box(page, tid('account-edit-save'));
  const cancel = await box(page, tid('account-edit-cancel'));
  const saveDisabledUntouched = await page.locator(tid('account-edit-save')).getAttribute('aria-disabled');
  record(vp, '4 edit dialog geometry', {
    centredX: Math.abs(cx(dlg) - viewport.width / 2) <= 1,
    insideSideMargins: dlg.x >= 15.5 && dlg.x + dlg.w <= viewport.width - 15.5,
    inputsSameLeftAndWidth: Math.abs(nameIn.x - serverIn.x) <= 0.5 && Math.abs(nameIn.w - serverIn.w) <= 0.5,
    buttonsSameRowAndHeight: Math.abs(cy(save) - cy(cancel)) <= 0.5 && Math.abs(save.h - cancel.h) <= 0.5,
    saveRightAligned: Math.abs((save.x + save.w) - (serverIn.x + serverIn.w)) <= 1,
    saveDisabledUntilChanged: saveDisabledUntouched === 'true',
  }, { dlg, nameIn, serverIn, save, cancel });
  await page.locator(tid('account-edit-name')).fill('Alice work');
  await page.screenshot({ path: join(OUT, `${vp}-edit-dialog.png`) });
  await page.locator(tid('account-edit-save')).click();
  await page.locator(tid('account-edit-dialog')).waitFor({ state: 'detached', timeout: 5000 });
  const afterLabel = await readStore();
  const idxL = JSON.parse(afterLabel.hub_sessions_v2);
  const credA0 = JSON.parse(storeBefore[`hub_session_${idA}`] ?? storeBefore.hub_config_v1);
  const credA1 = JSON.parse(afterLabel[`hub_session_${idA}`] ?? afterLabel.hub_config_v1);
  // the leaf holding 「Alice work」 must be painted (≥ 8px after overflow clipping), not only present in textContent
  const labelPaint = await paintedText(page, `${wide ? '' : `${tid(`settings-manage-${idA}`)} `}:not(:has(*))`, 'Alice work');
  record(vp, '4 label-only edit on a non-current account', {
    labelSaved: idxL.sessions.find(s => s.id === idA)?.displayName === 'Alice work',
    samePosition: idxL.sessions.map(s => s.id).join() === idx.sessions.map(s => s.id).join(),
    stillOnB: idxL.active === idB,
    tokenKept: credA1.token === credA0.token && credA1.serverUrl === credA0.serverUrl,
    otherUntouched: afterLabel[`hub_session_${idB}`] === storeBefore[`hub_session_${idB}`],
    rowShowsLabel: wide ? (await page.getByText('Alice work', { exact: true }).count()) > 0 : (await page.locator(tid(`settings-manage-${idA}`)).innerText()).includes('Alice work'),
    labelPainted: !!labelPaint?.painted && labelPaint.w >= 8,
  }, { labelPaint });

  // 5. edit B (current) Hub address
  const credB0 = afterLabel[`hub_session_${idB}`];
  await act(idB, 'edit');
  await page.locator(tid('account-edit-dialog')).waitFor({ timeout: 5000 });
  const tryServer = async (url) => {
    await page.locator(tid('account-edit-server')).fill(url);
    await page.locator(tid('account-edit-save')).click();
    return waitFor(async () => {
      if (!(await page.locator(tid('account-edit-dialog')).isVisible().catch(() => false))) return { closed: true };
      const err = page.locator(tid('account-edit-error'));
      if (await err.isVisible().catch(() => false)) return { kind: await err.getAttribute('data-kind'), text: await err.innerText() };
      return null;
    }, 15000);
  };
  const cases = [['bad-url', 'ht tp://bad url'], ['unreachable', DEAD], ['token-rejected', hubR.url], ['other-user', hubX.url]];
  for (const [want, url] of cases) {
    const res = await tryServer(url);
    const relogin = await page.locator(tid('account-edit-relogin')).isVisible().catch(() => false);
    const unchanged = (await readStore())[`hub_session_${idB}`] === credB0;
    await page.screenshot({ path: join(OUT, `${vp}-edit-${want}.png`) });
    record(vp, `5 ${want} → shown, not saved`, { kind: res?.kind === want, dialogStillOpen: !res?.closed, notSaved: unchanged, reloginOnlyWhenTokenRejected: relogin === (want === 'token-rejected') }, { res });
    if (want === 'token-rejected') {
      const err = await box(page, tid('account-edit-error'));
      const rl = await box(page, tid('account-edit-relogin'));
      const sv = await box(page, tid('account-edit-save'));
      record(vp, '5 重新登录 sits on the button row, left', { sameRow: Math.abs(cy(rl) - cy(sv)) <= 0.5, sameHeight: Math.abs(rl.h - sv.h) <= 0.5, leftOfSave: rl.x + rl.w < sv.x, errorAboveButtons: err.y + err.h <= rl.y }, { err, relogin: rl, save: sv });
    }
  }
  const sseB0 = hubB.sse().open;
  const res = await tryServer(hubB2.url);
  const moved = await waitFor(async () => (hubB2.sse().open === 1 && hubB.sse().open === 0) ? { b: hubB.sse(), b2: hubB2.sse() } : null, 10000);
  const store2 = await readStore();
  const credB1 = JSON.parse(store2[`hub_session_${idB}`]);
  const stillInSettings = await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane') + ',' + tid('settings-manage-accounts-list')).first().isVisible().catch(() => false);
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${vp}-edited-current.png`) });
  record(vp, '5 moved hub → saved in place, reconnected, still in settings', {
    closed: !!res?.closed,
    newAddress: credB1.serverUrl === hubB2.url,
    tokenKept: credB1.token === JSON.parse(credB0).token,
    stillCurrent: JSON.parse(store2.hub_sessions_v2).active === idB,
    samePosition: JSON.parse(store2.hub_sessions_v2).sessions.map(s => s.id).join() === idx.sessions.map(s => s.id).join(),
    sseMoved: !!moved, sseWasOnB: sseB0 === 1,
    stillInSettings,
    aUntouched: store2[`hub_session_${idA}`] === afterLabel[`hub_session_${idA}`],
    noTokenInIndex: !store2.hub_sessions_v2.includes('utok_'),
  }, { sse: moved || { b: hubB.sse(), b2: hubB2.sse() } });

  // 6. reload
  await page.reload();
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 20000 });
  const reloaded = await waitFor(async () => hubB2.sse().open === 1 ? hubB2.sse() : null, 10000);
  record(vp, '6 reload: signed in to the edited account on its new address', { noLogin: !(await page.locator(tid('login-screen')).isVisible().catch(() => false)), sseOnB2: !!reloaded });

  await ctx.close();
  for (const h of [hubA, hubB, hubB2, hubR, hubX]) h.close();
}

await runViewport('wide-1320x754', { width: 1320, height: 754 }, MAC_UA, true);
await runViewport('phone-390x844', { width: 390, height: 844 }, ANDROID_UA, false);

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
web.close();
console.log(failures ? `\nFAIL ${failures} check group(s)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
