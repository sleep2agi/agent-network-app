// RFC-038 第 1 步(G1 可访问范围切换 / G2 viewer 不出可对话 / G3 改角色 + 移出),对**真的一次性 hub** 端到端。
// Not in CI: needs Playwright + Chromium, a web export, and a throwaway hub seeded by seed.mjs
// (HOME=$(mktemp -d), port ≠ 9200, temp DB). Refuses to run against 9200.
//
//   SEED=<seed.json> VP=wide|phone WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-grant-mode-switch/drive.mjs
//
// 1  admin 登录 → 设置 → 用户管理:「升级前」成员 legacy_bob 显示「全部 Agent」
// 2  点进成员:范围 = 全部 Agent,清单不可点
// 3  切到「仅指定 Agent」→ 预填 3 个 → 取消两个只留 e2e-alpha → 保存
// 4  hub 上核对(用 bob 自己的令牌):/api/status 只剩 e2e-alpha;给 e2e-beta 派活 403;给 e2e-alpha 派活 200
// 5  改角色为只读成员:可对话开关消失、显示只读 → 保存 → hub 上 role=viewer、授权 can_message=false
// 6  移出网络:确认 → hub 上成员没了,bob 看不到任何 Agent
// 以及每一步新控件的 boundingBox(对齐 / 边距)。截图进 OUT。任何断言失败 exit 1。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, SEED, VP } = process.env;
if (!WEB || !OUT || !SEED || !VP) throw new Error('need WEB_DIR OUT SEED VP');
const seed = JSON.parse(readFileSync(SEED, 'utf8'));
if (new URL(seed.hub).port === '9200') throw new Error('refusing to run against 9200');
mkdirSync(OUT, { recursive: true });
const wide = VP === 'wide';
const viewport = wide ? { width: 1200, height: 800 } : { width: 390, height: 844 };
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const web = await serveExport(WEB);

const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const measures = [];
function record(what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp: VP, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
}
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height), cy: r1(b.y + b.height / 2) }; };
const near = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;
const api = async (token, method, path, body) => {
  const res = await fetch(`${seed.hub}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, body: data };
};
const NET = seed.network_id;
const bobSees = async () => {
  const r = await api(seed.bob_token, 'GET', `/api/status?network_id=${NET}`);
  return { status: r.status, aliases: (r.body?.sessions ?? []).map(s => s.alias).filter(a => a.startsWith('e2e-')).sort() };
};
const bobSend = (alias) => api(seed.bob_token, 'POST', '/api/task', { alias, task: `e2e probe to ${alias}`, network_id: NET });
const grants = () => api(seed.admin_token, 'GET', `/api/networks/${NET}/members/${seed.bob_user_id}/agent-grants`);

// the real hub only allows its configured CORS origins; the export is served from a random localhost port.
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });
const ctx = await browser.newContext({ viewport, userAgent: wide ? MAC_UA : ANDROID_UA, deviceScaleFactor: 2, locale: 'zh-CN' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);

// ── login ──
await page.locator(tid('login-screen')).waitFor({ timeout: 30000 });
await page.getByLabel('服务器地址', { exact: true }).fill(seed.hub);
await page.getByLabel('用户名', { exact: true }).fill(seed.admin_user);
await page.getByLabel('密码', { exact: true }).fill(seed.password);
await page.locator(tid('login-submit')).click();
await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 20000 }).catch(async () => { await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-0-login-fail.png`) }); throw new Error('login did not reach the workspace'); });

