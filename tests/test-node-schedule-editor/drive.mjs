// 节点页「定时任务」就地编辑(owner 2026-10-07:点一行跳去定时任务页太绕,要在原地打开编辑器)—— 端到端。
// Not in CI (same as test-schedule-edit-conflict): needs Playwright + Chromium and a web export. No hub at all:
// a stateful mock answers the Hub API through page.route(). Nothing touches 127.0.0.1:9200 or ~/.anet.
// Placeholder node only (demo-node-a / node_demo_a).
//
//   WEB_DIR=<expo export dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [OUT=<png dir>] \
//   node tests/test-node-schedule-editor/drive.mjs
//
// Per viewport (1200×800 desktop shell; 390×844 Android phone), light and dark:
//   row     : clicking a Hub-plan row opens the editor (schedule-form) and the node page stays mounted underneath
//             (node-section-nav still there) — no jump to the 定时任务 page
//   manage  : 立即执行 / 暂停 / 复制 / 取消计划 + 最近执行 rows are in the editor
//   sheet   : phone — the editor is a bottom sheet: panel bottom = window bottom, top just under the top edge, rounded top
//   guard   : edit the name, then Esc (desktop) / 取消 (phone) ⇒ 「放弃未保存的修改？」; 继续编辑 keeps the form + draft
//   save    : 保存 ⇒ one PATCH with the opened revision and the typed name; editor closes; the list re-reads and shows it
//   新建     : ＋ 新建 ⇒ 新建定时任务 with 执行节点 = demo-node-a
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB) throw new Error('need WEB_DIR');
if (OUT) mkdirSync(OUT, { recursive: true });
const HUB = 'http://hub.placeholder.invalid';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// ── stateful mock hub ────────────────────────────────────────────────────────
let row, patches, listReads;
const reset = () => {
  patches = []; listReads = 0;
  row = {
    schedule_id: 'sched_1', network_id: 'net-placeholder', name: '团队整体工作调度', target_node_id: 'node_demo_a', target_alias: 'demo-node-a',
    task_content: '看一眼团队进度', priority: 'normal', schedule: { type: 'interval', every_seconds: 120 }, timezone: 'Asia/Shanghai',
    misfire_policy: 'catch_up_once', status: 'active', next_run_at: new Date(Date.now() + 90_000).toISOString(),
    last_run_at: new Date(Date.now() - 30_000).toISOString(), revision: 7,
  };
};
const runs = () => [0, 1, 2].map(i => ({
  run_id: `srun_${i}`, schedule_id: 'sched_1', scheduled_for: new Date(Date.now() - (i + 1) * 120_000).toISOString(), task_id: i === 1 ? null : `task_${i}`,
  status: i === 1 ? 'skipped' : 'replied', error_code: i === 1 ? 'previous_run_open' : null, error_message: null,
  created_at: new Date(Date.now() - (i + 1) * 120_000).toISOString(), completed_at: i === 1 ? null : new Date(Date.now() - (i + 1) * 120_000 + 40_000).toISOString(),
}));
const session = { alias: 'demo-node-a', node_id: 'node_demo_a', status: 'idle', runtime: 'claude-code', agent: 'claude-code', updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() };
const answer = (req) => {
  const u = new URL(req.url()), p = u.pathname, method = req.method();
  if (p === '/api/status') return json({ sessions: [session] });
  if (p === '/api/nodes') return json({ ok: true, nodes: [{ node_id: 'node_demo_a', alias: 'demo-node-a', runtime: 'claude-code', lifecycle_state: 'active' }], count: 1 });
  if (p === '/api/scheduled-tasks' && method === 'GET') { listReads++; return json({ ok: true, schedules: [row] }); }
  if (p === '/api/scheduled-tasks/sched_1/runs') return json({ ok: true, runs: runs().slice(0, Number(u.searchParams.get('limit') || 50)) });
  if (p === '/api/scheduled-tasks/sched_1' && method === 'PATCH') {
    const body = JSON.parse(req.postData() || '{}');
    patches.push(body);
    if (body.revision !== row.revision) return json({ ok: false, error: 'revision_conflict' }, 409);
    row = { ...row, ...(body.name ? { name: body.name, task_content: body.task, schedule: body.schedule } : {}), ...(body.status ? { status: body.status } : {}), revision: row.revision + 1 };
    return json({ ok: true, schedule: row });
  }
  return json({ ok: true, messages: [], tasks: [], nodes: [], sessions: [], schedules: [], edits: [] });
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

// Desktop-shell stub (same as test-schedule-edit-conflict): plugin:http goes to page fetch, which page.route() answers.
const initScript = ({ hubUrl, theme }) => {
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-node-editor', displayName: 'tester', networkId: 'net-placeholder' };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  // unlisten() in @tauri-apps/api/event goes through this; without it every page logs a stub-only TypeError.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
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
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
let failures = 0;
const ck = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };
const tid = (id) => `[data-testid="${id}"]`;
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, radius: cs.borderTopLeftRadius };
}, sel);
const formOpen = (page) => page.locator(tid('schedule-form')).count().then(n => n > 0);

