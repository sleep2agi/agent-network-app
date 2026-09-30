// 任务页「日历」视图 —— 在 web 导出里量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-calendar/drive.mjs
//
// Desktop 1320×754 / 1000×700 (mouse), light + dark:
//   segments : 列表 / 看板 / 甘特图 / 日历
//   toolbar  : 月周 / ‹ 标题 › / 今天 / 未设期限 share one centre line ±1
//   grid     : 6 rows × 7 equal columns (±1) filling the frame (±1); weekday labels centred over their column ±1
//   cells    : every task row stays inside its cell; today's cell is highlighted
//   overflow : today's shown rows + 「+N」 == today's task count; 「+N」 opens a popover listing all of them; a row there
//              opens that task's detail
//   time     : a timed due shows the viewer's local HH:MM; an all-day due shows no time
//   week     : 周 → one row of 7; today's tasks all visible; ‹ › move the title by a week; 今天 comes back
//   undated  : 未设期限 N chip → popover with the N undated tasks; they are in no cell
//   page     : no horizontal page scroll
// Phone 390×844 (Android UA, touch), light + dark:
//   segments fit inside the 16px gutters; 7 equal day columns inside the gutters; today picked by default; a dot under
//   every day with tasks and none elsewhere; the list below == the picked day's tasks; tapping a next-month day and a
//   left swipe both turn the month; tapping a row opens the pushed detail; no page overflow.
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// ── fixture: placeholder names only; dates relative to "now" (page timezone Asia/Shanghai) ──
const fixture = () => {
  const day = 86400000;
  const now = Date.now();
  const ymd = (d) => { const t = new Date(now + d * day); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  // a timed due today at 15:30 local (UTC+8) → 07:30Z
  const timedToday = `${ymd(0)}T07:30:00Z`;
  const R = (id, name, o) => ({ id, name, priority: 'normal', assignee: '', column: 'pool', start: '', owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: null, project_id: null, due: '', createdAt: new Date(now - 5 * day).toISOString(), updatedAt: new Date(now - day).toISOString(), description: '', checklist: [], ...o });
  const requirements = [
    R('c1', '示例:今天全天高优', { due: ymd(0), priority: 'high', project_id: 'p_a' }),
    R('c2', '示例:今天下午三点半', { due: timedToday }),
    R('c3', '示例:今天低优', { due: ymd(0), priority: 'low' }),
    R('c4', '示例:今天已完成', { due: ymd(0), column: 'done' }),
    R('c5', '示例:今天第五条', { due: ymd(0) }),
    R('c6', '示例:今天第六条', { due: ymd(0), priority: 'lowest' }),
    R('c7', '示例:今天第七条', { due: ymd(0), column: 'doing' }),
    R('o1', '示例:前天逾期', { due: ymd(-2) }),
    R('n1', '示例:三天后', { due: ymd(3), project_id: 'p_b' }),
    R('n2', '示例:十天后', { due: ymd(10) }),
    R('m1', '示例:四十天后', { due: ymd(40) }),
    R('u1', '示例:还没定期限', {}),
    R('u2', '示例:也没定期限', {}),
  ];
  window.__tasksFixture = {
    requirements,
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }, { id: 'p_b', name: '示例项目-B', color: '#16a34a', sort: 2, archived: false }],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date'],
  };
  window.__calToday = ymd(0);
};
const TODAY_COUNT = 7;

const rows = [];
let failures = 0;
const r1 = (n) => Math.round(n * 10) / 10;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tid = (id) => `[data-testid="${id}"]`;
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2, cx: b.x + b.width / 2, text: el.textContent };
}, sel);
const count = (page, prefix) => page.evaluate((p) => document.querySelectorAll(`[data-testid^="${p}"]`).length, prefix);
const overflow = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
const detailName = async (page) => {
  await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 10000 }).catch(() => {});
  return page.evaluate(() => document.querySelector('[data-testid="req-edit-name"]')?.value ?? null);
};

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });

async function open(page, kind) {
  await page.goto(kind === 'phone' ? `${url}?safeAreaSim=0,0,0,0` : url);
  if (kind === 'desktop') {
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  } else {
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  }
  await page.locator(tid('tasks-view-calendar')).first().click({ timeout: 20000 });
  await page.locator(tid(kind === 'phone' ? 'calendar-phone' : 'calendar')).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
}

