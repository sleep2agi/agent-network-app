// 任务页「状态」筛选 chip(owner 09-29「筛选不能对那个状态进行筛选吗？」)。
// Isolated: read-only /api stub, placeholder data, no hub, no credentials. Reuses the test-phone-board bundle
// (RequirementBoard on react-native-web). See README.md.
//   BUNDLE=<phone-board.js> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-task-status-filter/drive.mjs
// Per viewport (390×844 Android touch, 1200×800 and 1440×900 mouse):
//   chip row : 状态 chip exists after 项目; same height and centre line as the other chips (±0.5px);
//              the gap before it equals the gap between 负责人 and 优先级 (±0.5px); prints a measurement table
//   list     : pick 进行中 → only 进行中 rows; chip label reads 进行中
//   board    : only the 进行中 column; 隐藏已完成 → 需求池 + 进行中, equal widths filling the board (desktop)
//              or two pager tabs (phone); 清除筛选 is one line and brings back three columns
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { paintedText } from '../test-layout-sweep/harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '/output'; mkdirSync(out, { recursive: true });
const bundle = process.env.BUNDLE || '/output/phone-board.js';
const base = { priority: 'normal', assignee: '', due: '', owner: { kind: 'user', id: 'u1' }, participants: [], checklist: [], parent_id: null, children: { total: 0, done: 0 } };
const rows = [
  { ...base, id: 'r1', name: '需求池里的第一张卡', column: 'pool', priority: 'high', project_id: 'p1' },
  { ...base, id: 'r2', name: '需求池里的第二张卡', column: 'pool' },
  { ...base, id: 'r3', name: '进行中的卡片', column: 'doing' },
  { ...base, id: 'r5', name: '进行中的第二张卡', column: 'doing', priority: 'high' },
  { ...base, id: 'r4', name: '已完成的卡片', column: 'done', priority: 'low' },
];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') { res.statusCode = 400; res.end(JSON.stringify({ error: 'fixture is read-only' })); return; }
    const body = path.endsWith('/projects') ? { projects: [{ id: 'p1', name: '示例项目', color: '#2563eb', sort: 0, archived: false }] }
      : path.endsWith('/people') ? { people: [{ kind: 'user', id: 'u1', name: 'tester', networkId: 'fixture-network' }] }
        : path === '/api/auth/me' ? { user: { id: 'u1' } }
          : { requirements: rows.map((r, i) => ({ ...r, createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString() })), capabilities: ['agent_owner', 'description', 'checklist'] };
    res.end(JSON.stringify(body)); return;
  }
  res.setHeader('Content-Type', path === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(path === '/app.js' ? readFileSync(bundle) : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{display:flex;height:100vh}</style><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const findExe = () => {
  const b = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${b}/${d}/chrome-linux64/chrome`, `${b}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: findExe() });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
let p = 0, t = 0;
const ck = (name, ok, detail) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); };
const box = async (page, id) => (await page.getByTestId(id).count()) ? page.getByTestId(id).boundingBox() : null;
const CHIPS = ['owner', 'priority', 'project', 'status'];
const table = [];

const VIEWPORTS = [
  { tag: '390x844', viewport: { width: 390, height: 844 }, phone: true },
  { tag: '1200x800', viewport: { width: 1200, height: 800 }, phone: false },
  { tag: '1440x900', viewport: { width: 1440, height: 900 }, phone: false },
];

