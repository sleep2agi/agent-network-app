// 授权批量勾选(Vincent 2026-09-30「可以设置为全部或者是分组…而不是一个一个去选」):按机器 / 按类型 / 全选搜索结果 / 清空,
// 对**真的一次性 hub** 端到端(同一个 seed.mjs:3 个 Agent,host-a = alpha(codex) + beta(claude-code),host-b = gamma(codex))。
// Not in CI: needs Playwright + Chromium, a web export, and a throwaway hub seeded by seed.mjs
// (HOME=$(mktemp -d), port ≠ 9200, temp DB). Refuses to run against 9200.
//
//   SEED=<seed.json> VP=wide|phone WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-grant-mode-switch/bulk.mjs
//
// 1  仅指定 → 清空 → 已选 0
// 2  按机器:host-a 组三态 = 没选 → 点组 → 全选(alpha+beta)→ 取消 beta → 部分;host-b 仍没选
// 3  按类型:codex 组 = 部分(alpha)→ 点组 → 全选(alpha+gamma),已选的可对话不变
// 4  清空 → 搜「beta」→ 全选搜索结果 → 只有 beta;一次性说明在界面上
// 5  保存 → hub(bob 自己的令牌):/api/status 只有 e2e-beta,给 e2e-gamma 派活 403,给 e2e-beta 200
// 以及新控件的 boundingBox。任何断言失败 exit 1。
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
await page.getByLabel('Hub 地址', { exact: true }).fill(seed.hub);
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


const groupState = async (key) => {
  const aria = await page.locator(tid(`grant-group-${key}`)).getAttribute('aria-checked');
  return aria === 'true' ? 'all' : aria === 'mixed' ? 'some' : 'none';
};
const selectedCount = async () => {
  const t = wide ? await page.locator(tid('grants-count')).innerText() : await page.locator(tid('grants-clear-value')).innerText();
  const m = t.match(/已选 (\d+) 个/); return m ? Number(m[1]) : -1;
};
const on = async (alias) => (await checked(`grant-toggle-${alias}`)) === 'true';

await openUsers();
await openBob();
await page.locator(tid('grants-mode-granted')).click();
await sleep(300);
record('0 prefill on switching to 仅指定', { three: (await selectedCount()) === 3 });

// 1
await page.locator(tid('grants-clear')).click(); await sleep(200);
record('1 清空 → 已选 0', { zero: (await selectedCount()) === 0, alphaOff: !(await on('e2e-alpha')) });
{ // painted = the note's box clipped by every overflow ancestor is ≥ 1×1(textContent 在但 0 宽的那种也要红)
  const note = page.getByText('一次性批量勾选', { exact: false });
  if (await note.count()) await note.first().scrollIntoViewIfNeeded().catch(() => {}); // 在滚动容器里、只是在折叠线下的不算 0 宽
  const p = (await note.count()) ? await note.first().evaluate(el => { const b = el.getBoundingClientRect(); let w = b.width, h = b.height;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect(); w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left))); h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top))); }
    return { w, h, painted: w >= 1 && h >= 1 }; }) : null;
  record('1 one-time note is shown', { note: (await note.count()) > 0, painted: !!p?.painted && p.w >= 8 }, { painted: p });
}

// 2 by machine
await page.locator(tid('grants-group-by-host')).click(); await sleep(300);
record('2 按机器: host-a / host-b groups, both none', { a: (await groupState('host-a')) === 'none', b: (await groupState('host-b')) === 'none' });
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-bulk-1-by-host.png`) });
await page.locator(tid('grant-group-host-a')).click(); await sleep(200);
record('2 tick host-a → alpha + beta, group all, host-b none', { alpha: await on('e2e-alpha'), beta: await on('e2e-beta'), gamma: !(await on('e2e-gamma')), all: (await groupState('host-a')) === 'all', count: (await selectedCount()) === 2 });
await page.locator(tid('grant-toggle-e2e-beta')).click(); await sleep(200);
record('2 untick beta → host-a partial (tri-state mixed)', { some: (await groupState('host-a')) === 'some', count: (await selectedCount()) === 1 });
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-bulk-2-partial.png`) });

