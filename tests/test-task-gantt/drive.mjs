// 任务页「甘特图」视图 —— 在 web 导出里量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-gantt/drive.mjs
//
// Desktop 1320×754 / 1000×700 (mouse, desktop workspace), light + dark:
//   segments   : 列表 / 看板 / 甘特图 in the header segment
//   toolbar    : group / scale / 今天 / start note share one centre line ±1
//   rows       : every bar's centre line == its name row's centre line ±1 (the frozen column and the timeline agree)
//   geometry   : bar width == (days incl.) × 32 − 2 ±1 (day), × 10 − 2 (week); a task created today starts under the today line
//   today      : the today line is inside the visible timeline after opening; the header's today tick is centred on it ±1
//   h-sync     : scrolling the timeline 240px moves the header ticks by the same 240px ±1
//   sticky     : scrolling the chart 200px down leaves the date header where it was ±1
//   group      : 按负责 Agent → agent groups; 按项目 → project groups (project order, 无项目 last)
//   undated    : tasks without a due date are listed under 未设期限, not drawn
//   open       : clicking a bar opens the existing task detail (req-edit-name shows that task's title)
//   drag       : dragging a bar's right end 96px → exactly one PATCH whose body is { due } (+3 days), preview + label while
//                dragging, bar keeps the new width, no detail opens; dragging far left clamps at the start day;
//                a rejected PATCH puts the bar back and shows a banner
//   start      : a task with the hub's start field (capability start_date) starts there, not at createdAt
//   overflow   : no horizontal page scroll
// Phone 390×844 (Android UA, touch), light + dark:
//   segments fit inside the 16px gutters; the week list opens on 本周; rows sit on the 16px gutters;
//   the seven strip cells are equal ±0.5 and today's cell is marked; tapping a row opens the pushed detail; no page overflow;
//   no drag handles on touch.
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// ── fixture: placeholder names only ──
const fixture = () => {
  // Runs in the page (timezone Asia/Shanghai). Dates are relative to "now" so the chart always has a today line.
  const day = 86400000;
  const now = Date.now();
  const at = (d) => new Date(now + d * day);
  const ymd = (d) => { const t = at(d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const R = (id, name, o) => ({ id, name, priority: 'normal', assignee: '', column: 'pool', start: '' /* a start_date hub sends it on every row */, owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(-5).toISOString(), updatedAt: at(-1).toISOString(), description: '', checklist: [], ...o });
  const A = { kind: 'node', id: 'n_sweep_a' }, B = { kind: 'node', id: 'n_sweep_b' };
  const requirements = [
    R('g1', '示例:官网首页改版', { project_id: 'p_a', agent_owner: A, createdAt: at(-20).toISOString(), due: ymd(3), column: 'doing', priority: 'high' }),
    R('g2', '示例:今天新建今天交', { project_id: 'p_a', agent_owner: B, createdAt: at(0).toISOString(), due: ymd(0) }),
    R('g3', '示例:已经逾期的任务', { project_id: 'p_a', agent_owner: A, createdAt: at(-14).toISOString(), due: ymd(-2) }),
    R('g4', '示例:下周的发布', { project_id: 'p_b', agent_owner: B, createdAt: at(-3).toISOString(), due: ymd(9), column: 'doing' }),
    R('g5', '示例:已完成的活', { project_id: 'p_b', agent_owner: A, createdAt: at(-10).toISOString(), due: ymd(-4), column: 'done' }),
    R('g6', '示例:很久以前建的', { project_id: 'p_b', createdAt: at(-200).toISOString(), due: ymd(6) }),
    R('g7', '示例:没有项目', { agent_owner: A, createdAt: at(-7).toISOString(), due: ymd(12), priority: 'low' }),
    R('g8', '示例:期限改到创建之前', { agent_owner: B, createdAt: at(-1).toISOString(), due: ymd(-3) }),
    R('g9', '示例:设了开始', { project_id: 'p_b', agent_owner: A, createdAt: at(-30).toISOString(), start: ymd(-2), due: ymd(4) }),
    R('u1', '示例:还没定期限', { project_id: 'p_a', agent_owner: A }),
    R('u2', '示例:也没定期限', { agent_owner: B }),
    ...Array.from({ length: 14 }, (_, i) => R(`f${i}`, `示例:填充任务 ${i + 1}`, { project_id: i % 2 ? 'p_a' : 'p_b', agent_owner: i % 3 ? A : B, createdAt: at(-8 + i).toISOString(), due: ymd(2 + i), column: i % 4 === 0 ? 'done' : 'pool' })),
  ];
  window.__tasksFixture = {
    requirements,
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }, { id: 'p_b', name: '示例项目-B', color: '#16a34a', sort: 2, archived: false }],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-A' },
      { kind: 'node', id: 'n_sweep_b', networkId: 'net-sweep', name: '示例-B' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date'],
  };
};
const DAYS = { g1: 24, g2: 1, g3: 13, g4: 13, g5: 7, g8: 1, g9: 7 }; // inclusive day spans (start = created day; g9 has its own start)

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
// Text checks also demand the PAINTED box (after overflow clipping) — a 0-wide label keeps its textContent.
const painted = (p) => !!p && p.painted && p.w >= 8;
const pw = (p) => p ? `${r1(p.w)}×${r1(p.h)}` : 'none';
const overflow = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);

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
  await page.locator(tid('tasks-view-gantt')).first().click({ timeout: 20000 });
  await page.locator(kind === 'phone' ? tid('gantt-weeks') : tid('gantt-timeline')).first().waitFor({ timeout: 20000 });
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
    await shot('gantt');

    if (v.kind === 'desktop') {
      const seg = await Promise.all(['list', 'board', 'gantt'].map(k => box(page, tid(`tasks-view-${k}`))));
      record(vp, 'segments', { three: seg.every(Boolean), order: seg[0].x < seg[1].x && seg[1].x < seg[2].x, label: seg[2].text === '甘特图' }, { gantt: seg[2]?.text });

      const bar = await Promise.all(['gantt-group', 'gantt-scale', 'gantt-today', 'gantt-start-note'].map(k => box(page, tid(k))));
      const cys = bar.map(b => b?.cy ?? NaN);
      record(vp, 'toolbar centre line', { all: bar.every(Boolean), centre: Math.max(...cys) - Math.min(...cys) <= 1 }, { cy: cys.map(r1).join('/') });

      // every visible bar vs its name row
      const align = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="gantt-bar-"]')].map(b => {
        const id = b.dataset.testid.slice('gantt-bar-'.length);
        const n = document.querySelector(`[data-testid="gantt-name-${id}"]`);
        const bb = b.getBoundingClientRect(), nb = n?.getBoundingClientRect();
        return { id, d: nb ? Math.abs((bb.y + bb.height / 2) - (nb.y + nb.height / 2)) : 99 };
      }));
      record(vp, 'bar rows == name rows', { some: align.length >= 21, aligned: align.every(a => a.d <= 1) }, { bars: align.length, maxDelta: r1(Math.max(...align.map(a => a.d))) });

      const tl = await box(page, tid('gantt-today-line'));
      const view = await box(page, tid('gantt-timeline'));
      const g2 = await box(page, tid('gantt-bar-g2'));
      const todayTick = await page.evaluate(() => {
        const accent = [...document.querySelectorAll('[data-testid="gantt-head"] div')].filter(e => e.children.length === 0 && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' && /^\d+$/.test(e.textContent));
        const b = accent[0]?.getBoundingClientRect();
        return b ? { cx: b.x + b.width / 2 } : null;
      });
      record(vp, 'today line', {
        visible: !!tl && tl.x > view.x && tl.x < view.r,
        tickCentred: !!todayTick && Math.abs(todayTick.cx - (tl.x + 1)) <= 1,
        createdTodayStartsThere: !!g2 && Math.abs(g2.x - 1 + 16 - (tl.x + 1)) <= 1,
      }, { lineX: r1(tl?.x ?? -1), tickCx: r1(todayTick?.cx ?? -1), g2x: r1(g2?.x ?? -1) });

      // month header: the leftmost visible day's month is pinned; the header count adds the undated ones
      const monthGeo = async () => page.evaluate(() => {
        const view = document.querySelector('[data-testid="gantt-timeline"]').getBoundingClientRect();
        const ticks = [...document.querySelectorAll('[data-testid^="gantt-tick-"]')].map(e => ({ date: e.dataset.testid.slice(11), b: e.getBoundingClientRect() }));
        const first = ticks.find(t => t.b.right > view.x + 1);
        const pin = document.querySelector('[data-testid="gantt-pinned-month"]');
        const pb = pin.getBoundingClientRect();
        const labels = [...document.querySelectorAll('[data-testid="gantt-head"] div')].filter(e => e !== pin && e.children.length === 0 && /年\d+月$/.test(e.textContent) && !pin.contains(e))
          .map(e => { const b = e.getBoundingClientRect(); return { text: e.textContent, x: b.x, r: b.right, cy: b.y + b.height / 2 }; }).filter(l => l.x >= view.x && l.x < view.right);
        const [y, m] = first.date.split('-').map(Number);
        return { expect: `${y}年${m}月`, pin: pin.textContent, pinX: pb.x, pinR: pb.right, pinCy: pb.y + pb.height / 2, viewX: view.x, labels };
      });
      const mg = await monthGeo();
      const pinP = await paintedText(page, tid('gantt-pinned-month'));
      record(vp, 'pinned month = leftmost visible day', {
        text: mg.pin === mg.expect && painted(pinP), atLeft: Math.abs(mg.pinX - mg.viewX) <= 1,
        sameLine: mg.labels.every(l => Math.abs(l.cy - mg.pinCy) <= 1), noOverlap: mg.labels.every(l => l.x >= mg.pinR - 0.5),
      }, { pin: mg.pin, expect: mg.expect, others: mg.labels.map(l => l.text).join('/'), pinPainted: pw(pinP) });
      // scroll so the next month's 1st sits 40px from the left edge: the pinned label is pushed out, not drawn over it
      await page.evaluate(() => {
        const sc = document.querySelector('[data-testid="gantt-timeline"]');
        const view = sc.getBoundingClientRect();
        const t = [...document.querySelectorAll('[data-testid^="gantt-tick-"]')].find(e => e.dataset.testid.endsWith('-01') && e.getBoundingClientRect().x > view.x + 60);
        sc.scrollLeft += t.getBoundingClientRect().x - view.x - 40;
      });
      await page.waitForTimeout(250);
      const mg2 = await monthGeo();
      record(vp, 'pinned month pushed at a month boundary', { noOverlap: mg2.labels.every(l => l.x >= mg2.pinR - 0.5), pushed: mg2.pinX < mg2.viewX - 1 }, { pin: mg2.pin, pinX: r1(mg2.pinX - mg2.viewX), next: mg2.labels[0]?.text });
      await shot('month-boundary');
      await page.locator(tid('gantt-today')).click();
      await page.waitForTimeout(500);
      const cnt = await page.evaluate(() => ({ head: document.querySelector('[data-testid="gantt-head"]').firstElementChild.textContent, bars: document.querySelectorAll('[data-testid^="gantt-bar-"]').length, undated: document.querySelectorAll('[data-testid^="gantt-undated-"]').length }));
      const side = await page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid="task-sidebar"] div')].find(d => d.children.length === 0 && d.textContent === '全部任务'); return el ? Number(el.parentElement.parentElement.textContent.replace(/\D+/g, ' ').trim().split(' ').pop()) : null; });
      const headP = await paintedText(page, `${tid('gantt-head')} > :first-child`);
      record(vp, 'header count adds up to the sidebar', { undatedShown: cnt.head === `任务${cnt.bars}· 未设期限 ${cnt.undated}` && painted(headP), sum: side !== null && cnt.bars + cnt.undated === side }, { head: cnt.head, sidebar: side, headPainted: pw(headP) });

      const widths = {};
      for (const id of Object.keys(DAYS)) widths[id] = (await box(page, tid(`gantt-bar-${id}`)))?.w ?? -1;
      record(vp, 'bar width = days × 32 − 2 (day)', Object.fromEntries(Object.entries(DAYS).map(([id, n]) => [id, Math.abs(widths[id] - (n * 32 - 2)) <= 1])), { widths: Object.entries(widths).map(([k, w]) => `${k}:${r1(w)}`).join(' ') });

      // horizontal sync: header ticks follow the timeline
      const before = { line: tl.x, tick: todayTick?.cx };
      await page.evaluate(() => { const sc = document.querySelector('[data-testid="gantt-timeline"]'); sc.scrollLeft += 240; });
      await page.waitForTimeout(250);
      const tl2 = await box(page, tid('gantt-today-line'));
      const tick2 = await page.evaluate(() => {
        const accent = [...document.querySelectorAll('[data-testid="gantt-head"] div')].filter(e => e.children.length === 0 && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' && /^\d+$/.test(e.textContent));
        const b = accent[0]?.getBoundingClientRect(); return b ? b.x + b.width / 2 : null;
      });
      const moved = before.line - tl2.x;
      record(vp, 'header scrolls with timeline', { moved: moved > 100, same: tick2 !== null && Math.abs((before.tick - tick2) - moved) <= 1 }, { line: r1(moved), tick: r1(before.tick - tick2) });

      // sticky header
      const head0 = await box(page, tid('gantt-head'));
      await page.evaluate(() => { document.querySelector('[data-testid="gantt-scroll"]').scrollTop = 200; });
      await page.waitForTimeout(250);
      const head1 = await box(page, tid('gantt-head'));
      const g1b = await box(page, tid('gantt-name-g1'));
      record(vp, 'date header stays on top', { stays: Math.abs(head1.y - head0.y) <= 1, bodyScrolled: !!g1b && g1b.y < head0.b }, { headY: `${r1(head0.y)}→${r1(head1.y)}` });
      await shot('scrolled');
      await page.evaluate(() => { document.querySelector('[data-testid="gantt-scroll"]').scrollTop = 0; });

      const groupsP = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="gantt-group-"]')].map(e => e.dataset.testid).filter(t => !/gantt-group-(project|agent)$/.test(t)));
      const undated = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="gantt-undated-"]')].map(e => e.dataset.testid));
      record(vp, 'group by project + undated', {
        order: groupsP.join(',') === 'gantt-group-p_a,gantt-group-p_b,gantt-group-__no_project__',
        undatedListed: undated.length === 2, undatedNotDrawn: !(await box(page, tid('gantt-bar-u1'))),
      }, { groups: groupsP.join(','), undated: undated.length });

      await page.locator(tid('gantt-group-agent')).click();
      await page.waitForTimeout(300);
      const groupsA = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="gantt-group-"]')].map(e => e.dataset.testid).filter(t => !/gantt-group-(project|agent)$/.test(t)));
      record(vp, 'group by agent', { order: groupsA.join(',') === 'gantt-group-node:n_sweep_a,gantt-group-node:n_sweep_b,gantt-group-__no_agent__' }, { groups: groupsA.join(',') });
      await shot('by-agent');

      await page.locator(tid('gantt-scale-week')).click();
      await page.waitForTimeout(400);
      const wk = {};
      for (const id of ['g1', 'g4']) wk[id] = (await box(page, tid(`gantt-bar-${id}`)))?.w ?? -1;
      const tlw = await box(page, tid('gantt-today-line'));
      const vieww = await box(page, tid('gantt-timeline'));
      record(vp, 'week scale', { g1: Math.abs(wk.g1 - (DAYS.g1 * 10 - 2)) <= 1, g4: Math.abs(wk.g4 - (DAYS.g4 * 10 - 2)) <= 1, todayVisible: tlw.x > vieww.x && tlw.x < vieww.r }, { g1: r1(wk.g1), g4: r1(wk.g4) });
      await shot('week');
      await page.locator(tid('gantt-scale-day')).click();
      await page.locator(tid('gantt-group-project')).click();

      record(vp, 'no horizontal page overflow', { none: (await overflow(page)) <= 0 });

      // ── drag the right end to change the due date (only { due } is sent) ──
      const due4 = await page.evaluate(() => window.__tasksFixture.requirements.find(r => r.id === 'g4').due);
      await page.locator(tid('gantt-handle-g4')).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const w4 = (await box(page, tid('gantt-bar-g4'))).w;
      const h4 = await box(page, tid('gantt-handle-g4'));
      await page.mouse.move(h4.cx, h4.cy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(h4.cx + i * 12, h4.cy);
      await page.waitForTimeout(150);
      const label = await box(page, tid('gantt-drag-label'));
      const wDuring = (await box(page, tid('gantt-bar-g4'))).w;
      await shot('dragging');
      await page.mouse.up();
      await page.waitForTimeout(600);
      const patches = await page.evaluate(() => window.__tasksPatches || []);
      const expectDue = await page.evaluate((d) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd + 3)); return t.toISOString().slice(0, 10); }, due4);
      const wAfter = (await box(page, tid('gantt-bar-g4'))).w;
      const detailOpen = !!(await box(page, tid('req-edit-name')));
      record(vp, 'drag end → due +3 days', {
        label: !!label && label.x > h4.x, previewGrows: Math.abs(wDuring - (w4 + 96)) <= 1,
        onePatch: patches.length === 1, dueOnly: patches.length === 1 && Object.keys(patches[0]).join() === 'due', value: patches[0]?.due === expectDue,
        barAfter: Math.abs(wAfter - (w4 + 96)) <= 1, noDetail: !detailOpen,
      }, { patch: JSON.stringify(patches[0] ?? null), label: label?.text, w: `${r1(w4)}→${r1(wAfter)}` });

      // far left: clamped at the start day
      const h4b = await box(page, tid('gantt-handle-g4'));
      await page.mouse.move(h4b.cx, h4b.cy); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(h4b.cx - i * 60, h4b.cy);
      await page.mouse.up();
      await page.waitForTimeout(600);
      const p2 = await page.evaluate(() => window.__tasksPatches || []);
      const created4 = await page.evaluate(() => { const t = new Date(window.__tasksFixture.requirements.find(r => r.id === 'g4').createdAt); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; });
      const w4c = (await box(page, tid('gantt-bar-g4'))).w;
      record(vp, 'drag left clamps at start', { clamped: p2[1]?.due === created4, oneDay: Math.abs(w4c - 30) <= 1 }, { due: p2[1]?.due, start: created4 });

      // failure: the hub rejects → the bar goes back, a banner says why
      await page.evaluate(() => { window.__tasksFailPatch = true; });
      await page.locator(tid('gantt-handle-g1')).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const w5 = (await box(page, tid('gantt-bar-g1'))).w;
      const h5 = await box(page, tid('gantt-handle-g1'));
      await page.mouse.move(h5.cx, h5.cy); await page.mouse.down();
      for (let i = 1; i <= 4; i++) await page.mouse.move(h5.cx + i * 16, h5.cy);
      await page.mouse.up();
      await page.waitForTimeout(800);
      const w5b = (await box(page, tid('gantt-bar-g1'))).w;
      // the banner text's painted box (clipped by overflow ancestors); the best-painted match if several
      const bannerP = await page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.children.length === 0 && /示例:官网首页改版/.test(d.textContent) && /不存在|没有保存/.test(d.textContent)).map(d => {
        const b = d.getBoundingClientRect(); let w = b.width, h = b.height;
        for (let a = d.parentElement; a && a !== document.body; a = a.parentElement) {
          const c = getComputedStyle(a); if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
          const r = a.getBoundingClientRect(); w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left))); h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)));
        }
        return { w, h, painted: w >= 1 && h >= 1 };
      }).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null);
      record(vp, 'rejected drag reverts', { reverted: Math.abs(w5b - w5) <= 1, banner: painted(bannerP) }, { w: `${r1(w5)}→${r1(w5b)}`, bannerPainted: pw(bannerP) });
      await page.evaluate(() => { window.__tasksFailPatch = false; });

      const g9 = await box(page, tid('gantt-bar-g9'));
      const note = await box(page, tid('gantt-start-note'));
      record(vp, 'hub start field', { ownStart: !!g9 && Math.abs(g9.w - (7 * 32 - 2)) <= 1, note: note?.text === '没设开始的从创建时间画起' }, { g9: r1(g9?.w ?? -1) });

      await page.locator(tid('gantt-bar-g4')).click();
      await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 10000 }).catch(() => {});
      const name = await page.evaluate(() => document.querySelector('[data-testid="req-edit-name"]')?.value ?? null);
      record(vp, 'click bar opens detail', { opened: name === '示例:下周的发布' }, { name });
      await shot('detail');

      // ── 详情「更多」里的「开始」:点「今天」→ 保存 → 只发 { start },条从今天画起 ──
      // close the previous drawer first (it overlays the chart), then open g7 from its name cell
      await page.locator(tid('req-detail-close')).first().click();
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector('[data-testid="gantt-name-g7"]').scrollIntoView({ block: 'center' }));
      await page.locator(tid('gantt-name-g7')).click();
      await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 10000 });
      if (!(await box(page, tid('req-more')))) await page.locator(tid('req-more-toggle')).click();
      const field = await box(page, tid('req-edit-start'));
      const nBefore = (await page.evaluate(() => (window.__tasksPatches || []).length));
      await page.locator(tid('req-edit-start-today')).click();
      await page.locator(tid('req-edit-save')).click();
      await page.waitForTimeout(700);
      const sp = await page.evaluate((n) => (window.__tasksPatches || []).slice(n), nBefore);
      const todayYmd = await page.evaluate(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; });
      const g7 = await box(page, tid('gantt-bar-g7'));
      const line = await box(page, tid('gantt-today-line'));
      await page.locator(tid('req-more-toggle')).click();
      const sum = await box(page, tid('req-more-summary'));
      const sumP = await paintedText(page, tid('req-more-summary'));
      record(vp, 'detail: set start', {
        field: !!field, startOnly: sp.length === 1 && JSON.stringify(sp[0]) === JSON.stringify({ start: todayYmd }),
        barFromToday: !!g7 && Math.abs(g7.x - 1 + 16 - (line.x + 1)) <= 1, summary: !!sum && sum.text.startsWith(`${+todayYmd.slice(5, 7)}月${+todayYmd.slice(8, 10)}日开始`) && painted(sumP),
      }, { patch: JSON.stringify(sp[0] ?? null), summary: sum?.text, summaryPainted: pw(sumP) });
      await shot('detail-start');
    } else {
      const seg = await Promise.all(['list', 'board', 'gantt', 'dispatch'].map(k => box(page, tid(`tasks-view-${k}`))));
      record(vp, 'segments fit', { four: seg.every(Boolean), inGutter: seg[0].x >= 16 - 1 && seg[3].r <= v.w - 16 + 1, oneLine: Math.max(...seg.map(s => s.cy)) - Math.min(...seg.map(s => s.cy)) <= 1 }, { left: r1(seg[0].x), right: r1(seg[3].r) });

      const today = await page.evaluate(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; });
      const monday = await page.evaluate((d) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd)); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); }, today);
      const wk = await box(page, tid(`gantt-week-${monday}`));
      const list = await box(page, tid('gantt-weeks'));
      record(vp, 'opens on this week', { exists: !!wk, atTop: !!wk && Math.abs(wk.y - list.y) <= 2 }, { weekY: r1(wk?.y ?? -1), listY: r1(list?.y ?? -1) });

      const row = await box(page, tid('gantt-week-row-g2'));
      const card = await page.evaluate(() => { const r = document.querySelector('[data-testid="gantt-week-row-g2"]'); const b = r.parentElement.getBoundingClientRect(); return { x: b.x, r: b.right, inner: r.parentElement.clientWidth }; });
      record(vp, 'rows on 16px gutters', { left: Math.abs(card.x - 16) <= 1, right: Math.abs(card.r - (v.w - 16)) <= 1, rowFills: !!row && Math.abs(row.w - card.inner) <= 1 }, { x: r1(card.x), r: r1(card.r) });

      const cells = await page.evaluate(() => [...document.querySelectorAll('[data-testid="gantt-strip-g2"] > div')].map(c => { const b = c.getBoundingClientRect(); return { w: b.width, border: getComputedStyle(c).borderTopColor }; }));
      const idx = await page.evaluate((d) => { const [y, m, dd] = d.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7; }, today);
      record(vp, 'seven-day strip', { seven: cells.length === 7, equal: Math.max(...cells.map(c => c.w)) - Math.min(...cells.map(c => c.w)) <= 0.5, todayMarked: cells.length === 7 && cells.filter(c => c.border !== 'rgba(0, 0, 0, 0)').length === 1 && cells[idx].border !== 'rgba(0, 0, 0, 0)' }, { w: r1(cells[0]?.w ?? -1), todayIdx: idx });

      record(vp, 'no horizontal page overflow', { none: (await overflow(page)) <= 0 });
      const und = await box(page, tid('gantt-undated'));
      record(vp, 'undated section', { present: !!und });
      record(vp, 'touch: no drag handles', { none: (await page.locator('[data-testid^="gantt-handle-"]').count()) === 0 });

      await page.locator(tid('gantt-week-row-g2')).tap();
      await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 10000 }).catch(() => {});
      const name = await page.evaluate(() => document.querySelector('[data-testid="req-edit-name"]')?.value ?? null);
      record(vp, 'tap row opens detail', { opened: name === '示例:今天新建今天交' }, { name });
      await shot('detail');
    }
    await ctx.close();
  }
}

// Old hub (no start_date capability, rows without `start`): the detail has no 开始 field and the bars still start at createdAt.
{
  const vp = 'desktop 1320x754 light old-hub';
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 754 }, colorScheme: 'light', deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.addInitScript(fixture);
  await page.addInitScript(() => {
    const f = window.__tasksFixture;
    f.capabilities = f.capabilities.filter(c => c !== 'start_date');
    for (const r of f.requirements) delete r.start;
  });
  await page.addInitScript(initScript, { theme: 'light' });
  await open(page, 'desktop');
  const note = await box(page, tid('gantt-start-note'));
  const g9 = await box(page, tid('gantt-bar-g9'));
  await page.locator(tid('gantt-bar-g9')).click();
  await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 10000 });
  if (!(await box(page, tid('req-more')))) await page.locator(tid('req-more-toggle')).click();
  record(vp, 'old hub: no start field, createdAt start', {
    noField: !(await box(page, tid('req-edit-start'))), note: note?.text === '开始 = 创建时间(Hub 还没有开始字段)', createdStart: !!g9 && g9.w > 7 * 32,
  }, { g9: r1(g9?.w ?? -1) });
  await ctx.close();
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
