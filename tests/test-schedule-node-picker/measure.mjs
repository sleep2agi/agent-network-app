// 定时任务「执行节点」选择器 + 表单安全区 —— 量出来,不靠眼睛(owner 2026-09-26,展开的折叠屏)。
// Not in CI: needs Playwright + Chromium and a web export. No hub at all: the hub API is answered by
// page.route() from placeholder data (60 agents in 4 groups, no real aliases), so nothing touches
// 127.0.0.1:9200 or ~/.anet.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-schedule-node-picker/measure.mjs
//
// For 390×844 (phone ⇒ bottom sheet) and 1200×850 (Android UA ⇒ two-pane ⇒ dialog) × light/dark it
// screenshots: form row empty / selected, picker open, search 'tm', a pinyin search, a folded group;
// and asserts with boundingBox:
//   header   : |cy(取消) − cy(title)| ≤ 1, |cy(保存) − cy(title)| ≤ 1
//   field    : avatar / name / dot / chevron centres within 1px of each other
//   picker row: avatar / name / dot / ✓ centres within 1px (the selected row)
//   picker   : left inset == right inset (search box inside the panel) ±1; row padding equal ±1
//   sheet    : phone height ≈ 85% of the window; dialog 520×640 centred
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const HUB = 'http://hub.placeholder.invalid';

