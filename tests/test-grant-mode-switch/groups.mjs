// Agent 分组(RFC-038 §8,hub agent-network#2131):建组 → 授权给组 → 往组里加 Agent 自动可见 → 删组,
// 对**真的一次性 hub**(#2131 分支,HOME=$(mktemp -d)、非 9200、临时库)端到端;OLD_HUB=1 时对没有分组接口的旧 Hub 跑,
// 断言分组 UI 整块不出现、成员授权照常可用。
//
//   SEED=<seed.json> VP=wide|phone [OLD_HUB=1] WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-grant-mode-switch/groups.mjs
//
// 1  设置 → 用户管理 出现「Agent 分组」(空)→ 新建分组「前端组」:按机器勾 host-a(alpha + beta)→ 创建 → 行显示 2 个 Agent
// 2  legacy_bob → 仅指定 → 清空 → 勾分组「前端组」→ 保存 → 行显示「1 个分组」
// 3  hub(bob 的令牌):/api/status = alpha + beta;给 gamma 派活 403、给 alpha 200
// 4  编辑「前端组」加进 gamma → 保存 → **不改 bob 的授权**,bob 立刻看得见 gamma、派活 200
// 5  删除分组(确认)→ bob 什么都看不见,行变「未分配 Agent」
// 以及新控件的 boundingBox。任何断言失败 exit 1。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

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




const OLD = process.env.OLD_HUB === '1';
const gtid = (name) => tid(`agent-group-row-${name}`);
const on = async (id) => (await checked(id)) === 'true';