async function openUsers() {
  await page.locator(tid('mobile-tab-settings')).click();
  await page.locator(tid('settings-phone-list') + ',' + tid('settings-pane') + ',' + tid('settings-back')).first().waitFor({ timeout: 8000 });
  for (let i = 0; i < 3 && await page.locator(tid('settings-back')).isVisible().catch(() => false); i++) { await page.locator(tid('settings-back')).click(); await sleep(200); }
  if (wide) await page.locator(tid('settings-sidebar')).getByText('用户管理', { exact: true }).click();
  else { await page.locator(tid('settings-row-users')).click(); await page.locator(tid('settings-subpage-users')).waitFor({ timeout: 5000 }); }
  await page.locator(tid('user-row-legacy_bob')).waitFor({ timeout: 10000 });
  await sleep(300);
}
const rowValue = () => page.locator(tid('user-row-legacy_bob-value')).innerText().catch(() => '');
async function openBob() {
  await page.locator(tid('user-row-legacy_bob')).click();
  await page.locator(tid(wide ? 'grants-dialog' : 'member-page')).waitFor({ timeout: 8000 });
  await page.locator(tid('grant-toggle-e2e-alpha')).waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(400);
}
// wide: aria-checked on the dialog's own radios / checkboxes. phone: settings-kit's SettingsChoiceRow draws a ✓ in its accessory column.
const checked = async (id) => {
  const aria = await page.locator(tid(id)).getAttribute('aria-checked');
  if (aria != null) return aria;
  return String((await page.locator(`${tid(`${id}-accessory`)} *`).count()) > 0);
};
const countText = () => page.locator(tid(wide ? 'grants-count' : 'member-page-agents')).innerText().catch(() => '');

// 1
await openUsers();
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-1-members.png`) });
record('1 legacy member row reads 全部 Agent', { all: (await rowValue()) === '全部 Agent' }, { value: await rowValue() });

// 2
await openBob();
if (!wide) record('2 phone: member page is a settings 三级页 titled 成员', { title: (await page.locator(tid('settings-subpage-title')).innerText()) === '成员' });
record('2 opens on 全部 Agent', { all: (await checked('grants-mode-all')) === 'true', notGranted: (await checked('grants-mode-granted')) === 'false' });
if (wide) {
  const disabled = await page.locator(tid('grant-toggle-e2e-alpha')).getAttribute('aria-disabled');
  record('2 wide: list is inactive under 全部 Agent', { disabled: disabled === 'true' });
} else {
  record('2 phone: agent list hidden under 全部 Agent', { hidden: (await page.locator(tid('member-page-agents')).count()) === 0 });
}
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-2-member-all.png`) });

