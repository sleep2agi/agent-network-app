// 定时任务编辑遇 409 不丢草稿 —— 端到端(owner 2026-09-29:每 2 分钟一次的计划,编辑中途跑了一次,保存 409,草稿没了)。
// Not in CI (same as test-schedule-node-picker): needs Playwright + Chromium and a web export. No hub at all:
// a stateful mock answers /api/scheduled-tasks through page.route(), with the pre-fix Hub rule
// (PATCH with a stale revision ⇒ 409 revision_conflict). Nothing touches 127.0.0.1:9200 or ~/.anet.
//
//   WEB_DIR=<expo export dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [OUT=<png dir>] \
//   node tests/test-schedule-edit-conflict/drive.mjs
//
// A  run-only 409: open 编辑, type new 任务内容, the schedule "runs" (revision 4→5, last_run_at moves) and the list
//    polls (≥10 s) — the draft must survive the poll; 保存 ⇒ PATCH rev 4 → 409 once ⇒ refetch ⇒ automatic PATCH rev 5
//    with the typed text ⇒ 200, form closes, no conflict view.
// B  real conflict: another device changed 任务内容 too ⇒ conflict view 「你的修改 / 最新版本」 with both values, the
//    draft still in the textarea; 「用我的覆盖」 ⇒ PATCH at the latest revision with my text ⇒ 200.
// C  「用最新的」 ⇒ no PATCH, form now shows their text and stays open.
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
let row, patches;
const reset = () => {
  patches = [];
  row = {
    schedule_id: 'sched_1', network_id: 'net-placeholder', name: '巡检', target_node_id: 'node-a', target_alias: '测试甲',
    task_content: '原来的内容', priority: 'normal', schedule: { type: 'interval', every_seconds: 120 }, timezone: 'Asia/Shanghai',
    misfire_policy: 'catch_up_once', status: 'active', next_run_at: new Date(Date.now() + 120_000).toISOString(), last_run_at: null, revision: 4,
  };
};
const runOnce = () => { row = { ...row, revision: row.revision + 1, last_run_at: new Date().toISOString(), next_run_at: new Date(Date.now() + 120_000).toISOString() }; };
const answer = (req) => {
  const u = new URL(req.url()), p = u.pathname, method = req.method();
  if (p === '/api/status') return json({ sessions: [{ alias: '测试甲', node_id: 'node-a', status: 'idle', runtime: 'codex', updated_at: new Date().toISOString() }] });
  if (p === '/api/nodes') return json({ ok: true, nodes: [{ node_id: 'node-a', alias: '测试甲', runtime: 'codex' }], count: 1 });
  if (p === '/api/scheduled-tasks') return json({ ok: true, schedules: [row] });
  if (p.endsWith('/runs')) return json({ ok: true, runs: [] });
  if (p === '/api/scheduled-tasks/sched_1' && method === 'PATCH') {
    const body = JSON.parse(req.postData() || '{}');
    patches.push(body);
    if (body.revision !== row.revision) return json({ ok: false, error: 'revision_conflict', current_revision: row.revision }, 409);
    row = { ...row, name: body.name, task_content: body.task, priority: body.priority, timezone: body.timezone, schedule: body.schedule, misfire_policy: body.misfire_policy, revision: row.revision + 1 };
    return json({ ok: true, schedule: row });
  }
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
let failures = 0;
const ck = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };

const openEditor = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, userAgent: ANDROID_UA, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.route(`${HUB}/**`, route => route.fulfill(answer(route.request())));
  await page.addInitScript(initScript, { hubUrl: HUB, theme: 'light' });
  await page.goto(WEB_URL);
  await page.getByText('定时任务', { exact: true }).first().click({ timeout: 25000 });
  await page.locator('[data-testid="schedule-detail"]').getByText('编辑', { exact: true }).click({ timeout: 15000 });
  await page.locator('[data-testid="schedule-form"]').waitFor({ timeout: 10000 });
  const box = page.getByPlaceholder('节点收到的任务');
  await box.waitFor();
  return { ctx, page, box };
};
const formOpen = (page) => page.locator('[data-testid="schedule-form"]').count().then(n => n > 0);

// ── A ────────────────────────────────────────────────────────────────────────
{
  reset();
  const { ctx, page, box } = await openEditor();
  await box.fill('我改过的内容 A');
  runOnce();                                   // the schedule fires while the dialog is open
  await page.waitForTimeout(11_000);           // ≥ one 10 s list poll
  ck('A: draft survives the list poll', (await box.inputValue()) === '我改过的内容 A', await box.inputValue());
  await page.locator('[data-testid="schedule-form-save"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="schedule-form"]'), null, { timeout: 10000 }).catch(() => {});
  ck('A: two PATCHes (409 then retry)', patches.length === 2, JSON.stringify(patches.map(p => p.revision)));
  ck('A: first PATCH used the stale revision 4', patches[0]?.revision === 4);
  ck('A: retry used the refreshed revision 5 with the typed text', patches[1]?.revision === 5 && patches[1]?.task === '我改过的内容 A');
  ck('A: saved on the hub', row.task_content === '我改过的内容 A' && row.revision === 6);
  ck('A: form closed, no conflict view', !(await formOpen(page)) && (await page.locator('[data-testid="schedule-conflict"]').count()) === 0);
  if (OUT) await page.screenshot({ path: `${OUT}/A-after-save.png` });
  await ctx.close();
}
// ── B ────────────────────────────────────────────────────────────────────────
for (const choice of ['mine', 'theirs']) {
  reset();
  const tag = choice === 'mine' ? 'B' : 'C';
  const { ctx, page, box } = await openEditor();
  await box.fill(`我的内容 ${tag}`);
  row = { ...row, task_content: '别的设备的内容', revision: row.revision + 1 };   // another device edited the same field
  await page.locator('[data-testid="schedule-form-save"]').click();
  const view = page.locator('[data-testid="schedule-conflict"]');
  await view.waitFor({ timeout: 10000 }).catch(() => {});
  ck(`${tag}: conflict view shown`, (await view.count()) === 1);
  ck(`${tag}: only 任务内容 listed`, (await page.locator('[data-testid="schedule-conflict-task"]').count()) === 1);
  ck(`${tag}: 你的修改 / 最新版本 values`, (await page.locator('[data-testid="schedule-conflict-task-mine"]').innerText()) === `我的内容 ${tag}` && (await page.locator('[data-testid="schedule-conflict-task-theirs"]').innerText()) === '别的设备的内容');
  ck(`${tag}: draft still in the textarea`, (await box.inputValue()) === `我的内容 ${tag}`);
  ck(`${tag}: only one PATCH so far (no blind retry)`, patches.length === 1);
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-conflict.png` });
  await page.locator(`[data-testid="schedule-conflict-${choice}"]`).click();
  await page.waitForTimeout(1500);
  if (choice === 'mine') {
    ck('B: 用我的覆盖 PATCHes at the latest revision with my text', patches.length === 2 && patches[1].revision === 5 && patches[1].task === '我的内容 B');
    ck('B: saved, form closed', row.task_content === '我的内容 B' && !(await formOpen(page)));
  } else {
    ck('C: 用最新的 sends nothing', patches.length === 1);
    ck('C: form stays open showing the latest text', (await formOpen(page)) && (await box.inputValue()) === '别的设备的内容');
    await page.locator('[data-testid="schedule-form-save"]').click();
    await page.waitForTimeout(1500);
    ck('C: a later save uses the latest revision (no second 409)', patches.length === 2 && patches[1].revision === 5 && !(await formOpen(page)));
  }
  await ctx.close();
}

await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
