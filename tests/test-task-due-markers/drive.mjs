// 到期提示 + 快捷筛选(#491 / #493)—— 量真框、点真胶囊。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-due-markers/drive.mjs
//
// desktop 1280×800 (Tauri stub ⇒ mouse, timezone Pacific/Kiritimati UTC+14) and phone 390×844 (Android UA ⇒ touch,
// timezone Pacific/Honolulu UTC−10), light + dark. Both time zones put the local calendar date on a different day
// from the UTC date for much of the day — the fixture writes due dates from the page's *local* calendar, so a
// UTC-shift bug shows up as 「今天到期」 on the wrong card.
//   markers   今天到期 / 明天到期 / 已逾期 2 天 / 已逾期 1 天 on the right cards; a done card with an old due shows a plain
//             date (never 逾期); overdue text = danger colour, today = tomorrow = warning colour, tomorrow has no tint
//   geometry  marker baseline = priority badge baseline in the same meta row (±1px), marker below the title, inside
//             the card; desktop list: marker centre line = title centre line in the row (±1px)
//   chips     我负责 / 我参与 / 已逾期 in the filter row (desktop: board toolbar; phone: the horizontally scrolling
//             filter row): same height and centre line as 负责人 / 优先级 / 状态 (±0.5px), equal gaps (±0.5px),
//             no horizontal page overflow
//   filters   已逾期 → only the overdue, not-done cards; + 我参与 → intersection; 我负责 ↔ 我参与 are exclusive;
//             clearing brings every card back
// Prints a measurement table. Exit 1 when any check fails.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// Runs in the page: dates come from the page's local calendar (its timezoneId), never from toISOString().
const fixture = () => {
  const pad = (n) => String(n).padStart(2, '0');
  const day = (delta) => { const d = new Date(); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, other = { kind: 'user', id: 'u_a' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: other, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000 - seq), updatedAt: at(1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  window.__dueFixtureDates = { today: day(0), utcToday: new Date().toISOString().slice(0, 10) };
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('t1', 1, '示例任务:今天到期', { due: day(0), owner: me }),
      R('t2', 2, '示例任务:明天到期', { due: day(1), participants: [me], column: 'doing' }),
      R('t3', 3, '示例任务:已逾期两天', { due: day(-2), priority: 'high' }),
      R('t4', 4, '示例任务:已完成', { due: day(-5), owner: me, column: 'done' }),
      R('t5', 5, '示例任务:以后', { due: day(10), owner: me }),
      R('t6', 6, '示例任务:逾期且我参与', { due: day(-1), participants: [me], column: 'doing' }),
      R('t7', 7, '示例任务:没有期限', { owner: me }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
};

const EXPECT = { t1: '今天到期', t2: '明天到期', t3: '已逾期 2 天', t6: '已逾期 1 天' };
const ALL = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
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

// In-page geometry of one card / row: title text, marker text, priority-badge text, each with its box and real
// baseline (a 0×0 inline-block probe sits on the line's baseline).
const geometry = (page, id) => page.evaluate((id) => {
  const card = document.querySelector(`[data-testid="req-card-${id}"]`) || document.querySelector(`[data-testid="req-row-${id}"]`);
  if (!card || !card.getClientRects().length) return null;
  const baseline = (el) => { const s = document.createElement('span'); s.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; el.appendChild(s); const y = s.getBoundingClientRect().top; s.remove(); return y; };
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2, base: baseline(el), color: getComputedStyle(el).color }; };
  // The icon glyph is a text node too (first); the label is the last element that owns text.
  const ownText = (root, pred) => [...root.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && pred(e)).pop();
  const due = card.querySelector('[data-testid="task-due"]');
  const dueText = due ? ownText(due, () => true) : null;
  const prio = card.querySelector('[data-testid="task-prio-badge"]');
  const prioText = prio ? ownText(prio, () => true) : null;
  const name = card.getAttribute('aria-label') || '';
  // The title is the first text in the card whose text starts the card's aria-label (「示例任务:…」).
  const title = [...card.querySelectorAll('*')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.textContent.trim().startsWith('示例任务') && name.startsWith(e.textContent.trim()));
  const cb = card.getBoundingClientRect();
  return {
    card: { x: cb.x, y: cb.y, w: cb.width, h: cb.height },
    title: box(title), due: due ? { ...box(due), bg: getComputedStyle(due).backgroundColor } : null, dueText: box(dueText), dueLabel: dueText?.textContent ?? '', prio: box(prio), prioText: box(prioText),
  };
}, id);

const chipIds = ['task-quick-mine', 'task-quick-participating', 'task-quick-overdue', 'task-filter-owner', 'task-filter-priority', 'task-filter-project', 'task-filter-status'];
const chipRow = (page) => page.evaluate((ids) => ids.map(id => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e || !e.getClientRects().length) return { id, b: null }; const b = e.getBoundingClientRect(); return { id, b: { x: b.x, y: b.y, w: b.width, h: b.height }, sel: e.getAttribute('aria-selected') }; }), chipIds);
const visibleIds = (page, prefix) => page.evaluate((prefix) => [...document.querySelectorAll(`[data-testid^="${prefix}"]`)].filter(e => e.getClientRects().length).map(e => e.getAttribute('data-testid').slice(prefix.length)).filter(x => /^t\d$/.test(x)).sort(), prefix);