await openUsers();
if (OLD) {
  await sleep(800);
  record('OLD hub: no Agent 分组 section, no 新建分组', { none: (await page.locator(tid('agent-groups')).count()) === 0 && (await page.locator(tid('agent-group-new')).count()) === 0 });
  await openBob();
  await page.locator(tid('grants-mode-granted')).click(); await sleep(300);
  record('OLD hub: member editor has no group section, agent picker still works', { none: (await page.locator(tid('grant-agroups')).count()) === 0, picker: (await page.locator(tid('grant-toggle-e2e-alpha')).count()) === 1 });
  await page.locator(tid('grants-clear')).click();
  await page.locator(tid('grant-toggle-e2e-alpha')).click(); await sleep(200);
  await page.locator(tid('grants-confirm')).click(); await sleep(1500);
  const sees = await bobSees();
  record('OLD hub: saving still works (no group_grants sent) → bob sees alpha only', { only: JSON.stringify(sees.aliases) === JSON.stringify(['e2e-alpha']) }, sees);
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-groups-old-hub.png`) });
} else {
  // 1 create group
  record('1 Agent 分组 section is shown (empty)', { section: (await page.locator(tid('agent-groups')).count()) === 1 });
  await page.locator(tid('agent-group-new')).click();
  await page.locator(tid(wide ? 'group-dialog' : 'group-page')).waitFor({ timeout: 8000 });
  await page.locator(tid('grant-toggle-e2e-alpha')).waitFor({ timeout: 8000 });
  if (!wide) { const t = await paintedText(page, tid('settings-subpage-title'), '分组'); record('1 phone: group editor is a settings 三级页 titled 分组', { title: (await page.locator(tid('settings-subpage-title')).innerText()) === '分组', painted: !!t?.painted && t.w >= 8 }, { painted: t }); }
  await page.locator(tid('group-name')).fill('前端组');
  await page.locator(tid('grants-group-by-host')).click(); await sleep(300);
  await page.locator(tid('grant-group-host-a')).click(); await sleep(200);
  record('1 by machine: host-a ticked → alpha + beta', { a: await on('grant-toggle-e2e-alpha'), b: await on('grant-toggle-e2e-beta'), g: !(await on('grant-toggle-e2e-gamma')) });
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-groups-1-new.png`) });
  if (wide) {
    const card = await box(page, tid('group-dialog'));
    const name = await box(page, `${tid('group-dialog')} ${tid('group-name')}`);
    const list = await box(page, tid('grants-list'));
    const seg = await box(page, tid('grants-group-by'));
    const save = await box(page, tid('group-confirm'));
    measures.push({ step: 'wide group dialog', card, name, list, seg, save });
    record('G wide: group dialog centred; name field, toolbar and list share one column; 创建 on the right edge, inside viewport', { centred: near(card.x, viewport.width - card.r), left: near(name.x, list.x) && near(seg.x, list.x), right: near(name.r, list.r) && near(save.r, list.r), inView: save.b <= viewport.height }, { cardL: card.x, cardR: r1(viewport.width - card.r), nameX: name.x, listX: list.x, nameR: name.r, listR: list.r, saveR: save.r, saveB: save.b });
  } else {
    const ids = ['group-name-row', 'grants-group-by-host', 'grant-group-host-a', 'grant-toggle-e2e-alpha', 'group-confirm'];
    const b = {}; for (const id of ids) b[id] = await box(page, tid(id));
    measures.push({ step: 'phone group page', ...b });
    const g = Object.entries(b).map(([id, x]) => ({ id, L: x?.x, R: x ? r1(viewport.width - x.r) : null, h: x?.h }));
    record('G phone: group page rows 17 / 17 (card 16 + border; button 16 / 16), ≥ 48 tall', { gutters: g.every(x => (near(x.L, 17) && near(x.R, 17)) || (near(x.L, 16) && near(x.R, 16))), h48: g.every(x => x.h >= 48) }, { rows: g });
  }
  await page.locator(tid('group-confirm')).click();
  await page.locator(gtid('前端组')).waitFor({ timeout: 10000 });
  await sleep(500);
  record('1 group row reads 2 个 Agent', { two: (await page.locator(tid("agent-group-row-前端组-value")).innerText()) === '2 个 Agent' });
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-groups-2-list.png`) });

  // 2 grant the group to bob
  await openBob();
  await page.locator(tid('grants-mode-granted')).click(); await sleep(300);
  await page.locator(tid('grants-clear')).click(); await sleep(200);
  record('2 group section present in the member editor', { section: (await page.locator(tid('grant-agroups')).count()) === 1 });
  await page.locator(tid('grant-agroup-前端组')).click(); await sleep(200);
  record('2 group ticked', { on: await on('grant-agroup-前端组') });
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-groups-3-member.png`) });
  if (wide) {
    const grow = await box(page, tid('grant-agroup-前端组'));
    const arow = await box(page, tid('grant-toggle-e2e-alpha'));
    const sw = await box(page, tid('grant-agroup-can-message-前端组'));
    const asw = await box(page, tid('grant-agroup-row-前端组'));
    const list = await box(page, tid('grants-list'));
    measures.push({ step: 'wide member group section', grow, arow, sw, list });
    record('G wide: group rows share the agent rows’ left edge; 可对话 switch right-aligned with the list', { left: near(grow.x, arow.x), right: near(sw.r, list.r, 1.5), row: near(asw.r, list.r, 1.5) }, { groupX: grow.x, agentX: arow.x, swR: sw.r, listR: list.r });
  } else {
    const b = await box(page, tid('grant-agroup-前端组'));
    measures.push({ step: 'phone member group row', b });
    record('G phone: group choice row 17 / 17, ≥ 48', { g: near(b.x, 17) && near(viewport.width - b.r, 17), h: b.h >= 48 }, { b });
  }
  await page.locator(tid('grants-confirm')).click();
  if (wide) await page.locator(tid('grants-dialog')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  else await page.locator(tid('member-page')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await sleep(800);
  record('2 bob row reads 1 个分组', { one: (await rowValue()) === '1 个分组' }, { value: await rowValue() });

  // 3 hub
  {
    const g = await grants();
    const sees = await bobSees();
    const gamma = await bobSend('e2e-gamma');
    const alpha = await bobSend('e2e-alpha');
    record('3 hub: one group grant, no direct grants', { groups: g.body?.group_grants?.length === 1, direct: g.body?.grants?.length === 0 }, { group_grants: g.body?.group_grants });
    record('3 hub: bob sees alpha + beta (via the group)', { two: JSON.stringify(sees.aliases) === JSON.stringify(['e2e-alpha', 'e2e-beta']) }, sees);
    record('3 hub: gamma 403, alpha 200', { g403: gamma.status === 403, a200: alpha.status === 200 }, { gamma: gamma.status, alpha: alpha.status });
  }

  // 4 dynamic: add gamma to the group
  await page.locator(gtid('前端组')).click();
  await page.locator(tid(wide ? 'group-dialog' : 'group-page')).waitFor({ timeout: 8000 });
  await page.locator(tid('grant-toggle-e2e-gamma')).waitFor({ timeout: 8000 });
  record('4 editor opens with the saved members', { a: await on('grant-toggle-e2e-alpha'), b: await on('grant-toggle-e2e-beta'), g: !(await on('grant-toggle-e2e-gamma')) });
  await page.locator(tid('grant-toggle-e2e-gamma')).click(); await sleep(200);
  await page.locator(tid('group-confirm')).click(); await sleep(1500);
  {
    const g = await grants();
    const sees = await bobSees();
    const gamma = await bobSend('e2e-gamma');
    record('4 bob’s grants unchanged (still one group grant)', { same: g.body?.group_grants?.length === 1 && g.body?.grants?.length === 0 });
    record('4 dynamic: bob now sees gamma too, and can message it', { three: JSON.stringify(sees.aliases) === JSON.stringify(['e2e-alpha', 'e2e-beta', 'e2e-gamma']), g200: gamma.status === 200 }, { ...sees, gamma: gamma.status });
  }
  record('4 group row reads 3 个 Agent', { three: (await page.locator(tid("agent-group-row-前端组-value")).innerText()) === '3 个 Agent' });

  // 5 delete
  await page.locator(gtid('前端组')).click();
  await page.locator(tid(wide ? 'group-dialog' : 'group-page')).waitFor({ timeout: 8000 });
  await page.locator(tid('group-delete-open')).click(); await sleep(400);
  const msg = await page.getByText('位成员会失去经它获得的访问', { exact: false }).first().innerText().catch(() => '');
  record('5 delete confirm names how many members are affected (1)', { one: msg.includes(' 1 位成员') }, { msg });
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-groups-4-delete-confirm.png`) });
  await page.locator(tid(wide ? 'group-delete-confirm' : 'member-remove-confirm')).click(); await sleep(1500);
  {
    const sees = await bobSees();
    record('5 hub: group deleted → bob sees nothing', { none: sees.aliases.length === 0 }, sees);
    record('5 UI: group row gone; bob row reads 未分配 Agent', { gone: (await page.locator(gtid('前端组')).count()) === 0, none: (await rowValue()) === '未分配 Agent' }, { value: await rowValue() });
  }
}

console.log('MEASURES ' + JSON.stringify(measures));
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
