// 任务页:项目下拉 / 母任务 / 桌面多选批量改 / 「清除筛选」/ 在新窗口打开 —— 对着一个真 Hub 点真按钮、量真框。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself (never
// 127.0.0.1:9200) holding the seed from tests/test-task-board/seed.mjs (projects 军团项目 / TMAI, sub-tasks under
// 登录页支持扫码登录). The flows write to the hub: restore the seed DB before a rerun.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:<port> HUB_TOKEN=<utok_…> HUB_NETWORK=<net_…> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-task-organize/drive.mjs
//
// desktop (Tauri stub, mouse), 1000×700 / 1200×800 / 1432×831:
//   clear      owner + project filter on → 「清除筛选」 is one line, not clipped, on the header centre line ±1px
// desktop 1432×831:
//   detail     项目 and 母任务 sit directly under the title (title < 项目 < 母任务 < 状态), same height / left / right as
//              the 负责人 field ±0.5px; pick TMAI from the 项目 menu + a 母任务 → 保存修改 → the hub has both
//   parent     the 母任务 menu never offers the task itself or its descendants; the child card shows 「↳ 母任务名」
//   chips      every card with a project shows its coloured chip; 无项目 cards show none
//   bulk       Ctrl-click 2 cards + Shift-click a range → bar 「已选 N 个任务」 centred in the board, its items on one line;
//              移到项目… → TMAI → progress → hub has all N in TMAI; 改状态… → 进行中 → hub; Esc clears the selection
//   list       hover shows the row checkbox; the 项目 cell is an inline picker → hub
//   create     with the TMAI filter on, 「＋ 添加」 and ＋ 新建 both create in TMAI (hub)
//   window     ⧉ in the drawer header next to ✕ (same size, one centre line) → the window is created (stub) and the clean
//              drawer closes; the window page (/?taskWindow=1) gets the task over the READY → SHOW handshake (no token
//              in the URL or the payload), edits + saves; the main board re-reads on the CHANGED event (not the poll)
//   fallback   window creation fails → the drawer stays with a note
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