// 3
await page.locator(tid('grants-mode-granted')).click();
await sleep(300);
const pre = await countText();
record('3 switching to 仅指定 prefills the 3 visible agents', { three: pre.includes('已选 3 个'), alphaOn: (await checked('grant-toggle-e2e-alpha')) === 'true' }, { count: pre });
await page.locator(tid('grant-toggle-e2e-beta')).click();
await page.locator(tid('grant-toggle-e2e-gamma')).click();
await sleep(200);
record('3 unchecked two → 1 selected', { one: (await countText()).includes('已选 1 个') });
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-3-member-granted.png`) });

// geometry of the new controls
if (wide) {
  const card = await box(page, tid('grants-dialog'));
  const role = await box(page, tid('member-role'));
  const mode = await box(page, tid('grants-mode'));
  const search = await box(page, `${tid('grants-dialog')} ${tid('grants-search')}`);
  const list = await box(page, tid('grants-list'));
  const removeBtn = await box(page, tid('member-remove-open'));
  const save = await box(page, tid('grants-confirm'));
  const cancel = await box(page, tid('grants-cancel'));
  const hint = await box(page, tid('grants-mode-hint'));
  const pad = role && card ? r1(role.x - card.x) : null;
  const m = { card, role, mode, list, removeBtn, save, cancel, hint, contentPad: pad };
  measures.push({ step: 'wide member dialog', ...m });
  record('G wide: dialog centred horizontally', { centred: near(card.x, viewport.width - card.r) }, { L: card.x, R: r1(viewport.width - card.r), w: card.w });
  record('G wide: role / mode segmented share the content column with the list', {
    leftRole: near(role.x, list.x), leftMode: near(mode.x, list.x), rightRole: near(role.r, list.r), rightMode: near(mode.r, list.r),
    padL: near(role.x - card.x, 16, 1.5), padR: near(card.r - role.r, 16, 1.5),
  }, { roleX: role.x, modeX: mode.x, listX: list.x, roleR: role.r, modeR: mode.r, listR: list.r, padL: r1(role.x - card.x), padR: r1(card.r - role.r) });
  record('G wide: 移出网络 sits on the content left edge, vertically centred with 保存; 保存 on the right edge', {
    removeLeft: near(removeBtn.x, list.x), sameRow: near(removeBtn.cy, save.cy), saveRight: near(save.r, list.r),
  }, { removeX: removeBtn.x, removeCy: removeBtn.cy, saveCy: save.cy, saveR: save.r, listR: list.r });
  const readTag = await page.locator(tid('grant-can-message-e2e-alpha')).count();
  record('G wide: member still gets the 可对话 switch', { sw: readTag === 1 });
} else {
  const rows = ['grants-mode-all', 'grants-mode-granted', 'member-role-member', 'member-role-viewer', 'member-role-admin', 'grant-toggle-e2e-alpha', 'grants-confirm', 'member-remove-open'];
  const b = {};
  for (const id of rows) b[id] = await box(page, tid(id));
  const sw = await box(page, tid('grant-can-message-e2e-alpha'));
  measures.push({ step: 'phone member page', ...b, chatSwitchRow: sw });
  const g = Object.entries(b).map(([id, x]) => ({ id, L: x?.x, R: x ? r1(viewport.width - x.r) : null, h: x?.h }));
  record('G phone: every new row / button has 16 / 16 gutters', { gutters: g.every(x => near(x.L, 16) && near(x.R, 16)) }, { rows: g });
  record('G phone: rows and buttons ≥ 48 tall', { h48: g.every(x => x.h >= 48) }, { heights: g.map(x => `${x.id}:${x.h}`).join(' ') });
  const labels = [];
  for (const id of ['grants-mode-all', 'grants-mode-granted', 'member-role-member', 'grant-toggle-e2e-alpha']) labels.push((await box(page, tid(`${id}-label`)))?.x);
  const accs = [];
  for (const id of ['grants-mode-all', 'grants-mode-granted', 'member-role-member', 'grant-toggle-e2e-alpha']) accs.push((await box(page, tid(`${id}-accessory`)))?.r);
  record('G phone: labels share one left edge, ✓ column shares one right edge', { labels: labels.every(x => near(x, labels[0])), ticks: accs.every(x => near(x, accs[0])) }, { labelX: labels, tickR: accs });
  await page.locator(tid('member-remove-open')).scrollIntoViewIfNeeded();
  await sleep(300);
  await page.screenshot({ path: join(OUT, `${VP}-3b-member-bottom.png`) });
  record('G phone: 可对话 group has a switch row for the picked agent', { sw: !!sw && near(sw.x, 16) && near(viewport.width - sw.r, 16) }, { sw });
}

// save
await page.locator(tid('grants-confirm')).click();
if (wide) await page.locator(tid('grants-dialog')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
else await page.locator(tid('member-page')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await sleep(800);
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-4-after-save.png`) });
record('3 row now reads 1 个 Agent', { one: (await rowValue()) === '1 个 Agent' }, { value: await rowValue() });

