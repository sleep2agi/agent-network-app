// 任务权限(RFC-038 §9 第 2 步,app):管理员在成员编辑器里给 scoped 成员授权项目,成员登录后看板上只读的卡带锁、
// 详情只读;对**真的一次性 hub**(agent-network#2163 分支,HOME=$(mktemp -d)、非 9200、临时库)端到端。
// OLD_HUB=1:对没有 task-grants 的 hub 跑,断言整块不出现。
//
//   SEED=<seed.json> VP=wide|phone [OLD_HUB=1] WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-task-access-ui/drive.mjs
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
  await page.locator(tid('user-row-scoped_bob')).waitFor({ timeout: 10000 });
  await sleep(300);
}

async function openBob() {
  await page.locator(tid('user-row-scoped_bob')).click();
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
await openUsers();
await openBob();
await sleep(800);
if (OLD) {
  record('OLD hub: no 任务权限 section', { none: (await page.locator(tid('task-access')).count()) === 0 });
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-task-old-hub.png`) });
} else {
  await page.locator(tid('task-access')).waitFor({ timeout: 8000 });
  record('1 任务权限 section shown; new member starts on 仅相关任务', { scoped: (await checked('task-access-mode-scoped')) === 'true', label: (await page.locator(tid('task-access-mode-scoped')).innerText()).includes('仅相关任务') });
  if (!wide) { await page.locator(tid('task-access-projects-row')).click(); await sleep(300); }
  await page.locator(tid('task-project-官网改版')).click();
  await page.locator(tid('task-project-安卓发布')).click();
  await sleep(200);
  // 桌面的开关本身带 testID;手机是 settings-kit 的开关行(testID 在行上),点行里的那个开关。
  await (wide ? page.locator(tid('task-project-editable-安卓发布')) : page.locator(tid('task-project-editable-安卓发布')).locator('[role="switch"], input').first()).click();
  await sleep(300);
  await page.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-task-1-editor.png`) });
  if (wide) {
    const card = await box(page, tid('grants-dialog'));
    const seg = await box(page, tid('task-access-mode'));
    const list = await box(page, tid('task-access-projects'));
    const roleSeg = await box(page, tid('member-role'));
    const row = await box(page, tid('task-project-row-安卓发布'));
    const sw = await box(page, tid('task-project-editable-安卓发布'));
    const save = await box(page, tid('grants-confirm'));
    measures.push({ step: 'wide task section', card, seg, list, roleSeg, row, sw, save });
    record('G wide: task segmented + project list share the role control column; switch on the right edge; 保存 inside the viewport', {
      left: near(seg.x, roleSeg.x) && near(list.x, roleSeg.x), right: near(seg.r, roleSeg.r) && near(list.r, roleSeg.r),
      switchRight: near(sw.r, row.r, 6), save: save.b <= viewport.height && save.b <= card.b,
    }, { segX: seg.x, listX: list.x, roleX: roleSeg.x, segR: seg.r, listR: list.r, roleR: roleSeg.r, swR: sw.r, rowR: row.r, saveB: save.b, cardB: card.b });
  } else {
    const ids = ['task-access-mode-all', 'task-access-mode-scoped', 'task-access-projects-row', 'task-project-官网改版', 'task-project-editable-安卓发布'];
    const b = {}; for (const id of ids) b[id] = await box(page, tid(id));
    measures.push({ step: 'phone task section', ...b });
    const g = Object.entries(b).map(([id, x]) => ({ id, L: x?.x, R: x ? r1(viewport.width - x.r) : null, h: x?.h }));
    record('G phone: task rows 17 / 17 (card 16 + border), ≥ 48 tall', { gutters: g.every(x => near(x.L, 17) && near(x.R, 17)), h48: g.every(x => x.h >= 48) }, { rows: g });
  }
  await page.locator(tid('grants-confirm')).click();
  if (wide) await page.locator(tid('grants-dialog')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  else await page.locator(tid('member-page')).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await sleep(800);
  {
    const g = await api(seed.admin_token, 'GET', `/api/networks/${NET}/members/${seed.bob_user_id}/task-grants`);
    const grants = Object.fromEntries((g.body?.project_grants ?? []).map(x => [x.project_id, x.can_edit]));
    record('2 hub: scoped, 官网改版 view-only, 安卓发布 editable', { scoped: g.body?.task_access === 'scoped', web: grants[seed.projects['官网改版']] === false, app: grants[seed.projects['安卓发布']] === true, two: Object.keys(grants).length === 2 }, { grants: g.body?.project_grants });
  }

  // 3 bob on the board
  const ctx2 = await browser.newContext({ viewport, userAgent: wide ? MAC_UA : ANDROID_UA, deviceScaleFactor: 2, locale: 'zh-CN' });
  const bp = await ctx2.newPage();
  bp.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await bp.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await bp.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await bp.locator(tid('login-screen')).waitFor({ timeout: 30000 });
  await bp.getByLabel('服务器地址', { exact: true }).fill(seed.hub);
  await bp.getByLabel('用户名', { exact: true }).fill(seed.bob_user);
  await bp.getByLabel('密码', { exact: true }).fill(seed.password);
  await bp.locator(tid('login-submit')).click();
  await bp.locator(tid('mobile-tab-bar')).waitFor({ timeout: 20000 });
  await bp.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
  await bp.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  await bp.getByText('bob负责的卡').first().waitFor({ timeout: 20000 });
  await sleep(1200);
  const seen = async (name) => (await bp.getByText(name, { exact: true }).count()) > 0;
  record('3 bob sees own / participated / granted-project cards, not the unrelated one', {
    own: await seen('bob负责的卡'), part: await seen('bob参与的卡'), web: await seen('官网的卡'), app: await seen('安卓的卡'), other: !(await seen('无关的卡')),
  });
  const lockOf = async (id) => (await bp.locator(`${tid(`req-card-${id}`)} ${tid('task-read-only-tag')}, ${tid(`task-read-only-${id}`)}`).count()) > 0;
  const C = seed.cards;
  record('3 lock tag on read-only cards only (participated, view-only project)', {
    part: await lockOf(C['bob参与的卡']), web: await lockOf(C['官网的卡']), own: !(await lockOf(C['bob负责的卡'])), app: !(await lockOf(C['安卓的卡'])),
  });
  await bp.screenshot({ fullPage: !wide, path: join(OUT, `${VP}-task-2-board.png`) });
  if (wide) {
    const tag = await box(bp, `${tid(`req-card-${C['bob参与的卡']}`)} ${tid('task-read-only-tag')}, ${tid(`task-read-only-${C['bob参与的卡']}`)}`);
    const title = await box(bp, `${tid(`task-title-${C['bob参与的卡']}`)}, ${tid(`req-card-${C['bob参与的卡']}`)}`);
    measures.push({ step: 'wide board lock', tag, title });
    record('G wide: lock tag sits inside its row/card', { inside: !!tag && !!title && tag.x >= title.x - 0.5 && tag.r <= title.r + 0.5 && tag.y >= title.y - 0.5 && tag.b <= title.b + 0.5 }, { tag, title });
  }
  await bp.getByText('bob参与的卡', { exact: true }).first().click();
  await bp.locator(tid('req-detail-read-only')).waitFor({ timeout: 8000 }).catch(() => {});
  record('3 read-only detail: banner shown, no 保存修改, fields inert', {
    banner: (await bp.locator(tid('req-detail-read-only')).count()) === 1,
    noSave: (await bp.locator(tid('req-edit-save')).count()) === 0,
    inert: (await bp.locator(tid('req-detail-fields')).evaluate(el => getComputedStyle(el).pointerEvents).catch(() => '')) === 'none',
  });
  await sleep(800); // 手机详情是推入的一页,等动画走完再截
  await bp.screenshot({ path: join(OUT, `${VP}-task-3-detail-read-only.png`) });
  // hub side still refuses (the UI is only the first line)
  const patch = await api(await (async () => (await fetch(`${seed.hub}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: seed.bob_user, password: seed.password }) }).then(r => r.json())).token)(), 'PATCH', `/api/requirements/${C['bob参与的卡']}?network_id=${NET}`, { column: 'doing' });
  record('3 hub: PATCH on the read-only card → 403 task_read_only', { s403: patch.status === 403 && patch.body?.error === 'task_read_only' }, { status: patch.status, error: patch.body?.error });
  await ctx2.close();
}

console.log('MEASURES ' + JSON.stringify(measures));
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