for (const { w, h, phone } of [{ w: 1200, h: 800, phone: false }, { w: 390, h: 844, phone: true }]) {
  for (const theme of ['light', 'dark']) {
    reset();
    const tag = `${w}x${h}-${theme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, locale: 'zh-CN', deviceScaleFactor: 2, ...(phone ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => { failures++; console.log('PAGEERROR', e.message.split('\n')[0]); });
    await page.route(`${HUB}/**`, route => route.fulfill(answer(route.request())));
    await page.addInitScript(initScript, { hubUrl: HUB, theme });
    await page.goto(WEB_URL);
    await page.getByText('demo-node-a', { exact: true }).first().click({ timeout: 30000 });
    // 手机 / 安卓双栏:聊天页顶上直接有「查看节点信息」;桌面壳先开 ⋯(聊天信息)再进节点信息。
    await page.locator('[aria-label^="查看节点信息"], [aria-label="聊天信息"]').first().waitFor({ timeout: 15000 });
    if (!(await page.locator('[aria-label^="查看节点信息"]').count())) await page.locator('[aria-label="聊天信息"]').first().click();
    await page.locator('[aria-label^="查看节点信息"]').first().click({ timeout: 15000 });
    await page.locator(tid('node-section-nav')).waitFor({ timeout: 15000 });
    await page.locator(`${tid('node-section-nav')} [aria-label="定时任务"]`).first().click();
    await page.locator(tid('node-schedules-list')).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);

    // row ⇒ editor in place
    await page.locator(tid('node-schedule-open-hub_sched_1')).click();
    await page.locator(tid('schedule-form')).waitFor({ timeout: 10000 }).catch(() => {});
    ck(`${tag} row: editor opened`, await formOpen(page));
    ck(`${tag} row: node page still mounted under it (no jump to 定时任务 page)`, (await page.locator(tid('node-section-nav')).count()) > 0 && (await page.locator(tid('node-schedules-list')).count()) > 0);
    ck(`${tag} row: title 编辑定时任务`, (await page.locator(tid('schedule-form-title')).innerText()) === '编辑定时任务');
    await page.locator(tid('schedule-editor-runs')).getByText('已完成').first().waitFor({ timeout: 10000 }).catch(() => {});
    for (const id of ['schedule-editor-run', 'schedule-editor-toggle', 'schedule-editor-copy', 'schedule-editor-cancel-plan']) ck(`${tag} manage: ${id}`, (await page.locator(tid(id)).count()) === 1);
    ck(`${tag} manage: recent runs listed (3)`, (await page.locator(`${tid('schedule-editor-runs')} [data-testid^="schedule-editor-run-srun_"]`).count()) === 3);
    await page.waitForTimeout(700); // let the slide / fade-in finish before measuring
    const panel = await box(page, tid('schedule-form'));
    if (phone) ck(`${tag} sheet: full-height bottom sheet (bottom = window, top near the top, rounded)`, !!panel && Math.abs(panel.bottom - h) <= 1 && panel.y > 0 && panel.y < 48 && panel.radius !== '0px', JSON.stringify(panel));
    else ck(`${tag} dialog: centred dialog`, !!panel && Math.abs(panel.x + panel.w / 2 - w / 2) <= 1, JSON.stringify(panel));
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-editor.png` });

    // unsaved-changes guard
    const nameBox = page.locator(tid('schedule-form')).getByPlaceholder('每日巡检');
    await nameBox.fill('团队整体工作调度 v2');
    if (phone) await page.locator(tid('schedule-form-cancel')).click();
    else { await nameBox.press('Escape'); }
    await page.locator(tid('schedule-discard-confirm')).waitFor({ timeout: 5000 }).catch(() => {});
    ck(`${tag} guard: 放弃未保存的修改？ asked`, (await page.locator(tid('schedule-discard-confirm')).count()) === 1);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-discard-confirm.png` });
    await page.locator(tid('schedule-discard-confirm-back')).click();
    await page.waitForTimeout(400);
    ck(`${tag} guard: 继续编辑 keeps the form and the draft`, (await formOpen(page)) && (await nameBox.inputValue()) === '团队整体工作调度 v2');

    // save ⇒ PATCH + list refresh in place
    const readsBefore = listReads;
    await page.locator(tid('schedule-form-save')).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="schedule-form"]'), null, { timeout: 10000 }).catch(() => {});
    ck(`${tag} save: one PATCH at the opened revision with the typed name`, patches.length === 1 && patches[0].revision === 7 && patches[0].name === '团队整体工作调度 v2', JSON.stringify(patches));
    ck(`${tag} save: editor closed`, !(await formOpen(page)));
    await page.locator(tid('node-schedule-name-hub_sched_1')).getByText('团队整体工作调度 v2').waitFor({ timeout: 5000 }).catch(() => {});
    ck(`${tag} save: list re-read and shows the new name in place`, listReads > readsBefore && (await page.locator(tid('node-schedule-name-hub_sched_1')).innerText()) === '团队整体工作调度 v2');
    ck(`${tag} save: still on the node page`, (await page.locator(tid('node-section-nav')).count()) > 0);

    // 新建 ⇒ executor prefilled
    await page.locator(tid('node-schedules-create')).click();
    await page.locator(tid('schedule-form')).waitFor({ timeout: 10000 }).catch(() => {});
    ck(`${tag} 新建: create editor`, (await formOpen(page)) && (await page.locator(tid('schedule-form-title')).innerText()) === '新建定时任务');
    ck(`${tag} 新建: 执行节点 = demo-node-a`, (await page.locator(tid('schedule-form')).getByText('demo-node-a').count()) > 0);
    if (OUT) await page.screenshot({ path: `${OUT}/${tag}-create.png` });
    // untouched ⇒ closes without asking
    await page.locator(tid('schedule-form-cancel')).click();
    await page.waitForTimeout(400);
    ck(`${tag} 新建: untouched form closes without the confirm`, !(await formOpen(page)) && (await page.locator(tid('schedule-discard-confirm')).count()) === 0);
    await ctx.close();
  }
}

await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
