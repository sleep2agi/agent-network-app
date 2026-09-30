// #429 任务「动态」视图 —— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-activity/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   tab       「动态」 is in the view switcher when the hub advertises `events`, and absent on an old hub (no events)
//   collapse  four edits by one Agent on one card within 5 min are one row 「更新了 4 项」 with 「4 次」 (desktop);
//             展开 shows four lines, 收起 hides them
//   days      今天 / 昨天 sections, newest first
//   filter    desktop: 类型 menu → tick 完成 → one row; 清除 → all rows back. 我的任务 → only cards I own / join.
//             phone: 筛选 → sheet → tick 完成 → 「查看 1 条」 → one row; the 筛选 button shows 1
//   open      desktop: hover a row → 打开任务 → the detail opens; phone: tap a row → the detail page
//   text      nothing owns text yet paints < 1px (harness zeroSizeText); phone: no horizontal page scroll
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, zeroSizeText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = ({ events }) => {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'doing', owner: null, participants: [], agent_owner: null, project_id: 'p_hub', due: '', createdAt: at(3000), updatedAt: at(1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' }, ub = { kind: 'user', id: 'u_b' };
  const na = { kind: 'node', id: 'n_sweep_a' }, nb = { kind: 'node', id: 'n_sweep_b' };
  let id = 200;
  const E = (min, rid, seq, title, actor, kind, field, old, nw) => ({ id: String(id--), requirement_id: rid, seq, title, actor, kind, field, old, new: nw, at: at(min) });
  const t1 = '示例任务一:写入与动态同事务', t2 = '示例任务二:节点掉线自动恢复', t3 = '示例任务三:下载页补充说明', t4 = '示例任务四:记住上次选的网络';
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 124, t1, { priority: 'high', tags: ['数据库', '后端'] }),
      R('r2', 119, t2, { project_id: 'p_rt', participants: [me], agent_owner: nb }),
      R('r3', 117, t3, { column: 'done', project_id: 'p_doc' }),
      R('r4', 131, t4, { owner: me, project_id: 'p_app', due: '2026-10-03' }),
    ],
    projects: [
      { id: 'p_hub', name: 'Hub 服务', color: '#7c3aed', sort: 1, archived: false },
      { id: 'p_app', name: 'App', color: '#0e7490', sort: 2, archived: false },
      { id: 'p_rt', name: 'Agent 运行时', color: '#2563eb', sort: 3, archived: false },
      { id: 'p_doc', name: '文档站', color: '#d97706', sort: 4, archived: false },
    ],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'user', id: 'u_b', networkId: 'net-sweep', name: '示例成员乙' },
      { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-A' },
      { kind: 'node', id: 'n_sweep_b', networkId: 'net-sweep', name: '示例-B' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'tags', 'requirement_seq', 'list_summary', 'changes', ...(events ? ['events'] : [])],
    ...(events ? { events: [
      E(3, 'r1', 124, t1, na, 'changed', 'tags', [], ['数据库', '后端']),
      E(4, 'r1', 124, t1, na, 'changed', 'priority', 'low', 'high'),
      E(4.5, 'r1', 124, t1, na, 'changed', 'column', 'pool', 'doing'),
      E(5, 'r1', 124, t1, na, 'changed', 'title', '旧的示例标题', t1),
      E(25, 'r1', 124, t1, nb, 'changed', 'checklist_item', { id: 'c3', text: '跑一遍越权用例', done: false }, { id: 'c3', text: '跑一遍越权用例', done: true }),
      E(47, 'r2', 119, t2, ua, 'changed', 'agent_owner', null, nb),
      E(74, 'r3', 117, t3, ub, 'changed', 'column', 'doing', 'done'),
      E(100, 'r3', 117, t3, na, 'changed', 'description', { chars: 10 }, { chars: 42 }),
      E(101, 'r3', 117, t3, na, 'changed', 'checklist_item', { id: 'a', text: '截图', done: false }, { id: 'a', text: '截图', done: true }),
      E(102, 'r3', 117, t3, na, 'changed', 'checklist_item', { id: 'b', text: '链接', done: false }, { id: 'b', text: '链接', done: true }),
      E(153, 'r4', 131, t4, ua, 'changed', 'project', 'p_hub', 'p_app'),
      E(178, 'r4', 131, t4, ua, 'changed', 'due', '2026-10-08', '2026-10-03'),
      E(385, 'r4', 131, t4, ua, 'created', null, null, { title: t4, column: 'pool' }),
      E(60 * 26, 'r9', 98, '示例归档任务', nb, 'changed', 'archived', false, true),
      E(60 * 27, 'r8', 97, '示例已删除任务', ua, 'deleted', null, null, null),
    ] } : {}),
  };
};

const rows = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const rowCount = (page) => page.locator('[data-testid^="activity-row-"]').count();