// ── placeholder fleet: 4 groups × 15 ─────────────────────────────────────────
const SUFFIX = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '一', '二', '三', '四', '五'];
const RUNTIMES = ['claude-code', 'codex', 'grok-build-cli', 'opencode'];
const STATUSES = ['idle', 'working', 'idle', 'offline', 'error', 'idle', 'offline', 'idle', 'working', 'offline', 'idle', 'offline', 'idle', 'offline', 'offline'];
const groups = [
  i => `测试${SUFFIX[i]}`,
  i => `演示${SUFFIX[i]}`,
  i => `tm-node-${String(i + 1).padStart(2, '0')}`,
  i => `demo-${String(i + 1).padStart(2, '0')}`,
];
const nodes = [], sessions = [];
groups.forEach((name, g) => {
  for (let i = 0; i < 15; i++) {
    const alias = name(i), node_id = `node-${g}-${i}`;
    nodes.push({ node_id, alias, runtime: RUNTIMES[(g + i) % 4] });
    const status = STATUSES[(i + g) % 15];
    sessions.push({ alias, node_id, status, runtime: RUNTIMES[(g + i) % 4], updated_at: new Date().toISOString() });
  }
});
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const answer = (url) => {
  const p = new URL(url).pathname;
  if (p === '/api/status') return json({ sessions });
  if (p === '/api/nodes') return json({ ok: true, nodes, count: nodes.length });
  if (p === '/api/scheduled-tasks') return json({ ok: true, schedules: [] });
  if (p === '/health' || p === '/api/health') return json({ ok: true });
  return json({ ok: true, messages: [], tasks: [], nodes: [], sessions: [], schedules: [] });
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub for login (the plain web branch hits SecureStore); plugin:http goes to page fetch,
// which page.route() answers. An Android UA still picks the phone / two-pane layout (wide-layout.ts).
const initScript = ({ hubUrl, theme }) => {
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-picker', displayName: 'tester', networkId: 'net-placeholder' };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url, headers: Array.from(r.headers.entries()), rid: id };
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
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const r1 = (n) => Math.round(n * 10) / 10;

const rows = [];
let failures = 0;
const box = async (page, sel) => {
  const el = page.locator(sel).first();
  if (!(await el.count())) return null;
  const b = await el.boundingBox();
  return b ? { ...b, cy: b.y + b.height / 2, r: b.x + b.width, b: b.y + b.height } : null;
};
function record(vp, scheme, what, checks, detail) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, scheme, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const spread = (bs) => r1(Math.max(...bs.map(b => b.cy)) - Math.min(...bs.map(b => b.cy)));

for (const [w, h] of [[390, 844], [1200, 850]]) {
  for (const scheme of ['light', 'dark']) {
    const vp = `${w}x${h}`;
    const tag = `${w}-${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, userAgent: ANDROID_UA, deviceScaleFactor: 2, hasTouch: w < 700, isMobile: false });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.route(`${HUB}/**`, route => route.fulfill(answer(route.request().url())));
    await page.addInitScript(initScript, { hubUrl: HUB, theme: scheme });
    await page.goto(WEB_URL);
    // bottom tab (phone) / rail (two-pane): 「定时任务」
    const nav = page.getByText('定时任务', { exact: true }).first();
    await nav.click({ timeout: 25000 });
    await page.getByText('新建', { exact: true }).first().click({ timeout: 15000 });
    await page.locator('[data-testid="schedule-form"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);

    // header centre line
    const [cancel, title, save] = [await box(page, '[data-testid="schedule-form-cancel"]'), await box(page, '[data-testid="schedule-form-title"]'), await box(page, '[data-testid="schedule-form-save"]')];
    record(vp, scheme, 'form header 取消/title/保存', { centre: Math.abs(cancel.cy - title.cy) <= 1 && Math.abs(save.cy - title.cy) <= 1 },
      { cyA: r1(cancel.cy), cyB: r1(title.cy), cyC: r1(save.cy), spread: spread([cancel, title, save]) });
    const field0 = await box(page, '[data-testid="schedule-target-field"]');
    const ph = await box(page, '[data-testid="schedule-target-placeholder"]');
    const chev0 = await box(page, '[data-testid="schedule-target-field"] >> [data-testid="schedule-target-chevron"]').catch(() => null);
    record(vp, scheme, 'field empty: placeholder/chevron', { centre: !!ph && Math.abs(ph.cy - field0.cy) <= 1 }, { cyA: r1(ph?.cy ?? -1), cyB: r1(field0.cy), spread: ph ? r1(Math.abs(ph.cy - field0.cy)) : -1 });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-form-empty.png` });

    // open picker
    await page.locator('[data-testid="schedule-target-field"]').click();
    await page.locator('[data-testid="node-picker"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(700);
    const panel = await box(page, '[data-testid="node-picker"]');
    const search = await box(page, '[data-testid="node-picker-search"]');
    const head = await box(page, '[data-testid="node-picker-title"]');
    const closeB = await box(page, '[data-testid="node-picker-close"]');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute?.('data-testid'));
    // inside the panel's border (the dialog has a hairline border; the sheet none)
    const border = await page.locator('[data-testid="node-picker"]').first().evaluate(el => { const c = getComputedStyle(el); return [parseFloat(c.borderLeftWidth) || 0, parseFloat(c.borderRightWidth) || 0]; });
    const padL = search.x - panel.x - border[0], padR = panel.r - border[1] - search.r;
    const shape = w < 700
      ? { sheet85: Math.abs(panel.height - Math.round(h * 0.85)) <= 1 && Math.abs(panel.b - h) <= 1, noAutoFocus: focused !== 'node-picker-input' }
      : { dialog: Math.abs(panel.width - 520) <= 1 && Math.abs(panel.height - 640) <= 1 && Math.abs((panel.x + panel.width / 2) - w / 2) <= 1, autoFocus: focused === 'node-picker-input' };
    record(vp, scheme, 'picker panel', { pads: Math.abs(padL - padR) <= 1, ...shape },
      { padL: r1(padL), padR: r1(padR), panelW: r1(panel.width), panelH: r1(panel.height), focused: focused || '-' });
    record(vp, scheme, 'picker title/close', { centre: Math.abs(head.cy - closeB.cy) <= 1 }, { cyA: r1(head.cy), cyB: r1(closeB.cy), spread: r1(Math.abs(head.cy - closeB.cy)) });
    // a row's inner padding: avatar left inset vs ✓ slot right inset
    const firstRow = page.locator('[data-testid^="picker-row-"]').first();
    const rid = await firstRow.getAttribute('data-testid');
    const rb = await box(page, `[data-testid="${rid}"]`);
    const ra = await box(page, `[data-testid="${rid}-avatar"]`);
    const slotR = await page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); const last = el.lastElementChild.getBoundingClientRect(); return last.right; }, rid);
    record(vp, scheme, 'picker row padding', { pads: Math.abs((ra.x - rb.x) - (rb.r - slotR)) <= 1 && Math.abs((ra.x - rb.x) - padL) <= 1 },
      { padL: r1(ra.x - rb.x), padR: r1(rb.r - slotR), searchPad: r1(padL) });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-picker-open.png` });

    // search 'tm'
    await page.locator('[data-testid="node-picker-input"]').fill('tm');
    await page.waitForTimeout(500);
    const tmRows = await page.locator('[data-testid^="picker-row-"][data-testid$="-name"]').allTextContents();
    record(vp, scheme, "search 'tm'", { onlyTm: tmRows.length > 0 && tmRows.every(t => /tm/i.test(t)) }, { rows: tmRows.length });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-search-tm.png` });
    // pinyin: 'ysj' → 演示甲 / 演示己
    await page.locator('[data-testid="node-picker-input"]').fill('ysj');
    await page.waitForTimeout(500);
    const pyRows = await page.locator('[data-testid^="picker-row-"][data-testid$="-name"]').allTextContents();
    record(vp, scheme, "pinyin 'ysj'", { hits: pyRows.includes('演示甲') && pyRows.every(t => t.startsWith('演示')) }, { rows: pyRows.length, names: pyRows.join('/') });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-search-pinyin.png` });
    // empty search
    await page.locator('[data-testid="node-picker-input"]').fill('zzzq');
    await page.waitForTimeout(400);
    const empty = await page.locator('[data-testid="node-picker-empty"]').textContent().catch(() => '');
    record(vp, scheme, 'empty search text', { text: empty === '没有找到 “zzzq”' }, { text: empty });
    await page.locator('[data-testid="node-picker-input"]').fill('');
    await page.waitForTimeout(400);

    // fold the first group
    const grp = page.locator('[data-testid^="picker-group-"]').first();
    const gTitle = (await grp.getAttribute('data-testid')).replace('picker-group-', '');
    const namesIn = async () => (await page.locator('[data-testid^="picker-row-"][data-testid$="-name"]').allTextContents()).filter(n => n.startsWith(gTitle)).length;
    const before = await namesIn();
    await grp.click();
    await page.waitForTimeout(400);
    // folded ⇒ none of the group's rows are rendered, but its header (with online/total) stays
    const headerText = await grp.textContent();
    const after = await namesIn();
    record(vp, scheme, `fold group ${gTitle}`, { folded: before > 0 && after === 0, header: /\d+\/15$/.test(headerText) }, { rowsBefore: before, rowsAfter: after, header: headerText });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-group-collapsed.png` });
    await grp.click();
    await page.waitForTimeout(300);

    // select 演示乙 (working) via search, sheet closes, recents + ✓ on reopen
    await page.locator('[data-testid="node-picker-input"]').fill('演示乙');
    await page.waitForTimeout(400);
    await page.locator('[data-testid^="picker-row-"][data-testid$="-name"]', { hasText: '演示乙' }).first().click();
    await page.locator('[data-testid="node-picker"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    const closed = (await page.locator('[data-testid="node-picker"]').count()) === 0;
    const f = await box(page, '[data-testid="schedule-target-field"]');
    const fa = await box(page, '[data-testid="schedule-target-avatar"]');
    const fn = await box(page, '[data-testid="schedule-target-name"]');
    const fd = await box(page, '[data-testid="schedule-target-dot"]');
    const fc = await box(page, '[data-testid="schedule-target-chevron"]');
    const fh = await box(page, '[data-testid="schedule-target-hint"]');
    const fieldBoxes = [fa, fn, fd, fc, fh].filter(Boolean);
    record(vp, scheme, 'field selected: avatar/name/dot/hint/›', { closed, centre: fieldBoxes.length === 5 && spread(fieldBoxes) <= 1 },
      { cyAvatar: r1(fa?.cy ?? -1), cyName: r1(fn?.cy ?? -1), cyDot: r1(fd?.cy ?? -1), cyHint: r1(fh?.cy ?? -1), cyChevron: r1(fc?.cy ?? -1), spread: fieldBoxes.length ? spread(fieldBoxes) : -1 });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-form-selected.png` });

    // reopen: 最近使用 has it at the top, with ✓; measure the selected row's centre line
    await page.locator('[data-testid="schedule-target-field"]').click();
    await page.locator('[data-testid="node-picker"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(700);
    const recentFirst = page.locator('[data-testid^="picker-recent-"][data-testid$="-name"]').first();
    const recentName = await recentFirst.textContent().catch(() => '');
    const sel = await page.evaluate(() => [...document.querySelectorAll('[data-testid$="-check"]')].map(e => e.getAttribute('data-testid'))[0]);
    const base = sel?.replace(/-check$/, '');
    const [sa, sn, sd, sc] = base ? [await box(page, `[data-testid="${base}-avatar"]`), await box(page, `[data-testid="${base}-name"]`), await box(page, `[data-testid="${base}-dot"]`), await box(page, `[data-testid="${base}-check"]`)] : [];
    const sb = [sa, sn, sd, sc].filter(Boolean);
    record(vp, scheme, 'selected row avatar/name/dot/✓', { recentTop: recentName === '演示乙', centre: sb.length === 4 && spread(sb) <= 1 },
      { recent: recentName, cyAvatar: r1(sa?.cy ?? -1), cyName: r1(sn?.cy ?? -1), cyDot: r1(sd?.cy ?? -1), cyCheck: r1(sc?.cy ?? -1), spread: sb.length ? spread(sb) : -1 });
    await page.screenshot({ path: `${OUT}/nodepicker-${tag}-picker-selected.png` });
    // Esc closes (RNW routes it to onRequestClose)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    record(vp, scheme, 'Esc closes picker', { closed: (await page.locator('[data-testid="node-picker"]').count()) === 0 }, {});
    await ctx.close();
  }
}
await browser.close(); web.close();

const cols = ['vp', 'scheme', 'what', 'cyA', 'cyB', 'cyC', 'cyAvatar', 'cyName', 'cyDot', 'cyHint', 'cyCheck', 'cyChevron', 'spread', 'padL', 'padR', 'panelW', 'panelH', 'ok', 'failed'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c] ?? '').join(' | ')} |`);
console.log(`\n${rows.length} measurements, ${failures} failing`);
process.exit(failures ? 1 : 0);
