// 手机快捷改状态 / 优先级 —— 真拖、真点、量真框、截下真请求体。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-phone-quick-status/drive.mjs
//
// phone 390×844 (Android UA ⇒ touch), light + dark, list view and board view:
//   swipe       drag a 需求池 row left → 「进行中」「完成」「更多」 appear, each ≥ 44 tall, inside the row, no horizontal page
//               overflow; tap 完成 → PATCH body exactly {"column":"done"}, detail not opened, undo toast shows
//   undo        tap 撤销 → PATCH {"column":"pool"}, toast gone
//   readonly    a read-only card (viewer_can.edit=false, no edit_fields) does not open when dragged, sends nothing
//   participant a participant's card swipes (status is open to them); long-press menu: 改状态… on, 改优先级… aria-disabled
//   menu        long-press an editable row → 改状态… / 改优先级… → sheet → PATCH {"priority":"high"} only
//   board       same swipe on a phone board card → PATCH {"column":"doing"}
// Prints a measurement table. Exit 1 when any check fails.
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
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 41, '示例任务一:可改', {}),
      R('r2', 42, '示例任务二:我参与', { participants: [me], viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] } }),
      R('r3', 43, '示例任务三:只读', { viewer_can: { edit: false, delete: false } }),
      R('r4', 44, '示例任务四:进行中', { column: 'doing' }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
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

const V = { w: 390, h: 844 };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const theme of ['light', 'dark']) {
  const where = `phone/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, userAgent: ANDROID_UA, hasTouch: true, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-${n}.png` }); };
  const patches = () => page.evaluate(() => (window.__tasksPatches || []).map(b => JSON.stringify(b)));
  const swipeLeft = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    const y = b.y + Math.min(24, b.height / 2);
    await page.mouse.move(b.x + b.width - 20, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 220, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  };
  const longPress = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    await page.mouse.move(b.x + 40, b.y + 14);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.locator(tid('task-menu')).first().waitFor({ timeout: 4000 });
    await page.waitForTimeout(250);
  };
  const toView = async (v) => {
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    await page.waitForTimeout(300);
    const seg = page.locator(tid(`tasks-view-${v}`)).first();
    if (await seg.count() && await seg.isVisible()) { await seg.tap(); await page.waitForTimeout(400); }
  };
  const guarded = async (name, fn) => {
    try { await fn(); } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, step: name, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-FAIL-${name.replace(/\s+/g, '-')}.png` }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      if (await page.locator(tid('task-menu')).count()) await page.locator(tid('task-menu-scrim')).first().click({ position: { x: 5, y: 5 } }).catch(() => {});
      if (await page.locator(tid('req-detail-close')).count()) await page.locator(tid('req-detail-close')).first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  };
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture);
    await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await toView('list');
    await page.locator(tid('req-row-r1')).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot('list');

    await guarded('swipe list row', async () => {
      const before = (await patches()).length;
      await swipeLeft(tid('req-row-r1'));
      const row = await bb(page, tid('task-swipe-r1'));
      const acts = {};
      for (const a of ['doing', 'done', 'more']) { acts[a] = await bb(page, tid(`task-swipe-${a}-r1`)); measure(where, `列表左滑 ${a}`, acts[a]); }
      measure(where, '列表行', row);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shot('list-swiped');
      record(where, 'list swipe reveals 进行中/完成/更多', {
        present: !!(acts.doing && acts.done && acts.more),
        tall44: Object.values(acts).every(b => b && b.height >= 44),
        insideRow: Object.values(acts).every(b => inside(b, row)),
        noPageOverflow: overflow <= 0,
        noRequestYet: (await patches()).length === before,
        detailClosed: (await page.locator(tid('req-detail')).count()) === 0,
      }, { overflow });
      await page.locator(tid('task-swipe-done-r1')).first().tap();
      await page.waitForTimeout(600);
      const bodies = (await patches()).slice(before);
      const toast = await bb(page, tid('quick-undo'));
      const undoBtn = await bb(page, tid('quick-undo-button'));
      measure(where, '撤销提示', toast); measure(where, '撤销按钮', undoBtn);
      await shot('list-done-undo');
      record(where, 'tap 完成 saves {column} only + undo toast', {
        body: bodies.length === 1 && bodies[0] === '{"column":"done"}',
        toast: !!toast && inside(toast, { x: 0, y: 0, width: V.w, height: V.h }),
        undo44: !!undoBtn && undoBtn.height >= 44,
        detailClosed: (await page.locator(tid('req-detail')).count()) === 0,
      }, { bodies: bodies.join(' | ') });
      await page.locator(tid('quick-undo-button')).first().tap();
      await page.waitForTimeout(600);
      const after = (await patches()).slice(before);
      record(where, 'undo puts it back', { body: after.length === 2 && after[1] === '{"column":"pool"}', toastGone: (await page.locator(tid('quick-undo')).count()) === 0 }, { bodies: after.join(' | ') });
    });

    await guarded('readonly no swipe', async () => {
      const before = (await patches()).length;
      await swipeLeft(tid('req-row-r3'));
      record(where, 'read-only row has no swipe actions', {
        noActions: (await page.locator('[data-testid^="task-swipe-"][data-testid$="-r3"]').count()) === 0,
        noRequest: (await patches()).length === before,
      });
      await page.keyboard.press('Escape').catch(() => {});
      if (await page.locator(tid('req-detail-close')).count()) { await page.locator(tid('req-detail-close')).first().tap(); await page.waitForTimeout(300); }
    });

    await guarded('participant', async () => {
      await swipeLeft(tid('req-row-r2'));
      const ok = !!(await bb(page, tid('task-swipe-done-r2')));
      await shot('participant-swiped');
      if (await page.locator(tid('task-swipe-close-r2')).count()) { await page.locator(tid('task-swipe-close-r2')).first().tap(); await page.waitForTimeout(300); }
      await longPress(tid('req-row-r2'));
      const st = await page.locator(tid('task-menu-status')).first().getAttribute('aria-disabled').catch(() => 'missing');
      const pr = await page.locator(tid('task-menu-priority')).first().getAttribute('aria-disabled').catch(() => 'missing');
      await shot('participant-menu');
      record(where, 'participant: swipe on, 改状态 on, 改优先级 locked', { swipe: ok, statusOn: st !== 'true' && st !== 'missing', priorityLocked: pr === 'true' }, { st, pr });
      await page.locator(tid('task-menu-scrim')).first().click({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(300);
    });

    await guarded('menu priority', async () => {
      const before = (await patches()).length;
      await longPress(tid('req-row-r1'));
      const menu = await bb(page, tid('task-menu'));
      const ms = await bb(page, tid('task-menu-status')), mp = await bb(page, tid('task-menu-priority'));
      measure(where, '菜单 改状态…', ms); measure(where, '菜单 改优先级…', mp);
      await shot('menu');
      record(where, 'long-press menu has 改状态… / 改优先级…', { present: !!(ms && mp), inside: inside(ms, menu) && inside(mp, menu), tall44: !!ms && ms.height >= 44 && !!mp && mp.height >= 44 });
      await page.locator(tid('task-menu-priority')).first().tap();
      await page.locator(tid('quick-priority-opt-high')).first().waitFor({ timeout: 4000 });
      await shot('priority-sheet');
      await page.locator(tid('quick-priority-opt-high')).first().tap();
      await page.waitForTimeout(600);
      const bodies = (await patches()).slice(before);
      record(where, '改优先级 → PATCH {priority} only', { body: bodies.length === 1 && bodies[0] === '{"priority":"high"}' }, { bodies: bodies.join(' | ') });
    });

    await guarded('board swipe', async () => {
      await toView('board');
      await page.locator(tid('req-card-r1')).first().waitFor({ timeout: 8000 });
      const before = (await patches()).length;
      await swipeLeft(tid('req-card-r1'));
      const card = await bb(page, tid('task-swipe-r1'));
      const acts = {};
      for (const a of ['doing', 'done', 'more']) { acts[a] = await bb(page, tid(`task-swipe-${a}-r1`)); measure(where, `看板左滑 ${a}`, acts[a]); }
      measure(where, '看板卡片', card);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shot('board-swiped');
      await page.locator(tid('task-swipe-doing-r1')).first().tap();
      await page.waitForTimeout(600);
      const bodies = (await patches()).slice(before);
      record(where, 'board card swipe → 进行中', {
        present: !!(acts.doing && acts.done && acts.more),
        tall44: Object.values(acts).every(b => b && b.height >= 44),
        insideCard: Object.values(acts).every(b => inside(b, card)),
        noPageOverflow: overflow <= 0,
        body: bodies.length === 1 && bodies[0] === '{"column":"doing"}',
      }, { bodies: bodies.join(' | '), overflow });
    });

    record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.join(' | ') });
  } catch (e) {
    failures++;
    console.log(JSON.stringify({ where, step: 'load', error: String(e).split('\n')[0] }));
  }
  await ctx.close();
}
await browser.close();
web.close();
console.log('\nmeasurements (CSS px):');
console.table(measures);
console.log(failures ? `\n${failures} check group(s) failed` : `\nall ${rows.length} check groups passed`);
process.exit(failures ? 1 : 0);