const VIEWPORTS = {
  desktop: { w: 1440, h: 900, ua: undefined },
  phone: { w: 390, h: 844, ua: ANDROID_UA },
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    for (const events of theme === 'light' ? [true, false] : [true]) {
      const where = `${name}/${theme}${events ? '' : '/old-hub'}`;
      const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua } : {}), colorScheme: theme, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
      let step = 'load';
      try {
        await page.addInitScript(initScript, { theme });
        await page.addInitScript(fixture, { events });
        await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
        await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
        await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
        await page.locator('[data-testid="tasks-view"]').first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
        const tab = page.locator('[data-testid="tasks-view-activity"]');
        if (!events) {
          record(where, 'tab', { absentOnOldHub: (await tab.count()) === 0 });
          await ctx.close();
          continue;
        }
        record(where, 'tab', { present: (await tab.count()) === 1 });
        await tab.first().click();
        await page.locator('[data-testid="task-activity"]').waitFor({ timeout: 10000 });
        await page.locator('[data-testid^="activity-row-"]').first().waitFor({ timeout: 10000 });
        await page.waitForTimeout(400);
        const all = await rowCount(page);
        const group = page.locator('[data-testid="activity-row-200"]');
        const groupText = await group.innerText();
        const days = await page.locator('[data-testid^="activity-day-"]').count();
        record(where, 'collapse', {
          rows: all === 10, // r1×4 → 1, r1 tick (other Agent), r2, r3 done, r3 desc + 2 ticks → 1, r4 project, r4 due (25 min later), r4 created, archived, deleted
          updated4: /更新了 4 项/.test(groupText),
          times4: name === 'phone' || /4 次/.test(groupText),
          // today + yesterday (the drive's clock decides whether the −6 h events are today too)
          days: days >= 2,
        }, { rows: all, days });
        if (OUT) await page.screenshot({ path: `${OUT}/feed-${name}-${theme}.png` });
        await page.locator('[data-testid="activity-expand-200"]').click();
        const lines = await page.locator('[data-testid="activity-details-200"] > *').count();
        if (OUT && theme === 'light') await page.screenshot({ path: `${OUT}/feed-${name}-${theme}-expanded.png` });
        await page.locator('[data-testid="activity-expand-200"]').click();
        record(where, 'expand', { four: lines === 4, hidden: (await page.locator('[data-testid="activity-details-200"]').count()) === 0 }, { lines });
        const zero = await zeroSizeText(page, '[data-testid="task-activity"]');
        const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
        record(where, 'text', { painted: zero.length === 0, noHScroll: name !== 'phone' || overflow <= 0 }, { zero: zero.slice(0, 3).join('|') || '-', overflow });

        // filters
        step = 'filters';
        if (name === 'desktop') {
          await page.locator('[data-testid="activity-filter-type"]').click();
          await page.locator('[data-testid="activity-menu-type"]').waitFor({ timeout: 5000 });
          const doneCount = await page.locator('[data-testid="activity-opt-done"]').innerText();
          await page.locator('[data-testid="activity-opt-done"]').click();
          await page.waitForTimeout(600); // let the Modal fade settle before the shot
          if (OUT && theme === 'light') await page.screenshot({ path: `${OUT}/feed-desktop-filter-${theme}.png` });
          const onlyDone = await rowCount(page);
          step = 'menu-clear';
        await page.locator('[data-testid="activity-menu-clear"]').click();
        step = 'scrim';
          await page.locator('[data-testid="activity-filter-scrim"]').click({ position: { x: 20, y: V.h - 20 } }); // centre is under the popover
          const back = await rowCount(page);
          record(where, 'filter type', { oneRow: onlyDone === 1, menuCount1: /1\s*$/.test(doneCount.trim()), cleared: back === all }, { onlyDone, back });
        } else {
          await page.locator('[data-testid="activity-filter-open"]').click();
          await page.locator('[data-testid="activity-sheet"]').waitFor({ timeout: 5000 });
          await page.locator('[data-testid="activity-sheet-done"]').click();
          const apply = await page.locator('[data-testid="activity-sheet-apply"]').innerText();
          if (OUT && theme === 'light') await page.screenshot({ path: `${OUT}/feed-phone-filter-${theme}.png` });
          await page.locator('[data-testid="activity-sheet-apply"]').click();
          const onlyDone = await rowCount(page);
          const badge = await page.locator('[data-testid="activity-filter-open"]').innerText();
          await page.locator('[data-testid="activity-filter-open"]').click();
          await page.locator('[data-testid="activity-sheet-reset"]').click();
          await page.locator('[data-testid="activity-sheet-apply"]').click();
          const back = await rowCount(page);
          record(where, 'filter sheet', { show1: /查看 1 条/.test(apply), oneRow: onlyDone === 1, badge1: /1/.test(badge), reset: back === all }, { apply, onlyDone, back });
        }
        step = 'mine';
        await page.locator('[data-testid="activity-scope-mine"]').click();
        const mineRows = await page.locator('[data-testid^="activity-row-"]').allInnerTexts();
        await page.locator('[data-testid="activity-scope-all"]').click();
        record(where, 'mine', { onlyMine: mineRows.length === 4 && mineRows.every(t => /示例任务二|示例任务四/.test(t)) }, { n: mineRows.length });

        // open
        step = 'open';
        const target = page.locator('[data-testid="activity-row-195"]'); // r2 agent owner set
        if (name === 'desktop') { await target.hover(); await page.locator('[data-testid="activity-open-195"]').click(); }
        else await target.click();
        await page.locator('[data-testid="req-detail-fields"]').first().waitFor({ timeout: 8000 });
        record(where, 'open', { detail: (await page.getByText('示例任务二:节点掉线自动恢复').count()) > 0 });
      } catch (err) {
        record(where, 'NOT RUN', { ran: false }, { step, error: String(err.message || err).split('\n')[0].slice(0, 140) });
      }
      if (errors.length) record(where, 'pageerror', { none: false }, { error: errors[0].slice(0, 140) });
      await ctx.close();
    }
  }
}
await browser.close(); web.close();
console.log(`\n${rows.length} rows, ${failures} failing`);
if (!rows.length) { console.error('nothing ran — refusing to pass'); process.exit(1); }
process.exit(failures ? 1 : 0);
