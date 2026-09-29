// Phone 看板 column width (owner 2026-09-29, Android 0.2.143: columns collapsed to ~10px slivers).
// Isolated: read-only /api stub, placeholder data, no hub, no credentials. See README.md.
//   BUNDLE=<phone-board.js> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-phone-board/drive.mjs
// 🔴 Web cannot reproduce the native bug itself (react-native-web expands `flex` into CSS longhands; native Yoga
// resolves flex:1 + flexBasis:'auto' to a 0 basis). This checks the layout contract on web, including a pass where
// onLayout never reports a width (?zeroLayout=1). The native collapse is guarded by src/task-board-layout.test.ts;
// the fix still needs a check on a real Android phone.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '/output'; mkdirSync(out, { recursive: true });
const bundle = process.env.BUNDLE || '/output/phone-board.js';
const base = { priority: 'normal', assignee: '', due: '', owner: { kind: 'user', id: 'u1' }, participants: [], checklist: [], parent_id: null, children: { total: 0, done: 0 } };
const rows = [
  { ...base, id: 'r1', name: '需求池里的第一张卡', column: 'pool', priority: 'high' },
  { ...base, id: 'r2', name: '需求池里的第二张卡', column: 'pool' },
  { ...base, id: 'r3', name: '进行中的卡片', column: 'doing' },
  { ...base, id: 'r4', name: '已完成的卡片', column: 'done', priority: 'low' },
];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') { res.statusCode = 400; res.end(JSON.stringify({ error: 'fixture is read-only' })); return; }
    const body = path.endsWith('/projects') ? { projects: [] }
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
const COLS = ['pool', 'doing', 'done'];
const CARD = { pool: 'r1', doing: 'r3', done: 'r4' };
const box = (page, id) => page.getByTestId(id).boundingBox();
const inView = (b, vw, vh) => !!b && b.width > 0 && b.height > 0 && b.x >= -0.5 && b.x + b.width <= vw + 0.5 && b.y < vh;

try {
  for (const zero of [false, true]) {
    const tag = zero ? 'zeroLayout' : 'normal';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', e => console.error('PAGE ERROR', e.message));
    await page.goto(url + (zero ? '?zeroLayout=1' : ''));
    await page.getByTestId('req-card-r1').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/phone-board-${tag}.png` });
    ck(`${tag}: page indicator with three tabs`, await page.getByTestId('req-pager').count() === 1 && (await Promise.all(COLS.map(c => page.getByTestId(`req-page-tab-${c}`).count()))).every(n => n === 1));
    const widths = [];
    for (const c of COLS) widths.push(Math.round((await box(page, `req-col-${c}`))?.width ?? 0));
    ck(`${tag}: every column ≥ 300 wide`, widths.every(w => w >= 300), { widths });
    ck(`${tag}: column = 390 − 2×16`, widths.every(w => Math.abs(w - 358) <= 1), { widths });
    for (const [i, c] of COLS.entries()) {
      // a missing pager is already a FAIL above; keep measuring the rest instead of aborting the run
      if (!await page.getByTestId(`req-page-tab-${c}`).count()) { ck(`${tag}: tab ${c} exists`, false); continue; }
      await page.getByTestId(`req-page-tab-${c}`).tap();
      await page.waitForTimeout(600);
      const col = await box(page, `req-col-${c}`), card = await box(page, `req-card-${CARD[c]}`);
      ck(`${tag}: tab ${c} → its column fills the screen and its card is visible`, inView(col, 390, 844) && Math.abs(col.x - 16) <= 1 && inView(card, 390, 844) && card.height > 30, { col, card });
      ck(`${tag}: tab ${c} is selected`, await page.getByTestId(`req-page-tab-${c}`).getAttribute('aria-selected') === 'true');
      if (i === 1) await page.screenshot({ path: `${out}/phone-board-${tag}-doing.png` });
    }
    // swipe (scroll) back to the first page → indicator follows
    await page.getByTestId('req-board').evaluate(el => { el.scrollTo({ left: 0 }); });
    await page.waitForTimeout(400);
    ck(`${tag}: scrolling back selects 需求池`, await page.getByTestId('req-page-tab-pool').count() === 1 && await page.getByTestId('req-page-tab-pool').getAttribute('aria-selected') === 'true');
    // 列表 (grouped list) — same class of bug
    await page.getByTestId('tasks-view-list').tap();
    await page.getByTestId('req-row-r1').waitFor();
    const rowW = [];
    for (const id of ['r1', 'r3', 'r4']) rowW.push(Math.round((await box(page, `req-row-${id}`))?.width ?? 0));
    ck(`${tag}: list rows ≥ 300 wide`, rowW.every(w => w >= 300), { rowW });
    await page.screenshot({ path: `${out}/phone-list-${tag}.png` });
    await page.getByTestId('tasks-view-board').tap();
    // rotation: landscape 844×390 → equal columns filling the width
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);
    const land = [];
    for (const c of COLS) land.push(Math.round((await box(page, `req-col-${c}`))?.width ?? 0));
    ck(`${tag}: rotate to 844 → three equal columns, no pager`, await page.getByTestId('req-pager').count() === 0 && land.every(w => w > 200 && Math.abs(w - land[0]) <= 1), { land });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const back = [];
    for (const c of COLS) back.push(Math.round((await box(page, `req-col-${c}`))?.width ?? 0));
    ck(`${tag}: rotate back to 390 → paged again`, await page.getByTestId('req-pager').count() === 1 && back.every(w => Math.abs(w - 358) <= 1), { back });
    await ctx.close();
  }
  // foldable unfolded 884×1000, Android UA: equal columns filling the width
  const ctx = await browser.newContext({ viewport: { width: 884, height: 1000 }, userAgent: ANDROID_UA, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  await page.goto(url); await page.getByTestId('req-card-r1').waitFor(); await page.waitForTimeout(300);
  const fw = []; for (const c of COLS) fw.push(Math.round((await box(page, `req-col-${c}`))?.width ?? 0));
  ck('foldable 884: three equal columns ≥ 240', fw.every(w => w >= 240 && Math.abs(w - fw[0]) <= 1) && await page.getByTestId('req-pager').count() === 0, { fw });
  await page.screenshot({ path: `${out}/foldable-board.png` });
  await ctx.close();
} finally {
  await browser.close(); server.close();
}
console.log(`\n${p}/${t} passed`);
process.exit(p === t && t > 0 ? 0 : 1);