const VIEWS = {
  desktop: { w: 1280, h: 800, tz: 'Pacific/Kiritimati' },
  phone: { w: 390, h: 844, ua: ANDROID_UA, tz: 'Pacific/Honolulu' },
};
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [kind, V] of Object.entries(VIEWS)) for (const theme of ['light', 'dark']) {
  const where = `${kind}/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: V.tz });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${kind}-${theme}-${n}.png` }); };
  const press = async (sel) => { const l = page.locator(sel).first(); if (V.ua) await l.tap(); else await l.click(); await page.waitForTimeout(350); };
  const toView = async (v) => {
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
    await page.waitForTimeout(300);
    const seg = page.locator(tid(`tasks-view-${v}`)).first();
    if (await seg.count() && await seg.isVisible()) { await press(tid(`tasks-view-${v}`)); await page.waitForTimeout(300); }
  };
  const guarded = async (name, fn) => {
    try { await fn(); } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, step: name, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${kind}-${theme}-FAIL-${name.replace(/\s+/g, '-')}.png` }).catch(() => {});
    }
  };
  const resetFilters = async () => { if (await page.locator(tid('task-filter-clear')).count()) { await press(tid('task-filter-clear')); await page.waitForTimeout(250); } };
  // desktop board shows cards (req-card-*); the phone default list and desktop list show rows (req-row-*).
  const cardPrefix = () => (kind === 'desktop' ? 'req-card-' : 'req-row-');
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(fixture);
    await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
    await toView(kind === 'desktop' ? 'board' : 'list');
    await page.locator(tid(`${cardPrefix()}t1`)).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    const dates = await page.evaluate(() => window.__dueFixtureDates);
    await shot(kind === 'desktop' ? 'board' : 'list');

    await guarded('markers', async () => {
      const g = {};
      for (const id of ALL) g[id] = await geometry(page, id);
      const labels = Object.fromEntries(ALL.map(id => [id, g[id]?.dueLabel ?? '']));
      const ok = {};
      for (const [id, want] of Object.entries(EXPECT)) ok[`label_${id}`] = labels[id] === want;
      ok.doneNoOverdue = !!labels.t4 && !/逾期|到期/.test(labels.t4);
      ok.laterPlainDate = !!labels.t5 && !/逾期|到期/.test(labels.t5);
      ok.noDueNoMarker = !labels.t7;
      ok.overdueDanger = g.t3?.dueText?.color === g.t6?.dueText?.color && g.t3?.dueText?.color !== g.t1?.dueText?.color;
      ok.todayTomorrowWarning = g.t1?.dueText?.color === g.t2?.dueText?.color && g.t1?.dueText?.color !== g.t5?.dueText?.color;
      ok.tomorrowSubtler = g.t2?.due?.bg !== g.t1?.due?.bg;
      record(where, 'markers: text + colour', ok, { tz: V.tz, localToday: dates.today, utcToday: dates.utcToday, labels: JSON.stringify(labels), overdue: g.t3?.dueText?.color, today: g.t1?.dueText?.color, todayBg: g.t1?.due?.bg, tomorrowBg: g.t2?.due?.bg });
      for (const id of ['t1', 't2', 't3', 't6']) {
        const x = g[id];
        if (!x?.due || !x.prioText || !x.title) { record(where, `geometry ${id}`, { present: false }); continue; }
        const baseD = x.dueText.base - x.prioText.base;
        const gap = x.due.y - (x.title.y + x.title.h);
        measures.push({ where, card: id, label: x.dueLabel, titleBottom: r1(x.title.y + x.title.h), markerTop: r1(x.due.y), markerH: r1(x.due.h), markerBaseline: r1(x.dueText.base), prioBaseline: r1(x.prioText.base), dBaseline: r1(baseD), dCentre: r1(x.due.cy - x.prio.cy), gapBelowTitle: r1(gap) });
        record(where, `geometry ${id} (${x.dueLabel})`, {
          baselineWithPrio: Math.abs(baseD) <= 1,
          centreWithPrio: Math.abs(x.due.cy - x.prio.cy) <= 1,
          belowTitle: gap >= 0,
          insideCard: x.due.x >= x.card.x - 0.5 && x.due.x + x.due.w <= x.card.x + x.card.w + 0.5,
          textInsideChip: x.dueText.y >= x.due.y - 0.5 && x.dueText.y + x.dueText.h <= x.due.y + x.due.h + 0.5,
        }, { dBaseline: r1(baseD), gap: r1(gap) });
      }
    });

    await guarded('chip row', async () => {
      const chips = await chipRow(page);
      const present = chips.filter(c => c.b);
      const h0 = present[0]?.b.h ?? 0, c0 = present[0] ? present[0].b.y + present[0].b.h / 2 : 0;
      const sorted = [...present].sort((a, b) => a.b.x - b.b.x);
      const gaps = sorted.slice(1).map((c, i) => c.b.x - (sorted[i].b.x + sorted[i].b.w));
      for (const c of present) measures.push({ where, chip: c.id.replace(/^task-/, ''), x: r1(c.b.x), y: r1(c.b.y), w: r1(c.b.w), h: r1(c.b.h), centre: r1(c.b.y + c.b.h / 2) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // phone: the quick chips are the first thing in the filter row, so they stay on screen without scrolling.
      const quickOnScreen = chips.slice(0, 3).every(c => c.b && c.b.x >= 0 && c.b.x + c.b.w <= V.w + 0.5);
      record(where, 'chip row: 我负责/我参与/已逾期 + 负责人/优先级/项目/状态', {
        allPresent: present.length === chipIds.length,
        sameHeight: present.every(c => Math.abs(c.b.h - h0) <= 0.5),
        sameCentre: present.every(c => Math.abs(c.b.y + c.b.h / 2 - c0) <= 0.5),
        equalGaps: gaps.length > 0 && gaps.every(g => Math.abs(g - gaps[0]) <= 0.5),
        quickFirst: sorted.slice(0, 3).map(c => c.id).join() === 'task-quick-mine,task-quick-participating,task-quick-overdue',
        quickOnScreen,
        noPageOverflow: overflow <= 0,
      }, { gaps: gaps.map(r1).join('/'), h: r1(h0), overflow });
    });

    await guarded('filters', async () => {
      const prefix = cardPrefix();
      await press(tid('task-quick-overdue'));
      await page.waitForTimeout(400);
      const ov = await visibleIds(page, prefix);
      const sel = (await chipRow(page)).find(c => c.id === 'task-quick-overdue')?.sel;
      await shot('filter-overdue');
      await press(tid('task-quick-participating'));
      const ovPart = await visibleIds(page, prefix);
      await press(tid('task-quick-mine'));
      const ovMine = await visibleIds(page, prefix);
      const chips = await chipRow(page);
      const mineOn = chips.find(c => c.id === 'task-quick-mine')?.sel === 'true', partOn = chips.find(c => c.id === 'task-quick-participating')?.sel === 'true';
      await press(tid('task-quick-overdue'));
      const mine = await visibleIds(page, prefix);
      await shot('filter-mine');
      await resetFilters();
      const all = await visibleIds(page, prefix);
      record(where, 'quick filters narrow the board', {
        overdueOnly: ov.join() === 't3,t6',
        overdueSelected: sel === 'true',
        overduePlusParticipating: ovPart.join() === 't6',
        mineExcludesParticipating: mineOn && !partOn,
        overduePlusMineEmpty: ovMine.length === 0,
        mineOnly: mine.join() === 't1,t4,t5,t7',
        clearedAll: all.join() === ALL.join(),
      }, { overdue: ov.join(), ovPart: ovPart.join(), mine: mine.join(), all: all.join() });
    });

    if (kind === 'desktop') {
      await guarded('desktop list row', async () => {
        await toView('list');
        await page.locator(tid('req-row-t3')).first().waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
        await shot('list');
        for (const id of ['t1', 't2', 't3']) {
          const x = await page.evaluate((id) => {
            const row = document.querySelector(`[data-testid="req-row-${id}"]`);
            const title = document.querySelector(`[data-testid="task-title-${id}"]`);
            const due = row?.querySelector('[data-testid="task-due"]');
            if (!row || !title || !due) return null;
            const tt = [...title.querySelectorAll('*')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
            const dt = [...due.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).pop();
            const b = (e) => e.getBoundingClientRect();
            const rb = b(row), tb = b(tt), db = b(due);
            return { rowCy: rb.y + rb.height / 2, titleCy: tb.y + tb.height / 2, dueCy: db.y + db.height / 2, label: dt?.textContent, dueInRow: db.y >= rb.y - 0.5 && db.y + db.height <= rb.y + rb.height + 0.5 };
          }, id);
          if (!x) { record(where, `list row ${id}`, { present: false }); continue; }
          measures.push({ where: `${where}/list`, row: id, label: x.label, titleCentre: r1(x.titleCy), markerCentre: r1(x.dueCy), dCentre: r1(x.dueCy - x.titleCy) });
          record(where, `list row ${id} (${x.label})`, { label: x.label === EXPECT[id], centreWithTitle: Math.abs(x.dueCy - x.titleCy) <= 1, inRow: x.dueInRow }, { dCentre: r1(x.dueCy - x.titleCy) });
        }
      });
    }
    record(where, 'no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3).join(' | ') });
  } catch (e) {
    failures++;
    console.log(JSON.stringify({ where, error: String(e).split('\n')[0] }));
    if (OUT) await page.screenshot({ path: `${OUT}/${kind}-${theme}-FAIL.png` }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
web.close();

console.log('\n# measurements');
for (const m of measures) console.log(JSON.stringify(m));
console.log(`\n${rows.filter(r => r.ok).length}/${rows.length} checks ok, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
