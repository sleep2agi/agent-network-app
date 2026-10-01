// 列表视图就地编辑(多维表格式,owner 10-01「任务列表里面要能像飞书多维表格一样能够直接编辑」)
// —— 点真格子、按真键、量真框、截下真请求体。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-list-inline-edit/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse), light + dark:
//   select    click a cell → blue frame on that cell, detail stays closed; ←→↑↓ move the frame; Esc clears it
//   editors   Enter / second click opens each editor (标题 / 负责人+负责 Agent / 优先级 / 期限 / 参与人 / 项目 / 状态 / 标签),
//             anchored to its cell (x ≈ cell.x, top under the cell or flipped above it) and inside the window;
//             also for the bottom row and the rightmost column
//   requests  every save is a PATCH whose body has exactly the one changed key
//   rollback  a failing PATCH puts the old value back and shows the inline error
//   access    participant card: only 状态 is editable (others are plain cells, click opens the detail);
//             read-only cells get no hover frame
//   phone     390×844 touch: tapping a row still opens the detail, no cell frame
// Prints a measurement table. Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [me], agent_owner: null, project_id: null, due: '', createdAt: at(3000 - seq), updatedAt: at(seq), description: '示例描述', checklist: [], tags: ['示例标签'], issues: [], parent_id: null, ...o });
  const rows = [R('r1', 1, '示例任务一'), R('r2', 2, '示例任务二:我参与', { owner: { kind: 'user', id: 'u_b' }, viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] } })];
  for (let i = 3; i <= 16; i++) rows.push(R(`r${i}`, i, `示例任务${i}`));
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: rows,
    projects: [{ id: 'p1', name: '示例项目', color: '#3b82f6', archived: false, sort: 0 }],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'user', id: 'u_b', networkId: 'net-sweep', name: '示例成员乙' },
      { kind: 'node', id: 'node-a', networkId: 'net-sweep', name: '示例节点A' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq', 'tags', 'projects', 'due_datetime', 'priority_lowest'],
  };
  try {
    localStorage.setItem('anet.language.v1', 'zh');
    // 参与人、标签两列打开(默认隐藏),顺序 = 默认顺序,标签在最右。
    localStorage.setItem('task_list_fields_v1', JSON.stringify(['seq', 'title', 'owner', 'priority', 'due', 'participants', 'project', 'status', 'created', 'updated', 'issues', 'tags'].map(id => ({ id, visible: id !== 'created' && id !== 'updated' }))));
  } catch {}
};