const auth = { authorization: `Bearer ${HUB_TOKEN}`, 'content-type': 'application/json' };
const hubList = async () => (await (await fetch(`${HUB_URL}/api/requirements?network_id=${HUB_NETWORK}`, { headers: auth })).json()).requirements;
const hubRow = async (name) => (await hubList()).find(r => r.name === name);
const hubProjects = async () => (await (await fetch(`${HUB_URL}/api/requirements/projects?network_id=${HUB_NETWORK}`, { headers: auth })).json()).projects;
const createReq = async (body) => (await (await fetch(`${HUB_URL}/api/requirements`, { method: 'POST', headers: auth, body: JSON.stringify({ network_id: HUB_NETWORK, column: 'pool', ...body }) })).json()).requirement;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub. plugin:http → the real throwaway hub. Events: listen handlers are kept by event name;
// emits are recorded in window.__emits (the test relays them between pages); window creation succeeds unless
// window.__failWindow is set. `taskShow` (window page only) answers the page's READY with that payload.
const initScript = ({ hubUrl, token, networkId, theme, taskShow, label }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-task-organize', displayName: 'tester', networkId };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__emits = []; window.__handlers = {}; window.__created = []; window.__failWindow = false;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: label || 'main' }, currentWebview: { windowLabel: label || 'main', label: label || 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'load_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': { (window.__handlers[args.event] ||= []).push(args.handler); return Math.floor(Math.random() * 1e6); }
        case 'plugin:event|emit': case 'plugin:event|emit_to': {
          window.__emits.push({ event: args.event, target: args.target, payload: args.payload });
          if (taskShow && args.event === 'task-window:ready') setTimeout(() => (window.__handlers['task-window:show'] || []).forEach(h => window[`_${h}`]?.({ event: 'task-window:show', id: 1, payload: { ...taskShow, at: Date.now() } })), 50);
          return null;
        }
        case 'plugin:window|get_all_windows': return [];
        case 'plugin:webview|get_all_webviews': return [];
        case 'plugin:webview|create_webview_window': { if (window.__failWindow) throw new Error('window system unavailable'); window.__created.push(args); return null; }
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url || c.url, headers: Array.from(r.headers.entries()), rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        default: return null;
      }
    },
  };
  try { localStorage.setItem('theme_mode_v1', theme); } catch {}
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
let failures = 0;
const rows = [];
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  rows.push({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', detail });
  console.log(JSON.stringify({ vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' }));
}
const rect = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getBoundingClientRect().width > 0) || null;
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2 };
}, sel);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const cardByName = (page, name) => page.locator('[data-testid^="req-card-"]', { hasText: name }).first();
const newPage = async (w, h, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme: 'light', ...extra });
  return { ctx, page, errors };
};
async function openBoard(page, view = 'board') {
  await page.goto(WEB_URL);
  await page.locator('[data-testid="desktop-rail"] [aria-label="任务"], [data-testid="desktop-rail"] [aria-label="Tasks"]').first().click({ timeout: 30000 });
  await page.locator(tid(view === 'board' ? 'tasks-view-board' : 'tasks-view-list')).first().click({ timeout: 20000 });
  await page.locator(view === 'board' ? '[data-testid^="req-card-"]' : '[data-testid^="req-row-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
}

const projects = await hubProjects();
const TMAI = projects.find(p => p.name === 'TMAI');
const LEGION = projects.find(p => p.name === '军团项目');

// ── 清除筛选 at three widths ──
for (const [w, h] of [[1000, 700], [1200, 800], [1432, 831]]) {
  const vp = `desktop ${w}x${h}`;
  const { ctx, page } = await newPage(w, h);
  await openBoard(page);
  await page.locator(tid('task-side-unassigned')).click().catch(() => {});
  await page.locator(tid(`task-side-project-${LEGION.id}`)).click().catch(() => {});
  await page.locator(tid('task-filter-clear')).waitFor({ timeout: 5000 }).catch(() => {});
  const btn = await rect(page, tid('task-filter-clear'));
  const fits = await page.locator(`${tid('task-filter-clear')} div`).last().evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height })).catch(() => null);
  const head = await rect(page, tid('task-header'));
  const chip = await rect(page, tid('task-filter-project'));
  await shot(page, `clear-${w}`);
  record(vp, '「清除筛选」 one line, not clipped, on the header centre line', {
    shown: !!btn, oneLine: !!fits && fits.h < 22, notClipped: !!fits && fits.sw <= fits.cw + 0.5, wideEnough: !!btn && btn.w > 50,
    centred: !!btn && !!chip && Math.abs(btn.cy - chip.cy) <= 1,
  }, { w: btn && r1(btn.w), h: fits && r1(fits.h), dy: btn && chip && r1(btn.cy - chip.cy), headH: head && r1(head.h) });
  await ctx.close();
}