const VIEWPORTS = [
  { w: 1320, h: 754, kind: 'desktop' },
  { w: 1000, h: 700, kind: 'desktop' },
  { w: 390, h: 844, kind: 'phone' },
];

for (const theme of ['light', 'dark']) {
  for (const v of VIEWPORTS) {
    const vp = `${v.kind} ${v.w}x${v.h} ${theme}`;
    const touch = v.kind === 'phone';
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(fixture);
    await page.addInitScript(initScript, { theme });
    try {
      await open(page, v.kind);
    } catch (e) {
      record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] });
      await ctx.close();
      continue;
    }
    const shot = (name) => OUT && page.screenshot({ path: join(OUT, `${v.kind}-${v.w}x${v.h}-${theme}-${name}.png`) });
    await shot('calendar');
    const today = await page.evaluate(() => window.__calToday);

    if (v.kind === 'desktop') {
      const seg = await Promise.all(['list', 'board', 'gantt', 'calendar'].map(k => box(page, tid(`tasks-view-${k}`))));
      record(vp, 'segments', { four: seg.every(Boolean), order: seg.every((b, i) => i === 0 || b.x > seg[i - 1].x), label: seg[3]?.text === '日历' });

      const tb = await Promise.all(['cal-mode', 'cal-prev', 'cal-title', 'cal-next', 'cal-today', 'cal-undated-chip'].map(k => box(page, tid(k))));
      const cys = tb.map(b => b?.cy ?? NaN);
      record(vp, 'toolbar centre line', { all: tb.every(Boolean), centre: Math.max(...cys) - Math.min(...cys) <= 1 }, { cy: cys.map(r1).join('/') });

      const grid = await page.evaluate(() => {
        const g = document.querySelector('[data-testid="cal-grid"]').getBoundingClientRect();
        const cells = [...document.querySelectorAll('[data-testid^="cal-cell-"]')].map(c => { const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, id: c.dataset.testid }; });
        const head = [...document.querySelector('[data-testid="cal-grid"]').previousElementSibling.children].map(e => { const b = e.getBoundingClientRect(); return b.x + b.width / 2; });
        return { g: { x: g.x, r: g.right, w: g.width }, cells, head };
      });
      const ws = grid.cells.map(c => c.w);
      const rowsY = [...new Set(grid.cells.map(c => Math.round(c.y)))];
      record(vp, 'month grid 6×7', {
        cells42: grid.cells.length === 42, rows6: rowsY.length === 6, equalCols: Math.max(...ws) - Math.min(...ws) <= 1,
        fills: Math.abs(grid.cells[0].x - grid.g.x) <= 1 && Math.abs(grid.cells[6].r - grid.g.r) <= 1,
        headCentred: grid.head.length === 7 && grid.head.every((cx, i) => Math.abs(cx - (grid.cells[i].x + grid.cells[i].w / 2)) <= 1),
      }, { colW: `${r1(Math.min(...ws))}–${r1(Math.max(...ws))}`, rowH: r1(grid.cells[0].h) });

      const inside = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="cal-item-"], [data-testid^="cal-more-"]')].every(el => {
        const cell = el.closest('[data-testid^="cal-cell-"]').getBoundingClientRect(); const b = el.getBoundingClientRect();
        return b.x >= cell.x - 0.5 && b.right <= cell.right + 0.5 && b.y >= cell.y - 0.5 && b.bottom <= cell.bottom + 0.5;
      }));
      const todayNum = await page.evaluate(() => { const e = document.querySelector('[data-testid="cal-today-num"]'); return e ? getComputedStyle(e).backgroundColor : null; });
      record(vp, 'rows inside cells, today highlighted', { inside, todayNum: !!todayNum && todayNum !== 'rgba(0, 0, 0, 0)' });

      const cellInfo = await page.evaluate((d) => {
        const cell = document.querySelector(`[data-testid="cal-cell-${d}"]`);
        const items = [...cell.querySelectorAll('[data-testid^="cal-item-"]')].map(e => ({ id: e.dataset.testid.slice(9), text: e.textContent }));
        const more = cell.querySelector('[data-testid^="cal-more-"]');
        return { items, more: more ? Number(more.textContent.replace(/\D/g, '')) : 0 };
      }, today);
      record(vp, 'today: shown + 「+N」 = all', { sums: cellInfo.items.length + cellInfo.more === TODAY_COUNT, moreShown: cellInfo.more > 0, allDayFirst: cellInfo.items[0]?.id === 'c1' }, { shown: cellInfo.items.map(i => i.id).join(','), more: cellInfo.more });

      await page.locator(tid(`cal-more-${today}`)).click();
      await page.locator(tid('cal-popover')).waitFor({ timeout: 5000 });
      const popN = await count(page, 'cal-pop-item-');
      const pop = await box(page, tid('cal-popover'));
      const popTime = await page.evaluate(() => document.querySelector('[data-testid="cal-pop-item-c2"]')?.textContent);
      await page.waitForTimeout(400); // let the fade-in finish before the screenshot
      await shot('more-popover');
      record(vp, '「+N」 popover lists the whole day', { all: popN === TODAY_COUNT, inViewport: !!pop && pop.x >= 0 && pop.r <= v.w && pop.b <= v.h, time: popTime?.startsWith('15:30') }, { n: popN });
      await page.locator(tid('cal-pop-item-c7')).click();
      const name = await detailName(page);
      record(vp, 'popover row opens detail', { opened: name === '示例:今天第七条', closed: !(await box(page, tid('cal-popover'))) }, { name });
      await page.locator(tid('req-detail-close')).first().click().catch(() => {});
      await page.waitForTimeout(300);

      await page.locator(tid('cal-item-c1')).click();
      const name2 = await detailName(page);
      record(vp, 'cell row opens detail', { opened: name2 === '示例:今天全天高优' }, { name: name2 });
      await shot('detail');
      await page.locator(tid('req-detail-close')).first().click().catch(() => {});
      await page.waitForTimeout(300);

      await page.locator(tid('cal-undated-chip')).click();
      await page.locator(tid('cal-popover')).waitFor({ timeout: 5000 });
      const und = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="cal-undated-"]')].map(e => e.dataset.testid).filter(t => t !== 'cal-undated-chip'));
      const inCell = await count(page, 'cal-item-u');
      record(vp, 'undated popover', { two: und.length === 2, notInCells: inCell === 0 }, { rows: und.join(',') });
      await page.locator(tid('cal-popover-close')).click();
      await page.waitForTimeout(200);

      const t0 = (await box(page, tid('cal-title'))).text;
      await page.locator(tid('cal-mode-week')).click();
      await page.waitForTimeout(300);
      const wk = await page.evaluate((d) => ({ cells: document.querySelectorAll('[data-testid^="cal-cell-"]').length, items: document.querySelector(`[data-testid="cal-cell-${d}"]`)?.querySelectorAll('[data-testid^="cal-item-"]').length ?? -1, more: !!document.querySelector(`[data-testid="cal-more-${d}"]`) }), today);
      await shot('week');
      // 周视图里今天的七条都在格子里:带时刻的写本地 15:30(07:30Z + 8h),全天的不写时刻
      const texts = await page.evaluate(() => ({ c2: document.querySelector('[data-testid="cal-item-c2"]')?.textContent, c1: document.querySelector('[data-testid="cal-item-c1"]')?.textContent }));
      record(vp, 'local time on timed due only', { timed: texts.c2 === '15:30示例:今天下午三点半', allDay: texts.c1 === '示例:今天全天高优' }, { c2: texts.c2, c1: texts.c1 });
      const tw = (await box(page, tid('cal-title'))).text;
      await page.locator(tid('cal-next')).click();
      const tNext = (await box(page, tid('cal-title'))).text;
      await page.locator(tid('cal-today')).click();
      const tBack = (await box(page, tid('cal-title'))).text;
      record(vp, 'week view', { seven: wk.cells === 7, allToday: wk.items === TODAY_COUNT && !wk.more, turned: tNext !== tw, back: tBack === tw }, { title: tw, next: tNext });
      await page.locator(tid('cal-mode-month')).click();
      await page.locator(tid('cal-next')).click();
      const tm = (await box(page, tid('cal-title'))).text;
      await page.locator(tid('cal-today')).click();
      record(vp, 'month prev/next/today', { turned: tm !== t0, back: (await box(page, tid('cal-title'))).text === t0 }, { now: t0, next: tm });

      record(vp, 'no horizontal page overflow', { none: (await overflow(page)) <= 0 });
    } else {
      const seg = await Promise.all(['list', 'board', 'gantt', 'calendar', 'dispatch'].map(k => box(page, tid(`tasks-view-${k}`))));
      record(vp, 'segments fit', { five: seg.every(Boolean), inGutter: seg[0].x >= 15 && seg[4].r <= v.w - 15, oneLine: Math.max(...seg.map(s => s.cy)) - Math.min(...seg.map(s => s.cy)) <= 1 }, { right: r1(seg[4]?.r ?? -1) });

      const g = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('[data-testid^="cal-day-"]')].map(c => { const b = c.getBoundingClientRect(); return { id: c.dataset.testid.slice(8), x: b.x, r: b.right, w: b.width, sel: c.getAttribute('aria-selected') === 'true' }; });
        const dots = [...document.querySelectorAll('[data-testid^="cal-dot-"]')].map(d => d.dataset.testid.slice(8));
        return { cells, dots };
      });
      const ws = g.cells.map(c => c.w);
      const expectDots = await page.evaluate(() => [...new Set(window.__tasksFixture.requirements.filter(r => r.due).map(r => { const t = new Date(r.due.length === 10 ? `${r.due}T12:00:00+08:00` : r.due); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }))]);
      const shownDays = new Set(g.cells.map(c => c.id));
      const want = expectDots.filter(d => shownDays.has(d)).sort().join(',');
      record(vp, 'phone month grid', {
        cells42: g.cells.length === 42, equal: Math.max(...ws) - Math.min(...ws) <= 0.5, gutters: Math.abs(g.cells[0].x - 16) <= 1 && Math.abs(g.cells[6].r - (v.w - 16)) <= 1,
        todayPicked: g.cells.find(c => c.sel)?.id === today, dots: [...g.dots].sort().join(',') === want,
      }, { colW: r1(ws[0]), dots: g.dots.length, want: want.split(',').length });

      const list = await count(page, 'cal-row-');
      const lr = await page.evaluate(() => { const l = document.querySelector('[data-testid="cal-picked-list"]'); const b = l?.getBoundingClientRect(); return b ? { x: b.x, r: b.right } : null; });
      record(vp, 'picked day list', { count: list === TODAY_COUNT, gutters: !!lr && Math.abs(lr.x - 16) <= 1 && Math.abs(lr.r - (v.w - 16)) <= 1 }, { rows: list });

      const t0 = (await box(page, tid('cal-title'))).text;
      const nextDay = g.cells.slice(28).find(c => c.id.slice(0, 7) !== g.cells[15].id.slice(0, 7));
      await page.locator(tid(`cal-day-${nextDay.id}`)).tap();
      await page.waitForTimeout(250);
      const t1 = (await box(page, tid('cal-title'))).text;
      const stillPicked = await page.evaluate((d) => document.querySelector(`[data-testid="cal-day-${d}"]`)?.getAttribute('aria-selected'), nextDay.id);
      record(vp, 'tap a next-month day turns the month', { turned: t1 !== t0, picked: stillPicked === 'true' }, { from: t0, to: t1 });
      await page.locator(tid('cal-today')).tap();
      await page.waitForTimeout(200);

      // a real touch swipe through CDP (right → left across the grid)
      const gb = await box(page, tid('cal-grid'));
      const cdp = await ctx.newCDPSession(page);
      const pt = (x) => [{ x, y: gb.cy }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(gb.cx + 120) });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(gb.cx + 120 - i * 25) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(250);
      const t2 = (await box(page, tid('cal-title'))).text;
      record(vp, 'left swipe → next month', { turned: t2 !== t0 }, { to: t2 });
      await page.locator(tid('cal-today')).tap();
      await page.waitForTimeout(200);

      record(vp, 'undated section', { present: !!(await box(page, tid('cal-undated'))), two: (await count(page, 'cal-undated-u')) === 2 });
      record(vp, 'no horizontal page overflow', { none: (await overflow(page)) <= 0 });
      await page.locator(tid('cal-row-c2')).tap();
      const name = await detailName(page);
      record(vp, 'tap row opens detail', { opened: name === '示例:今天下午三点半' }, { name });
      await shot('detail');
    }
    await ctx.close();
  }
}

await browser.close();
close();
console.log('\n| viewport | check | result | detail |\n|---|---|---|---|');
for (const r of rows) {
  const { vp, what, ok, failed, ...detail } = r;
  console.log(`| ${vp} | ${what} | ${ok ? 'PASS' : `FAIL (${failed})`} | ${Object.entries(detail).map(([k, v]) => `${k}=${v}`).join(' ')} |`);
}
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
process.exit(failures ? 1 : 0);