const rows = [];
const measures = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
const bb = async (page, sel) => { const l = page.locator(sel).first(); return (await l.count()) && await l.isVisible() ? l.boundingBox() : null; };
const measure = (where, el, b) => { if (b) measures.push({ where, el, x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }); };
const inside = (a, b) => !!(a && b) && a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
const json = (v) => JSON.stringify(v);
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d); })();

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const W = 1440, H = 900;
for (const theme of ['light', 'dark']) {
  const where = `desktop/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${theme}-${n}.png` }); };
  const patches = () => page.evaluate(() => window.__tasksPatches || []);
  const clearPatches = () => page.evaluate(() => { window.__tasksPatches = []; });
  const cellSel = (row, f) => tid(`task-cell-${row}-${f}`);
  const selectedIn = async (row, f) => (await page.locator(`${cellSel(row, f)} ${tid('task-cell-selected')}`).count()) === 1;
  const detailOpen = async () => (await page.locator(tid('req-detail')).count()) > 0;
  const click = async (row, f) => { await page.locator(cellSel(row, f)).first().click({ position: { x: 6, y: 10 } }); await page.waitForTimeout(150); };
  // 打开编辑器:先单击选中,再单击打开(多维表格的两步);量编辑器相对格子的位置。
  const open = async (row, f, editorId) => {
    await page.keyboard.press('Escape'); // 先清掉上一次留下的选中,保证是「单击选中 → 再单击打开」两步
    await click(row, f); await click(row, f);
    await page.locator(tid(editorId)).first().waitFor({ timeout: 4000 });
    await page.waitForTimeout(250);
    const c = await bb(page, cellSel(row, f)), e = await bb(page, tid(editorId));
    measure(where, `cell ${row}/${f}`, c); measure(where, `editor ${editorId}`, e);
    const geo = {
      inWindow: !!e && e.x >= 0 && e.y >= 0 && e.x + e.width <= W + 0.5 && e.y + e.height <= H + 0.5,
      anchored: !!(c && e) && (Math.abs(e.x - c.x) <= 1 || e.x + e.width >= W - 8.5) && (e.y >= c.y + c.height - 0.5 || e.y + e.height <= c.y + 0.5),
    };
    return { c, e, geo };
  };
  const closeEditor = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(200); };
  let step = 'load';
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    await page.locator(tid('tasks-view')).first().waitFor({ timeout: 15000 });
    await page.locator(tid('tasks-view-list')).first().click();
    await page.locator(tid('req-row-r1')).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    await shot('list');

    step = 'select';
    // 行序按当前排序从 DOM 读(别假设 r1 在最上面)。
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-row-r"]')].map(e => e.getAttribute('data-testid').slice(8)).filter(x => /^r\d+$/.test(x)));
    const mid = order[5], next = order[6];
    await click(mid, 'title');
    const sel1 = await selectedIn(mid, 'title'), noDetail1 = !(await detailOpen());
    const frame = await bb(page, `${cellSel(mid, 'title')} ${tid('task-cell-selected')}`), cell = await bb(page, cellSel(mid, 'title'));
    measure(where, `cell ${mid}/title`, cell); measure(where, 'selected frame', frame);
    const color = await page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).borderTopColor : null; }, `${cellSel(mid, 'title')} ${tid('task-cell-selected')}`);
    await shot('selected');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
    const right = await selectedIn(mid, 'owner');
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100);
    const down = await selectedIn(next, 'owner');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
    const back = await selectedIn(mid, 'title');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    const cleared = (await page.locator(tid('task-cell-selected')).count()) === 0;
    record(where, 'select + arrows', { selectedOnClick: sel1, detailStaysClosed: noDetail1, frameInsideCell: inside(frame, cell), right, down, back, escClears: cleared }, { frameColor: color });

    step = 'title';
    await clearPatches();
    await click('r1', 'title'); await page.keyboard.press('Enter');
    const input = page.locator(tid('list-edit-title-input')).first();
    await input.waitFor({ timeout: 3000 });
    const ib = await bb(page, tid('list-edit-title-input'));
    measure(where, 'title input', ib);
    await shot('edit-title');
    await input.fill('示例任务一(改)'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const tp = await patches();
    const shown = (await page.locator(tid('task-title-r1')).first().innerText()).includes('示例任务一(改)');
    // Esc 不存
    await page.keyboard.press('Enter'); // 那一格仍是选中的:回车再打开
    await page.locator(tid('list-edit-title-input')).first().fill('不要存这个');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const tp2 = await patches();
    record(where, 'title', { inputInsideCell: inside(ib, await bb(page, cellSel('r1', 'title'))), body: json(tp) === json([{ name: '示例任务一(改)' }]), shownInRow: shown, escNotSaved: tp2.length === 1 }, { bodies: json(tp2) });

    step = 'owner';
    await clearPatches();
    let o = await open('r1', 'owner', 'list-edit-owner');
    const groups = await page.locator(`${tid('list-edit-owner')} [data-testid^="list-edit-owner-group-"]`).count();
    const chipA = await page.locator(tid('list-edit-owner-chip-user:u_a')).count();
    await shot('edit-owner');
    await page.locator(tid('list-edit-owner-opt-user:u_b')).first().click(); await page.waitForTimeout(300);
    await page.locator(tid('list-edit-owner-opt-node:node-a')).first().click(); await page.waitForTimeout(300);
    const op = await patches();
    const chipsNow = await page.locator(`${tid('list-edit-owner-chips')} [data-testid^="list-edit-owner-chip-x-"]`).count();
    await closeEditor();
    record(where, 'owner + agent', { ...o.geo, twoGroups: groups === 2, currentChip: chipA === 1, bodies: json(op) === json([{ owner: { kind: 'user', id: 'u_b' } }, { agent_owner: { kind: 'node', id: 'node-a' } }]), chipsUpdate: chipsNow === 2, closed: (await page.locator(tid('list-edit-owner')).count()) === 0 }, { bodies: json(op) });

    step = 'priority';
    await clearPatches();
    o = await open('r1', 'priority', 'list-edit-priority');
    const prioOpts = await page.locator(`${tid('list-edit-priority')} [data-testid^="list-edit-priority-opt-"]`).count();
    await shot('edit-priority');
    await page.locator(tid('list-edit-priority-opt-high')).first().click(); await page.waitForTimeout(300);
    record(where, 'priority', { ...o.geo, fourLevels: prioOpts === 4, body: json(await patches()) === json([{ priority: 'high' }]), closed: (await page.locator(tid('list-edit-priority')).count()) === 0 });

    step = 'due';
    await clearPatches();
    o = await open('r1', 'due', 'list-edit-due-panel');
    const shortcuts = await page.locator(`${tid('list-edit-due-panel')} ${tid('list-edit-due-tomorrow')}`).count();
    const clearBtn = await page.locator(`${tid('list-edit-due-panel')} ${tid('list-edit-due-picker-clear')}`).count();
    await shot('edit-due');
    await page.locator(tid('list-edit-due-tomorrow')).first().click(); await page.waitForTimeout(300);
    const dp = await patches();
    o.geo.closed = (await page.locator(tid('list-edit-due-panel')).count()) === 0;
    // 清除
    await open('r1', 'due', 'list-edit-due-panel');
    await page.locator(tid('list-edit-due-picker-clear')).first().click(); await page.waitForTimeout(300);
    record(where, 'due', { ...o.geo, shortcutsInPanel: shortcuts === 1, clearInPanel: clearBtn === 1, body: json(dp) === json([{ due: tomorrow }]), clearBody: json((await patches())[1]) === json({ due: '' }) }, { bodies: json(await patches()) });

    step = 'participants';
    await clearPatches();
    o = await open('r1', 'participants', 'list-edit-participants');
    await shot('edit-participants');
    await page.locator(tid('list-edit-participants-opt-user:u_a')).first().click(); await page.waitForTimeout(300);
    await page.locator(tid('list-edit-participants-chip-x-user:u_tester')).first().click(); await page.waitForTimeout(300);
    const pp = await patches();
    await closeEditor();
    record(where, 'participants', { ...o.geo, bodies: json(pp) === json([{ participants: [{ kind: 'user', id: 'u_tester' }, { kind: 'user', id: 'u_a' }] }, { participants: [{ kind: 'user', id: 'u_a' }] }]) }, { bodies: json(pp) });

    step = 'project';
    await clearPatches();
    o = await open('r1', 'project', 'list-edit-project');
    await shot('edit-project');
    await page.locator(tid('list-edit-project-opt-p1')).first().click(); await page.waitForTimeout(300);
    record(where, 'project', { ...o.geo, body: json(await patches()) === json([{ project_id: 'p1' }]) });

    step = 'status';
    await clearPatches();
    o = await open('r1', 'status', 'list-edit-status');
    await shot('edit-status');
    await page.locator(tid('list-edit-status-opt-doing')).first().click(); await page.waitForTimeout(300);
    record(where, 'status', { ...o.geo, body: json(await patches()) === json([{ column: 'doing' }]) });

    step = 'issues';
    await clearPatches();
    o = await open('r1', 'issues', 'list-edit-issues');
    await page.locator(tid('list-edit-issues-search')).first().fill('not a link');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const badShown = (await page.locator(tid('list-edit-issues-error')).count()) === 1, badSent = (await patches()).length;
    const badKept = (await page.locator(tid('list-edit-issues-search')).first().inputValue()) === 'not a link';
    const badBox = await bb(page, tid('list-edit-issues-error')), popBox = await bb(page, tid('list-edit-issues'));
    measure(where, 'issues error', badBox);
    await shot('edit-issues-invalid');
    await page.locator(tid('list-edit-issues-search')).first().fill('example/app#7');
    await page.waitForTimeout(150);
    const errorClears = (await page.locator(tid('list-edit-issues-error')).count()) === 0;
    const createBox = await bb(page, tid('list-edit-issues-create')), pop2 = await bb(page, tid('list-edit-issues'));
    measure(where, 'issues create row', createBox);
    await shot('edit-issues');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const ip = await patches();
    const chip = await page.locator(tid('list-edit-issues-chip-example/app#7')).count();
    await closeEditor();
    record(where, 'issues', { ...o.geo, invalidRefused: badShown && badSent === 0, invalidTextKept: badKept, errorInsidePopover: inside(badBox, popBox), errorClearsOnTyping: errorClears, createRowInsidePopover: inside(createBox, pop2), body: json(ip) === json([{ issues: [{ url: 'https://github.com/example/app/issues/7', title: '' }] }]), chipShown: chip === 1 }, { bodies: json(ip) });

    step = 'tags (rightmost column)';
    await clearPatches();
    o = await open('r1', 'tags', 'list-edit-tags');
    const ph = await page.locator(tid('list-edit-tags-search')).first().getAttribute('placeholder');
    await page.locator(tid('list-edit-tags-search')).first().fill('新标签');
    await page.waitForTimeout(150);
    const createRow = await page.locator(tid('list-edit-tags-create')).count();
    await shot('edit-tags');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const tg = await patches();
    await closeEditor();
    record(where, 'tags', { ...o.geo, createRow: createRow === 1, body: json(tg) === json([{ tags: ['示例标签', '新标签'] }]) }, { placeholder: ph, bodies: json(tg) });

    step = 'bottom row';
    // 最下面那一行按当前排序从 DOM 读(前面改过状态,行序会变)。
    const last = await page.evaluate(() => { const ids = [...document.querySelectorAll('[data-testid^="req-row-r"]')].map(e => e.getAttribute('data-testid').slice(8)).filter(x => /^r\d+$/.test(x)); return ids[ids.length - 1]; });
    await page.locator(cellSel(last, 'status')).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    o = await open(last, 'status', 'list-edit-status');
    await shot('edit-bottom-row');
    await closeEditor();
    const ob = await open(last, 'tags', 'list-edit-tags');
    await shot('edit-bottom-right');
    await closeEditor();
    record(where, 'bottom row / right edge', { lastRowNearBottom: !!o.c && o.c.y + o.c.height > H - 120, statusInWindow: o.geo.inWindow, statusAnchored: o.geo.anchored, tagsInWindow: ob.geo.inWindow, tagsAnchored: ob.geo.anchored });

    step = 'rollback';
    await page.locator(cellSel('r3', 'priority')).first().scrollIntoViewIfNeeded();
    await clearPatches();
    await page.evaluate(() => { window.__tasksFailPatch = true; });
    await open('r3', 'priority', 'list-edit-priority');
    await page.locator(tid('list-edit-priority-opt-low')).first().click();
    await page.locator(tid('list-edit-error')).first().waitFor({ timeout: 4000 });
    await page.waitForTimeout(300);
    const badge = await page.locator(`${cellSel('r3', 'priority')} ${tid('task-prio-badge')}`).first().innerText();
    const err = await bb(page, tid('list-edit-error'));
    measure(where, 'error toast', err);
    await shot('rollback-error');
    await page.evaluate(() => { window.__tasksFailPatch = false; });
    record(where, 'rollback', { sent: json(await patches()) === json([{ priority: 'low' }]), revertedToP1: badge.trim() === 'P1', errorShown: !!err, errorInWindow: !!err && err.x >= 0 && err.x + err.width <= W && err.y + err.height <= H }, { badge, text: await page.locator(tid('list-edit-error')).first().innerText() });

    step = 'access';
    await page.keyboard.press('Escape');
    await page.locator(cellSel('r2', 'title')).first().scrollIntoViewIfNeeded();
    const editable = await page.evaluate(() => Object.fromEntries(['title', 'owner', 'priority', 'due', 'participants', 'project', 'status', 'issues', 'tags', 'seq'].map(f => [f, document.querySelector(`[data-testid="task-cell-r2-${f}"]`)?.getAttribute('data-editable') === '1'])));
    await page.locator(cellSel('r2', 'priority')).first().hover(); await page.waitForTimeout(150);
    // 悬停框 = 格子里一个绝对定位、有边框的直接子元素。
    const hasFrame = (id) => page.evaluate((s) => [...document.querySelector(s).children].some(c => getComputedStyle(c).position === 'absolute' && parseFloat(getComputedStyle(c).borderTopWidth) >= 1), tid(id));
    const noHoverFrame = !(await hasFrame('task-cell-r2-priority'));
    const hoverFrameOnEditable = await (async () => { await page.locator(cellSel('r3', 'priority')).first().hover(); await page.waitForTimeout(150); return hasFrame('task-cell-r3-priority'); })();
    await clearPatches();
    const so = await open('r2', 'status', 'list-edit-status');
    await page.locator(tid('list-edit-status-opt-doing')).first().click(); await page.waitForTimeout(300);
    const sp = await patches();
    await click('r2', 'priority');
    const opensDetail = await detailOpen();
    record(where, 'participant card', { onlyStatusEditable: json(Object.entries(editable).filter(([, v]) => v).map(([k]) => k)) === json(['status']), noHoverOnReadOnly: noHoverFrame, hoverOnEditable: hoverFrameOnEditable, statusEditor: so.geo.inWindow, statusBody: json(sp) === json([{ column: 'doing' }]), readOnlyCellOpensDetail: opensDetail }, { editable: json(editable) });
    const closeX = page.locator(tid('req-detail-close')).first();
    if (await closeX.count()) await closeX.click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    step = 'system columns';
    const sys = await page.evaluate(() => ['seq', 'title', 'issues'].map(f => document.querySelector(`[data-testid="task-cell-r3-${f}"]`)?.getAttribute('data-editable') === '1'));
    record(where, 'system column read-only, others editable', { seqReadOnly: sys[0] === false, titleEditable: sys[1] === true, issuesEditable: sys[2] === true });

    step = 'expand';
    await page.locator(cellSel('r4', 'title')).first().hover(); await page.waitForTimeout(150);
    const ex = await bb(page, tid('req-row-open-r4'));
    measure(where, 'expand button', ex);
    await page.locator(tid('req-row-open-r4')).first().click(); await page.waitForTimeout(400);
    record(where, 'expand opens detail', { button: !!ex && inside(ex, await bb(page, cellSel('r4', 'title'))), detail: await detailOpen() });

    record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.join(' | ') });
  } catch (e) {
    failures++;
    console.log(JSON.stringify({ where, step, error: String(e).split('\n')[0] }));
    if (OUT) await page.screenshot({ path: `${OUT}/${theme}-FAIL-${step.replace(/[^a-z]+/gi, '-')}.png` }).catch(() => {});
  }
  await ctx.close();
}

// 手机:照旧点行进详情,没有格子选中。
{
  const where = 'phone/light';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: 'light', deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(initScript, { theme: 'light' });
    await page.addInitScript(fixture);
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    await page.locator(tid('tasks-view-list')).first().tap();
    await page.locator(tid('req-row-r1')).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const editableCells = await page.locator('[data-editable="1"]').count();
    await page.locator(tid('req-row-r1')).first().tap(); await page.waitForTimeout(500);
    if (OUT) await page.screenshot({ path: `${OUT}/phone-tap-row.png` });
    record(where, 'tap row → detail', { noEditableCells: editableCells === 0, detail: (await page.locator(tid('req-detail')).count()) > 0, noFrame: (await page.locator(tid('task-cell-selected')).count()) === 0 });
  } catch (e) { failures++; console.log(JSON.stringify({ where, error: String(e).split('\n')[0] })); }
  await ctx.close();
}
await browser.close();
web.close();
console.log('\nmeasurements (CSS px):');
console.table(measures);
console.log(failures ? `\n${failures} check group(s) failed` : `\nall ${rows.length} check groups passed`);
process.exit(failures ? 1 : 0);