// ── 1432×831: detail, parent, chips, bulk, list, create, window ──
{
  const vp = 'desktop 1432x831';
  const { ctx, page, errors } = await newPage(1432, 831);
  const solo = await createReq({ name: '整理项目的任务甲' });
  await createReq({ name: '整理项目的任务乙' });
  await createReq({ name: '整理项目的任务丙' });
  await openBoard(page);

  // chips: every card with a project shows its chip; no-project cards show none
  const chipCheck = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-card-"]')].map(c => ({ id: c.dataset.testid.replace('req-card-', ''), chip: !!c.querySelector('[data-testid="task-project-chip"]') })));
  const all = await hubList();
  const projectOf = new Map(all.map(r => [r.id, r.project_id]));
  const chipOk = chipCheck.every(c => !!projectOf.get(c.id) === c.chip);
  record(vp, 'cards: project chip exactly on the cards that have a project', { chipOk, some: chipCheck.some(c => c.chip) }, { cards: chipCheck.length, chips: chipCheck.filter(c => c.chip).length });

  // child card shows ↳ parent
  const childLine = await cardByName(page, '扫码登录:').locator(tid('task-card-parent')).first().textContent().catch(() => '');
  record(vp, 'child card shows 「↳ 母任务名」', { line: /^↳ 登录页支持扫码登录/.test(childLine || '') }, { line: childLine });

  // detail order + dropdown geometry
  await cardByName(page, '整理项目的任务甲').click();
  await page.locator(tid('req-edit-project')).first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  const title = await rect(page, tid('req-edit-name'));
  const proj = await rect(page, tid('req-edit-project'));
  const par = await rect(page, tid('req-edit-parent'));
  const status = await rect(page, tid('req-move-pool'));
  const owner = await rect(page, tid('req-edit-owner'));
  await shot(page, 'detail-top');
  record(vp, 'detail: 项目 and 母任务 directly under the title, sized like 负责人', {
    order: title.b < proj.y && proj.b < par.y && par.b < status.y,
    sameHeight: Math.abs(proj.h - owner.h) <= 0.5 && Math.abs(par.h - owner.h) <= 0.5,
    sameEdges: Math.abs(proj.x - owner.x) <= 0.5 && Math.abs(proj.r - owner.r) <= 0.5 && Math.abs(par.x - title.x) <= 0.5 && Math.abs(par.r - title.r) <= 0.5,
  }, { projH: r1(proj.h), ownerH: r1(owner.h), gapTitleProj: r1(proj.y - title.b) });
  await page.locator(tid('req-edit-project')).first().click();
  await page.locator(tid('req-edit-project-menu')).waitFor({ timeout: 5000 });
  const pm = await rect(page, tid('req-edit-project-menu'));
  await shot(page, 'detail-project-menu');
  record(vp, 'project menu: anchored under the field, left-aligned, at least as wide', { under: !!pm && Math.abs(pm.y - (proj.b + 4)) <= 1, left: !!pm && Math.abs(pm.x - proj.x) <= 1, wide: !!pm && pm.w >= Math.min(proj.w, 360) - 0.5 }, { dy: pm && r1(pm.y - proj.b), dx: pm && r1(pm.x - proj.x), w: pm && r1(pm.w) });
  await page.locator(tid(`req-edit-project-menu-opt-${TMAI.id}`)).click();
  await page.locator(tid('req-edit-parent')).first().click();
  await page.locator(tid('req-edit-parent-menu')).waitFor({ timeout: 5000 });
  const parentMenu = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-edit-parent-menu-opt-"]')].map(e => e.textContent));
  await page.keyboard.type('扫码登录');
  await page.waitForTimeout(200);
  const filtered = await page.locator('[data-testid^="req-edit-parent-menu-opt-"]').count();
  await shot(page, 'detail-parent-menu');
  const parentRow = await hubRow('登录页支持扫码登录');
  await page.locator(tid(`req-edit-parent-menu-opt-${parentRow.id}`)).click();
  await page.locator(tid('req-edit-save')).click();
  await page.waitForTimeout(900);
  const saved = await hubRow('整理项目的任务甲');
  record(vp, 'detail: pick TMAI + 母任务 → 保存修改 → hub has both; menu searchable, never offers itself', {
    project: saved.project_id === TMAI.id, parent: saved.parent_id === parentRow.id,
    noSelf: !parentMenu.some(t => t.includes('整理项目的任务甲')), searched: filtered >= 1 && filtered < parentMenu.length,
  }, { menu: parentMenu.length, filtered });
  // the parent's menu excludes its descendants (now including 任务甲)
  await page.locator(tid('req-detail-close')).click();
  await cardByName(page, '登录页支持扫码登录').click();
  await page.locator(tid('req-edit-parent')).first().click();
  await page.locator(tid('req-edit-parent-menu')).waitFor({ timeout: 5000 });
  const menuForParent = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-edit-parent-menu-opt-"]')].map(e => e.textContent));
  record(vp, 'parent: its own descendants are not offered (no cycles)', { noKids: !menuForParent.some(t => /扫码登录:|整理项目的任务甲/.test(t)), offersOthers: menuForParent.length > 3 }, { offered: menuForParent.length });
  await page.keyboard.press('Escape');
  await page.locator(tid('req-edit-parent-menu')).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  record(vp, 'menu: Esc closes it', { closed: !(await rect(page, tid('req-edit-parent-menu'))) });
  await page.locator(tid('req-detail-close')).click();
  await page.waitForTimeout(300);

  // bulk: Ctrl-click two, Shift-click a range
  const mod = 'Control';
  await cardByName(page, '整理项目的任务乙').click({ modifiers: [mod] });
  await cardByName(page, '整理项目的任务丙').click({ modifiers: [mod] });
  await page.waitForTimeout(200);
  const bar = await rect(page, tid('task-bulk-bar'));
  const board = await rect(page, tid('req-board'));
  const status1 = await page.locator(tid('task-bulk-count')).textContent();
  const barItems = await page.evaluate(() => ['task-bulk-count', 'task-bulk-project', 'task-bulk-status', 'task-bulk-agent', 'task-bulk-clear'].map(id => document.querySelector(`[data-testid="${id}"]`)).filter(Boolean).map(e => { const b = e.getBoundingClientRect(); return b.y + b.height / 2; }));
  const detailOpened = !!(await rect(page, tid('req-detail')));
  await shot(page, 'bulk-bar');
  record(vp, 'bulk: Ctrl-click selects (does not open details); bar centred, items on one line', {
    count: /已选 2 个任务/.test(status1 || ''), noDetail: !detailOpened,
    centred: !!bar && !!board && Math.abs((bar.x + bar.w / 2) - (board.x + board.w / 2)) <= 1, oneLine: barItems.length >= 4 && Math.max(...barItems) - Math.min(...barItems) <= 1,
  }, { status: status1, barCx: bar && r1(bar.x + bar.w / 2), boardCx: board && r1(board.x + board.w / 2) });
  await page.locator(tid('task-bulk-project')).click();
  await page.locator(tid('task-bulk-menu-project')).waitFor({ timeout: 5000 });
  await page.locator(tid(`task-bulk-menu-project-opt-${TMAI.id}`)).click();
  await page.waitForFunction(() => /已修改/.test(document.querySelector('[data-testid="task-bulk-count"]')?.textContent || '') || !document.querySelector('[data-testid="task-bulk-bar"]'), null, { timeout: 15000 }).catch(() => {});
  const b1 = await hubRow('整理项目的任务乙');
  const b2 = await hubRow('整理项目的任务丙');
  record(vp, 'bulk 移到项目… → TMAI: hub has both in TMAI', { both: b1.project_id === TMAI.id && b2.project_id === TMAI.id });
  await page.waitForTimeout(2800);
  // range: select 任务乙, Shift-click 任务丙 → everything between them in display order
  await cardByName(page, '整理项目的任务乙').click({ modifiers: [mod] });
  await cardByName(page, '整理项目的任务丙').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  const rangeStatus = await page.locator(tid('task-bulk-count')).textContent();
  const rangeN = Number((rangeStatus || '').replace(/\D+/g, ''));
  record(vp, 'bulk: Shift-click adds the range between', { range: rangeN >= 2 }, { status: rangeStatus });
  // 改状态… → 进行中 on the selection
  const selectedNames = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-card-"][aria-selected="true"]')].map(c => c.querySelector('div')?.textContent || c.textContent));
  await page.locator(tid('task-bulk-status')).click();
  await page.locator(tid('task-bulk-menu-status')).waitFor({ timeout: 5000 });
  await page.locator(tid('task-bulk-menu-status-opt-doing')).click();
  await page.waitForFunction(() => !/正在修改/.test(document.querySelector('[data-testid="task-bulk-count"]')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const after = await hubList();
  const moved = ['整理项目的任务乙', '整理项目的任务丙'].every(n => after.find(r => r.name === n)?.column === 'doing');
  record(vp, 'bulk 改状态… → 进行中: hub moved the selection', { moved, selectedSome: selectedNames.length >= 2 }, { selected: selectedNames.length });
  await page.waitForTimeout(2800);
  // Esc clears a selection
  await cardByName(page, '整理项目的任务乙').click({ modifiers: [mod] });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  record(vp, 'bulk: Esc clears the selection', { gone: !(await rect(page, tid('task-bulk-bar'))) });

  // create with the TMAI filter on: quick add + ＋ 新建 default to TMAI
  await page.locator(tid(`task-side-project-${TMAI.id}`)).click();
  await page.waitForTimeout(300);
  await page.locator(tid('req-quick-add-pool')).click();
  await page.locator(tid('req-quick-input-pool')).fill('TMAI 里快速添加');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.locator(tid('req-new')).click();
  await page.locator(tid('req-name')).fill('TMAI 里新建');
  const dialogProject = await page.locator(tid('req-project-value')).first().textContent();
  await page.locator(tid('req-add')).click();
  await page.waitForTimeout(800);
  const q = await hubRow('TMAI 里快速添加');
  const n = await hubRow('TMAI 里新建');
  record(vp, 'create with the TMAI filter on: ＋ 添加 and ＋ 新建 both land in TMAI', { quick: q?.project_id === TMAI.id, dialog: n?.project_id === TMAI.id, shown: dialogProject === 'TMAI' }, { dialogProject });
  await page.locator(tid(`task-side-project-${TMAI.id}`)).click().catch(() => {});
  await page.locator(tid('task-filter-clear')).click().catch(() => {});
  await page.waitForTimeout(300);

  // list: hover checkbox + inline 项目 cell
  await page.locator(tid('tasks-view-list')).first().click();
  await page.locator('[data-testid^="req-row-"]').first().waitFor();
  const soloRow = page.locator(tid(`req-row-${solo.id}`));
  await soloRow.hover();
  await page.waitForTimeout(150);
  const checkShown = !!(await rect(page, tid(`req-row-check-${solo.id}`)));
  const titleCell = await rect(page, `${tid(`req-row-${solo.id}`)} div[dir="auto"]`);
  await page.locator(tid(`req-row-project-${solo.id}`)).first().click();
  await page.locator(tid(`req-row-project-${solo.id}-menu`)).waitFor({ timeout: 5000 });
  await page.locator(tid(`req-row-project-${solo.id}-menu-opt-${LEGION.id}`)).click();
  await page.waitForTimeout(800);
  const soloAfter = (await hubList()).find(r => r.id === solo.id);
  await shot(page, 'list-inline-project');
  record(vp, 'list: hover shows the row checkbox; 项目 cell picks inline → hub', { checkShown, project: soloAfter.project_id === LEGION.id, titleVisible: !!titleCell });
  await page.locator(tid('tasks-view-board')).first().click();
  await page.waitForTimeout(400);

  // window: ⧉ next to ✕ → created, clean drawer closes; payload carries no token
  await cardByName(page, '整理项目的任务甲').click();
  await page.locator(tid('req-detail-open-window')).waitFor({ timeout: 8000 });
  const ow = await rect(page, tid('req-detail-open-window'));
  const cl = await rect(page, tid('req-detail-close'));
  await shot(page, 'drawer-open-window');
  await page.locator(tid('req-detail-open-window')).click();
  await page.waitForTimeout(600);
  const created = await page.evaluate(() => window.__created);
  const drawerGone = !(await rect(page, tid('req-detail')));
  const label = created[0]?.options?.label ?? created[0]?.label ?? '';
  const url = created[0]?.options?.url ?? '';
  record(vp, 'window: ⧉ beside ✕ (same size, one centre line); window created at /?taskWindow=1 with a task-* label; clean drawer closes', {
    beside: !!ow && !!cl && ow.r <= cl.x + 0.5 && Math.abs(ow.cy - cl.cy) <= 1 && Math.abs(ow.h - cl.h) <= 0.5,
    created: created.length === 1, label: /^task-[0-9a-f]+$/.test(label), url: url === '/?taskWindow=1', drawerGone,
    noToken: !JSON.stringify(created).includes(HUB_TOKEN),
  }, { label, url });

  // the window page: READY → SHOW handshake, edit + save; main board re-reads on CHANGED
  const tRow = await hubRow('整理项目的任务甲');
  const { ctx: wctx, page: wpage, errors: werr } = await newPage(880, 860, { label, taskShow: { taskId: tRow.id, profileId: 'p-task-organize', serverUrl: HUB_URL, networkId: HUB_NETWORK, title: tRow.name } });
  await wpage.goto(`${WEB_URL}?taskWindow=1`);
  await wpage.locator(tid('req-edit-name')).waitFor({ timeout: 20000 });
  const ready = await wpage.evaluate(() => window.__emits.filter(e => e.event === 'task-window:ready'));
  const wDetail = await rect(wpage, tid('req-detail'));
  await wpage.locator(tid('req-edit-name')).fill('整理项目的任务甲(新窗口里改的)');
  await wpage.locator(tid('req-edit-save')).click();
  await wpage.waitForTimeout(900);
  const changed = await wpage.evaluate(() => window.__emits.filter(e => e.event === 'task-window:changed'));
  await shot(wpage, 'task-window');
  const beforeRelay = await cardByName(page, '(新窗口里改的)').count();
  // relay the CHANGED broadcast to the main window's listener (what Tauri does between windows)
  await page.evaluate((payload) => (window.__handlers['task-window:changed'] || []).forEach(h => window[`_${h}`]?.({ event: 'task-window:changed', id: 2, payload })), changed[0]?.payload);
  await page.waitForTimeout(1200);
  const afterRelay = await cardByName(page, '(新窗口里改的)').count();
  record(vp, 'window page: gets the task over READY → SHOW, fills the window, saves; main board re-reads on CHANGED', {
    ready: ready.length >= 1 && ready[0].payload?.label === label, fills: !!wDetail && wDetail.w >= 870, saved: (await hubRow('整理项目的任务甲(新窗口里改的)')) !== undefined,
    broadcast: changed.length >= 1 && changed[0].payload?.from === label && !JSON.stringify(changed).includes(HUB_TOKEN),
    notYet: beforeRelay === 0, refreshed: afterRelay === 1, noErrors: werr.length === 0,
  }, { ready: ready.length, changed: changed.length, werr: werr.slice(0, 1).join('') });
  await wctx.close();

  // fallback: creation fails → drawer stays with a note
  await page.evaluate(() => { window.__failWindow = true; });
  await cardByName(page, '整理项目的任务乙').click();
  await page.locator(tid('req-detail-open-window')).click();
  await page.waitForTimeout(1500);
  const stays = !!(await rect(page, tid('req-detail')));
  const note = await page.locator(tid('req-edit-error')).textContent().catch(() => '');
  await shot(page, 'drawer-window-failed');
  record(vp, 'fallback: window creation fails → stays in the drawer with a note', { stays, note: /没能打开新窗口/.test(note || '') }, { note });
  record(vp, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 2).join(' | ') });
  await ctx.close();
}

await browser.close();
web.close();
console.log('\n| viewport | check | ok | failed |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.vp} | ${r.what} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.failed} |`);
console.log(`\n${rows.length - failures}/${rows.length} rows passed`);
process.exit(failures ? 1 : 0);