try {
  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext(v.phone
      ? { viewport: v.viewport, userAgent: ANDROID_UA, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'zh-CN' }
      : { viewport: v.viewport, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', e => console.error('PAGE ERROR', e.message));
    const tap = (id) => v.phone ? page.getByTestId(id).tap() : page.getByTestId(id).click();
    await page.goto(url);
    await page.getByTestId('req-card-r1').waitFor();
    await page.waitForTimeout(300);

    // ── chip row geometry (phone: scroll the row so the new chip is on screen, as a user would)
    // no chip (main before this change) is a FAIL, not a crash: record it and move on to the next viewport
    if (!await page.getByTestId('task-filter-status').count()) { ck(`${v.tag}: 状态 chip exists`, false); await page.screenshot({ path: `${out}/${v.tag}-header.png` }); await ctx.close(); continue; }
    await page.getByTestId('task-filter-status').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const b = {};
    for (const c of CHIPS) b[c] = await box(page, `task-filter-${c}`);
    ck(`${v.tag}: all four chips present`, CHIPS.every(c => b[c]), b);
    if (CHIPS.every(c => b[c])) {
      const mid = c => b[c].y + b[c].height / 2;
      const gapOP = b.priority.x - (b.owner.x + b.owner.width);
      const gapPS = b.status.x - (b.project.x + b.project.width);
      ck(`${v.tag}: 状态 is right after 项目`, b.status.x > b.project.x);
      ck(`${v.tag}: same height as the other chips`, CHIPS.every(c => Math.abs(b[c].height - b.owner.height) <= 0.5));
      ck(`${v.tag}: same y / centre line`, CHIPS.every(c => Math.abs(b[c].y - b.owner.y) <= 0.5 && Math.abs(mid(c) - mid('owner')) <= 0.5));
      ck(`${v.tag}: gap 项目→状态 == gap 负责人→优先级`, Math.abs(gapPS - gapOP) <= 0.5, { gapOP, gapPS });
      for (const c of CHIPS) table.push({ viewport: v.tag, chip: c, x: +b[c].x.toFixed(1), y: +b[c].y.toFixed(1), w: +b[c].width.toFixed(1), h: +b[c].height.toFixed(1), gapBefore: c === 'priority' ? +gapOP.toFixed(1) : c === 'status' ? +gapPS.toFixed(1) : '' });
      if (!v.phone) {
        const vw = v.viewport.width;
        ck(`${v.tag}: status chip fully on screen without scrolling`, b.status.x + b.status.width <= vw);
      }
    }
    await page.screenshot({ path: `${out}/${v.tag}-header.png` });

    // ── menu
    await tap('task-filter-status');
    await page.getByTestId('task-filter-menu-status').waitFor();
    ck(`${v.tag}: menu has 需求池 / 进行中 / 完成 / 隐藏已完成`, (await Promise.all(['status-pool', 'status-doing', 'status-done', 'status-hide-done'].map(k => page.getByTestId(`task-filter-opt-${k}`).count()))).every(n => n === 1));
    await page.waitForTimeout(400); // Modal fades in
    await page.screenshot({ path: `${out}/${v.tag}-menu.png` });

    // ── pick 进行中 (multi-select menu stays open, same as 优先级) → board shows only that column
    await tap('task-filter-opt-status-doing');
    await page.waitForTimeout(200);
    await tap('task-filter-scrim');
    await page.waitForTimeout(300);
    // the label's own Text node, painted (a 0-wide label keeps its textContent, so innerText alone stays green)
    const label = await paintedText(page, '[data-testid="task-filter-status"] *', '进行中');
    ck(`${v.tag}: chip label reads 进行中`, (await page.getByTestId('task-filter-status').innerText()).includes('进行中') && !!label?.painted && label.w >= 8, { painted: label });
    ck(`${v.tag}: board has only the 进行中 column`, await page.getByTestId('req-col-doing').count() === 1 && await page.getByTestId('req-col-pool').count() === 0 && await page.getByTestId('req-col-done').count() === 0);
    if (v.phone) ck(`${v.tag}: pager has one tab`, await page.getByTestId('req-page-tab-doing').count() === 1 && await page.getByTestId('req-page-tab-pool').count() === 0);
    else {
      const board = await box(page, 'req-board'), col = await box(page, 'req-col-doing');
      ck(`${v.tag}: single column fills the board (minus 2×24 padding)`, Math.abs(col.width - (board.width - 48)) <= 1, { board: board.width, col: col.width });
    }
    await page.screenshot({ path: `${out}/${v.tag}-board-doing.png` });

    // ── list view: rows hidden
    await tap('tasks-view-list');
    await page.getByTestId('req-row-r3').waitFor();
    const shown = []; for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) if (await page.getByTestId(`req-row-${id}`).count()) shown.push(id);
    ck(`${v.tag}: list shows only 进行中 rows`, shown.join(',') === 'r3,r5', { shown });
    await page.screenshot({ path: `${out}/${v.tag}-list-doing.png` });
    await tap('tasks-view-board');
    await page.waitForTimeout(300);

    // ── 隐藏已完成 → two columns sharing the width
    await tap('task-filter-status');
    await page.getByTestId('task-filter-menu-status').waitFor();
    await tap('task-filter-opt-status-hide-done');
    await page.waitForTimeout(200);
    ck(`${v.tag}: 隐藏已完成 checked`, await page.getByTestId('task-filter-opt-status-hide-done').getAttribute('aria-checked') === 'true');
    await tap('task-filter-scrim');
    await page.waitForTimeout(300);
    ck(`${v.tag}: 完成 column hidden, 需求池 + 进行中 shown`, await page.getByTestId('req-col-done').count() === 0 && await page.getByTestId('req-col-pool').count() === 1 && await page.getByTestId('req-col-doing').count() === 1);
    if (!v.phone) {
      const board = await box(page, 'req-board'), a = await box(page, 'req-col-pool'), c = await box(page, 'req-col-doing');
      ck(`${v.tag}: two equal columns fill the board`, Math.abs(a.width - c.width) <= 1 && Math.abs(a.width + c.width + 16 - (board.width - 48)) <= 1.5, { board: board.width, a: a.width, c: c.width });
    } else {
      ck(`${v.tag}: pager has two tabs`, await page.getByTestId('req-page-tab-done').count() === 0 && await page.getByTestId('req-page-tab-pool').count() === 1 && await page.getByTestId('req-page-tab-doing').count() === 1);
      const col = await box(page, 'req-col-pool');
      ck(`${v.tag}: phone column still 390 − 2×16`, !!col && Math.abs(col.width - 358) <= 1, { col });
    }
    await page.screenshot({ path: `${out}/${v.tag}-board-hide-done.png` });

    // ── 清除筛选 → all three back. Its label sits on one line (main pinned the button to the 32px icon width:
    // `width: undefined` does not override a width in a style array, so 「清除筛选」 wrapped to a clipped column).
    await page.getByTestId('task-filter-clear').scrollIntoViewIfNeeded();
    const clearText = await page.getByTestId('task-filter-clear').getByText(/清除筛选/).boundingBox();
    ck(`${v.tag}: 清除筛选 label on one line`, !!clearText && clearText.height <= 24 && clearText.width >= 48, { clearText });
    await tap('task-filter-clear');
    await page.waitForTimeout(300);
    ck(`${v.tag}: 清除筛选 restores three columns`, (await Promise.all(['pool', 'doing', 'done'].map(c => page.getByTestId(`req-col-${c}`).count()))).every(n => n === 1));
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log('\n| viewport | chip | x | y | w | h | gap before |\n|---|---|---|---|---|---|---|');
for (const r of table) console.log(`| ${r.viewport} | ${r.chip} | ${r.x} | ${r.y} | ${r.w} | ${r.h} | ${r.gapBefore} |`);
console.log(`\n${p}/${t} passed`);
process.exit(p === t && t > 0 ? 0 : 1);