// 4 hub
{
  const g = await grants();
  const sees = await bobSees();
  const beta = await bobSend('e2e-beta');
  const nope = await bobSend('e2e-does-not-exist');
  const alpha = await bobSend('e2e-alpha');
  record('4 hub: agent_access=granted, restricted', { granted: g.body?.agent_access === 'granted', restricted: g.body?.restricted === true, oneGrant: g.body?.grants?.length === 1 }, { grants: g.body?.grants });
  record('4 hub: bob /api/status lists only e2e-alpha', { only: JSON.stringify(sees.aliases) === JSON.stringify(['e2e-alpha']) }, sees);
  record('4 hub: send to e2e-beta → 403 agent_not_granted', { s403: beta.status === 403, code: beta.body?.error === 'agent_not_granted' }, { status: beta.status, error: beta.body?.error });
  record('4 hub: 403 is identical to a nonexistent alias', { same: nope.status === beta.status && JSON.stringify(nope.body) === JSON.stringify(beta.body) });
  record('4 hub: send to e2e-alpha → 200', { s200: alpha.status === 200 }, { status: alpha.status, error: alpha.body?.error });
}

// 5 role → viewer
await openBob();
await page.locator(tid('member-role-viewer')).click();
await sleep(300);
if (wide) {
  record('5 wide: viewer → 可对话 switch gone, 只读 shown', { noSwitch: (await page.locator(tid('grant-can-message-e2e-alpha')).count()) === 0, readOnly: (await page.locator(tid('grant-read-only-e2e-alpha')).count()) === 1 });
  const ro = await box(page, tid('grant-read-only-e2e-alpha'));
  const list = await box(page, tid('grants-list'));
  const row = await box(page, tid('grant-row-e2e-alpha'));
  measures.push({ step: 'wide viewer tag', readOnly: ro, row, list });
  record('G wide: 只读 tag right-aligned in the row, vertically centred', { right: near(ro.r, row.r, 1.5), mid: near(ro.cy, row.cy, 1.5) }, { tagR: ro.r, rowR: row.r, tagCy: ro.cy, rowCy: row.cy });
} else {
  record('5 phone: viewer → 可对话 group gone', { noGroup: (await page.locator(tid('member-page-chat')).count()) === 0 });
}
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-5-viewer.png`) });
await page.locator(tid('grants-confirm')).click();
await sleep(1500);
{
  const members = await api(seed.admin_token, 'GET', `/api/networks/${NET}/members`);
  const bob = (members.body?.members ?? []).find(m => m.user_id === seed.bob_user_id);
  const g = await grants();
  const alpha = await bobSend('e2e-alpha');
  record('5 hub: role=viewer, grant kept, can_message=false; viewer send → 403', { viewer: bob?.role === 'viewer', kept: g.body?.grants?.length === 1, readOnly: g.body?.grants?.every(x => x.can_message === false), s403: alpha.status === 403 }, { role: bob?.role, grants: g.body?.grants, send: alpha.status });
}

// 6 remove
await openBob();
await page.locator(tid('member-remove-open')).click();
await page.locator(tid('member-remove-confirm')).waitFor({ timeout: 5000 });
record('6 confirm step shown before anything is sent', { stillMember: (await api(seed.admin_token, 'GET', `/api/networks/${NET}/members`)).body?.members?.some(m => m.user_id === seed.bob_user_id) === true });
await sleep(400);
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-6-remove-confirm.png`) });
if (!wide) {
  const sheet = await box(page, tid('member-remove-sheet'));
  measures.push({ step: 'phone remove sheet', sheet });
  record('G phone: remove sheet is a full-width bottom sheet', { full: near(sheet.x, 0) && near(sheet.w, viewport.width), bottom: near(sheet.b, viewport.height, 2) }, { sheet });
}
await page.locator(tid('member-remove-confirm')).click();
await sleep(1500);
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-7-removed.png`) });
{
  const members = await api(seed.admin_token, 'GET', `/api/networks/${NET}/members`);
  const gone = !(members.body?.members ?? []).some(m => m.user_id === seed.bob_user_id);
  const sees = await bobSees();
  record('6 hub: bob removed; sees no e2e agent', { gone, none: sees.aliases.length === 0 }, sees);
  record('6 UI: row gone', { gone: (await page.locator(tid('user-row-legacy_bob')).count()) === 0 });
}

console.log('MEASURES ' + JSON.stringify(measures));
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