// geometry
if (wide) {
  const list = await box(page, tid('grants-list'));
  const search = await box(page, `${tid('grants-dialog')} ${tid('grants-search')}`);
  const seg = await box(page, tid('grants-group-by'));
  const sel = await box(page, tid('grants-select-visible'));
  const clr = await box(page, tid('grants-clear'));
  const header = await box(page, tid('grant-group-host-a'));
  const rowA = await box(page, tid('grant-toggle-e2e-alpha'));
  const tb = await box(page, tid('grants-toolbar'));
  measures.push({ step: 'wide bulk toolbar', list, seg, sel, clr, header, rowA, toolbar: tb });
  record('G wide: toolbar spans the list column (segment left = list left, 清空 right = list right)', { left: near(seg.x, list.x), right: near(clr.r, list.r, 1.5), sameRow: near(seg.y + seg.h / 2, clr.cy, 1.5) && near(sel.cy, clr.cy, 1) }, { segX: seg.x, listX: list.x, clrR: clr.r, listR: list.r, segCy: r1(seg.y + seg.h / 2), selCy: sel.cy, clrCy: clr.cy });
  const segTexts = [];
  for (const g of ['none', 'host', 'runtime']) segTexts.push(await box(page, tid(`grants-group-by-${g}-text`)));
  const segItems = [];
  for (const g of ['none', 'host', 'runtime']) segItems.push(await box(page, tid(`grants-group-by-${g}`)));
  measures.push({ step: 'wide group-by segments', segItems, segTexts });
  // 判据要看得见「字被挤没了」:容器在、分段在,但文字宽 0 时,上一版这条仍然是绿的(2026-09-30 截图才发现)。
  record('G wide: every group-by segment shows its whole label (text ≥ 24 px wide, inside its segment)', { visible: segTexts.every((t, i) => t && t.w >= 24 && t.x >= segItems[i].x - 0.5 && t.r <= segItems[i].r + 0.5) }, { segTexts: segTexts.map(t => t && { x: t.x, w: t.w }), segItems: segItems.map(t => t && { x: t.x, w: t.w }) });
  record('G wide: group header on the list edge; agent rows indented under it', { header: near(header.x, list.x), indent: rowA.x > header.x + 20 }, { headerX: header.x, rowX: rowA.x });
} else {
  const ids = ['grants-group-by-none', 'grants-group-by-host', 'grants-group-by-runtime', 'grants-select-visible', 'grants-clear', 'grant-group-host-a', 'grant-toggle-e2e-alpha'];
  const b = {};
  for (const id of ids) b[id] = await box(page, tid(id));
  measures.push({ step: 'phone bulk rows', ...b });
  const g = Object.entries(b).map(([id, x]) => ({ id, L: x?.x, R: x ? r1(viewport.width - x.r) : null, h: x?.h }));
  record('G phone: new rows 17 / 17 (card 16 + border), ≥ 48 tall', { gutters: g.every(x => near(x.L, 17) && near(x.R, 17)), h48: g.every(x => x.h >= 48) }, { rows: g });
  const accs = [];
  for (const id of ['grants-group-by-host', 'grant-group-host-a', 'grant-toggle-e2e-alpha']) accs.push((await box(page, tid(`${id}-accessory`)))?.r);
  const labels = [];
  for (const id of ['grants-group-by-host', 'grant-group-host-a', 'grant-toggle-e2e-alpha']) labels.push((await box(page, tid(`${id}-label`)))?.x);
  record('G phone: tri-state icon shares the ✓ column; labels share one left edge', { acc: accs.every(x => near(x, accs[0])), labels: labels.every(x => near(x, labels[0])) }, { accR: accs, labelX: labels });
}

// 3 by type
await page.locator(tid('grants-group-by-runtime')).click(); await sleep(300);
record('3 按类型: codex partial (alpha), claude-code none', { codex: (await groupState('codex')) === 'some', claude: (await groupState('claude-code')) === 'none' });
await page.locator(tid('grant-group-codex')).click(); await sleep(200);
record('3 tick codex → alpha + gamma; beta untouched', { alpha: await on('e2e-alpha'), gamma: await on('e2e-gamma'), beta: !(await on('e2e-beta')), all: (await groupState('codex')) === 'all', count: (await selectedCount()) === 2 });
await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-bulk-3-by-type.png`) });
await page.locator(tid('grant-group-codex')).click(); await sleep(200);
record('3 tick a full group again → clears it', { none: (await groupState('codex')) === 'none', count: (await selectedCount()) === 0 });

// 4 search + select results
await page.locator(tid('grants-group-by-none')).click(); await sleep(200);
await page.locator(tid('grants-search')).fill('beta'); await sleep(300);
const selLabel = await page.locator(tid('grants-select-visible')).innerText();
record('4 label says 全选搜索结果 while searching', { label: selLabel.includes('全选搜索结果') }, { selLabel });
await page.locator(tid('grants-select-visible')).click(); await sleep(200);
await page.locator(tid('grants-search')).fill(''); await sleep(300);
record('4 only beta selected', { beta: await on('e2e-beta'), alpha: !(await on('e2e-alpha')), gamma: !(await on('e2e-gamma')), count: (await selectedCount()) === 1 });

// 5 save → hub
await page.locator(tid('grants-confirm')).click();
if (wide) await page.locator(tid('grants-dialog')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
else await page.locator(tid('member-page')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await sleep(800);
{
  const g = await grants();
  const sees = await bobSees();
  const gamma = await bobSend('e2e-gamma');
  const beta = await bobSend('e2e-beta');
  record('5 hub: granted with exactly beta (per-node grant, can_message)', { granted: g.body?.agent_access === 'granted', one: g.body?.grants?.length === 1 && g.body.grants[0].can_message === true }, { grants: g.body?.grants });
  record('5 hub: bob /api/status lists only e2e-beta', { only: JSON.stringify(sees.aliases) === JSON.stringify(['e2e-beta']) }, sees);
  record('5 hub: send to e2e-gamma → 403, to e2e-beta → 200', { g403: gamma.status === 403 && gamma.body?.error === 'agent_not_granted', b200: beta.status === 200 }, { gamma: gamma.status, beta: beta.status });
}

console.log('MEASURES ' + JSON.stringify(measures));
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
