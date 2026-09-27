// 节点页「定时任务」分区 —— 对着一个真 Hub 量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself
// (never 127.0.0.1:9200). The hub must already hold the seed from seed.mjs in this directory
// (placeholder nodes demo-node-a / demo-node-b / demo-node-c).
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:9297 HUB_TOKEN=<utok_…> \
//   HUB_NETWORK=<net_…> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-node-schedules/measure.mjs
//
// For 1200×800 (desktop shell) and 390×844 (Android UA ⇒ phone), reached the way a user does
// (agent row → chat → 查看节点信息 → 定时任务):
//   filter   : exactly demo-node-a's 3 Hub plans + 2 node plans; nothing of demo-node-b (incl. the plan whose
//              stored alias collides with demo-node-a)
//   rows     : source label / name left edges equal across rows (±1px); the switch centred on its row (±1px);
//              last-run chips 已完成 / 执行中 / 失败 where seeded
//   header   : the 定时任务 title sits where the 任务 section's title sits (x, y ±1px); ＋ 新建 centred on it
//   toggle   : Hub plan pause → hub reads paused, resume → active; managed cron → a pending edit intent
//              (read back from the hub) and the switch goes disabled with a hint; systemd switch disabled
//   open     : tapping a Hub row lands on 定时任务 with that plan's detail (paused → the 已暂停 filter);
//              tapping a node plan lands on 节点计划 with that row selected and in view
//   新建      : opens the new-schedule form with 执行节点 = demo-node-a (header) / demo-node-c (empty state)
//   states   : demo-node-c shows the empty state; a failed schedules read shows the error + 重试 recovers
// Exit 1 when any assertion fails. The cron toggle leaves a pending edit intent on the hub (no node claims it);
// before a rerun, reseed or `DELETE FROM external_schedule_edits` in the throwaway DB.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

const hubGet = async (path) => (await fetch(`${HUB_URL}${path}`, { headers: { authorization: `Bearer ${HUB_TOKEN}` } })).json();
const hubSchedule = async (id) => (await hubGet(`/api/scheduled-tasks/${id}?network_id=${HUB_NETWORK}`)).schedule;
const hubPatch = async (id, body) => fetch(`${HUB_URL}/api/scheduled-tasks/${id}?network_id=${HUB_NETWORK}`, {
  method: 'PATCH', headers: { authorization: `Bearer ${HUB_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (the plain web branch hits SecureStore); plugin:http is forwarded to the real hub.
// window.__failSchedules = true makes GET /api/scheduled-tasks answer 503 (error-state probe).
const initScript = ({ hubUrl, token, networkId, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-node-schedules', displayName: 'tester', networkId };
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
          const failing = window.__failSchedules && /\/api\/scheduled-tasks\?/.test(c.url) && c.method === 'GET';
          const r = failing ? new Response('{}', { status: 503, statusText: 'Service Unavailable' })
            : await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url || c.url, headers: Array.from(r.headers.entries()), rid: id };
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
const r1 = (n) => Math.round(n * 10) / 10;

const rows = [];
let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2, text: el.textContent };
}, sel);
const tid = (id) => `[data-testid="${id}"]`;

const A_ROWS = ['hub_sched_demo_a_hourly', 'hub_sched_demo_a_daily', 'hub_sched_demo_a_weekly', 'node_cron_demo_cleanup', 'node_sysd_demo_sync'];
const LAST = { hub_sched_demo_a_hourly: '上次 执行中', hub_sched_demo_a_daily: '上次 已完成', hub_sched_demo_a_weekly: null, node_cron_demo_cleanup: '上次 已完成', node_sysd_demo_sync: '上次 失败' };

async function openNodePage(page, alias) {
  await page.getByText(alias, { exact: true }).first().click({ timeout: 30000 });
  await page.locator('[aria-label="查看节点信息"]').first().click({ timeout: 15000 });
  await page.locator(tid('node-section-nav')).waitFor({ timeout: 15000 });
}
const openSchedulesSection = async (page) => {
  await page.locator(`${tid('node-section-nav')} [aria-label="定时任务"]`).first().click();
  await page.locator(`${tid('node-schedules-list')}, ${tid('node-schedules-empty')}, ${tid('node-schedules-error')}`).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500); // last-run reads
};

const cases = [
  { w: 1200, h: 800, phone: false },
  { w: 390, h: 844, phone: true },
];
for (const { w, h, phone } of cases) {
  const vp = `${w}x${h}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', deviceScaleFactor: 2, ...(phone ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme: 'light' });
  await page.goto(WEB_URL);
  await openNodePage(page, 'demo-node-a');

  // ── header alignment: 任务 section title vs 定时任务 section title ─────────────────
  await page.locator(`${tid('node-section-nav')} [aria-label="任务"]`).first().click();
  await page.waitForTimeout(600);
  const tasksTitle = await box(page, tid('node-section-title'));
  await openSchedulesSection(page);
  const schedTitle = await box(page, tid('node-section-title'));
  const createBtn = await box(page, tid('node-schedules-create'));
  record(vp, 'section header vs 任务 header', {
    sameX: Math.abs(schedTitle.x - tasksTitle.x) <= 1, sameY: Math.abs(schedTitle.y - tasksTitle.y) <= 1,
    title: schedTitle.text === '定时任务', createCentred: !!createBtn && Math.abs(createBtn.cy - schedTitle.cy) <= 1,
  }, { tasksX: r1(tasksTitle.x), schedX: r1(schedTitle.x), tasksY: r1(tasksTitle.y), schedY: r1(schedTitle.y), titleCy: r1(schedTitle.cy), createCy: r1(createBtn?.cy ?? -1) });
  await page.screenshot({ path: `${OUT}/node-schedules-${vp}.png` });

  // ── filter: only demo-node-a's plans ───────────────────────────────────────────────
  const listed = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="node-schedule-row-"]')].map(e => e.getAttribute('data-testid').replace('node-schedule-row-', '')));
  const pageText = await page.locator(tid('node-schedules-list')).textContent();
  record(vp, 'filter by node_id', {
    exact: JSON.stringify(listed) === JSON.stringify(A_ROWS),
    noOtherNode: !pageText.includes('别的节点') && !pageText.includes('同名陷阱'),
  }, { listed: listed.join(' ') });

  // ── rows: label edges, switch centring, last-run chips ────────────────────────────
  const srcX = []; const nameX = [];
  for (const id of A_ROWS) {
    const row = await box(page, tid(`node-schedule-row-${id}`));
    const src = await box(page, tid(`node-schedule-source-${id}`));
    const name = await box(page, tid(`node-schedule-name-${id}`));
    const sw = await page.evaluate((s) => { const el = document.querySelector(s)?.firstElementChild; if (!el) return null; const b = el.getBoundingClientRect(); return { cy: b.y + b.height / 2, h: b.height }; }, tid(`node-schedule-toggle-${id}`));
    const last = await box(page, tid(`node-schedule-last-${id}`));
    srcX.push(src.x); nameX.push(name.x);
    record(vp, `row ${id}`, {
      switchCentred: !!sw && Math.abs(sw.cy - row.cy) <= 1,
      last: LAST[id] ? last?.text === LAST[id] : !last,
    }, { src: src.text, srcX: r1(src.x), nameX: r1(name.x), rowCy: r1(row.cy), switchCy: r1(sw?.cy ?? -1), dCy: r1(Math.abs((sw?.cy ?? 0) - row.cy)), last: last?.text ?? '-' });
  }
  record(vp, 'row label left edges', {
    sourceEdges: Math.max(...srcX) - Math.min(...srcX) <= 1, nameEdges: Math.max(...nameX) - Math.min(...nameX) <= 1,
  }, { srcX: `${r1(Math.min(...srcX))}–${r1(Math.max(...srcX))}`, nameX: `${r1(Math.min(...nameX))}–${r1(Math.max(...nameX))}` });

  // ── toggles (desktop pass only: each flip writes hub state) ─────────────────────────
  if (!phone) {
    const sw = (id) => page.locator(`${tid(`node-schedule-toggle-${id}`)} input`).first();
    await sw('hub_sched_demo_a_daily').click();
    await page.waitForTimeout(1500);
    const afterPause = (await hubSchedule('sched_demo_a_daily')).status;
    const pausedUi = await sw('hub_sched_demo_a_daily').isChecked();
    await sw('hub_sched_demo_a_daily').click();
    await page.waitForTimeout(1500);
    const afterResume = (await hubSchedule('sched_demo_a_daily')).status;
    const resumedUi = await sw('hub_sched_demo_a_daily').isChecked();
    record(vp, 'toggle Hub plan (read back)', { paused: afterPause === 'paused' && !pausedUi, resumed: afterResume === 'active' && resumedUi }, { afterPause, afterResume });

    const sysDisabled = await sw('node_sysd_demo_sync').isDisabled();
    const sysHint = await box(page, tid('node-schedule-hint-node_sysd_demo_sync'));
    record(vp, 'systemd node plan: switch disabled + hint', { disabled: sysDisabled, hint: !!sysHint?.text.includes('只读') }, { hint: sysHint?.text ?? '-' });

    await sw('node_cron_demo_cleanup').click();
    await page.waitForTimeout(2000);
    const edits = (await hubGet(`/api/nodes/node_demo_a/external-schedule-edits?network_id=${HUB_NETWORK}`)).edits || [];
    const intent = edits.find(e => e.schedule_id === 'cron_demo_cleanup');
    const cronDisabled = await sw('node_cron_demo_cleanup').isDisabled();
    const cronHint = await box(page, tid('node-schedule-hint-node_cron_demo_cleanup'));
    record(vp, 'managed cron: edit intent (read back)', {
      intent: intent?.status === 'pending' && intent?.patch?.enabled === false, disabled: cronDisabled, hint: !!cronHint?.text.includes('意向在途'),
    }, { intent: intent ? `${intent.status} ${JSON.stringify(intent.patch)}` : '-', hint: cronHint?.text ?? '-' });
    await page.screenshot({ path: `${OUT}/node-schedules-${vp}-after-toggles.png` });
  }

  // ── tap a Hub row → 定时任务 with it selected ──────────────────────────────────────
  for (const [id, sched, name] of [['hub_sched_demo_a_daily', 'sched_demo_a_daily', '每日巡检'], ['hub_sched_demo_a_weekly', 'sched_demo_a_weekly', '周报汇总']]) {
    await page.locator(tid(`node-schedule-open-${id}`)).click();
    await page.locator(tid('schedule-detail')).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const detail = await page.locator(tid('schedule-detail')).textContent();
    const selectedRow = phone ? true : await page.evaluate((s) => !!document.querySelector(s), tid(`schedule-row-${sched}`));
    // The list only holds the current filter's rows, so the row being there + the detail showing its name
    // is the "selected under the right filter" proof (the paused plan needs the 已暂停 filter).
    record(vp, `open ${sched}`, { detail: detail.includes(name) && detail.includes('执行记录'), rowInFilteredList: selectedRow });
    await page.screenshot({ path: `${OUT}/open-${sched}-${vp}.png` });
    await page.goBack().catch(() => {});
    await page.goto(WEB_URL);
    await openNodePage(page, 'demo-node-a');
    await openSchedulesSection(page);
  }

  // ── tap a node plan → 节点计划 with it selected and in view ─────────────────────────
  await page.locator(tid('node-schedule-open-node_sysd_demo_sync')).click();
  const ext = tid('external-schedule-node_demo_a-sysd_demo_sync');
  await page.locator(ext).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const extState = await page.evaluate((s) => { const el = document.querySelector(s); const b = el.getBoundingClientRect(); return { selected: el.getAttribute('aria-selected'), top: b.top, bottom: b.bottom, vh: window.innerHeight }; }, ext);
  // external-schedule-* rows only render on the 节点计划 tab, so finding it proves the tab switched.
  record(vp, 'open node plan', { selected: extState.selected === 'true', inView: extState.top >= 0 && extState.bottom <= extState.vh }, { top: r1(extState.top), bottom: r1(extState.bottom) });
  await page.screenshot({ path: `${OUT}/open-node-plan-${vp}.png` });

  // ── ＋ 新建 prefills this node ───────────────────────────────────────────────────────
  await page.goto(WEB_URL);
  await openNodePage(page, 'demo-node-a');
  await openSchedulesSection(page);
  await page.locator(tid('node-schedules-create')).click();
  await page.locator(tid('schedule-form')).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const target = await box(page, tid('schedule-target-name'));
  record(vp, '＋ 新建 prefills executor', { prefilled: target?.text === 'demo-node-a' }, { target: target?.text ?? '-' });
  await page.screenshot({ path: `${OUT}/create-prefilled-${vp}.png` });

  // ── empty state (demo-node-c) + 新建 from it ───────────────────────────────────────
  await page.goto(WEB_URL);
  await openNodePage(page, 'demo-node-c');
  await openSchedulesSection(page);
  const empty = await box(page, tid('node-schedules-empty'));
  record(vp, 'empty state', { shown: !!empty?.text.includes('这个节点还没有定时任务'), button: !!(await box(page, tid('node-schedules-empty-create'))) }, { text: empty?.text ?? '-' });
  await page.screenshot({ path: `${OUT}/node-schedules-empty-${vp}.png` });
  await page.locator(tid('node-schedules-empty-create')).click();
  await page.locator(tid('schedule-form')).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const targetC = await box(page, tid('schedule-target-name'));
  record(vp, 'empty-state 新建 prefills executor', { prefilled: targetC?.text === 'demo-node-c' }, { target: targetC?.text ?? '-' });

  // ── error + retry ────────────────────────────────────────────────────────────────────
  await page.goto(WEB_URL);
  await openNodePage(page, 'demo-node-a');
  await page.evaluate(() => { window.__failSchedules = true; });
  await page.locator(`${tid('node-section-nav')} [aria-label="定时任务"]`).first().click();
  await page.locator(tid('node-schedules-error')).waitFor({ timeout: 15000 });
  const err = await box(page, tid('node-schedules-error'));
  await page.screenshot({ path: `${OUT}/node-schedules-error-${vp}.png` });
  await page.evaluate(() => { window.__failSchedules = false; });
  await page.locator(tid('node-schedules-retry')).click();
  await page.locator(tid('node-schedules-list')).waitFor({ timeout: 15000 });
  const recovered = await page.evaluate(() => !document.querySelector('[data-testid="node-schedules-error"]'));
  record(vp, 'error + 重试', { error: !!err?.text.includes('读取失败') && err.text.includes('503'), recovered }, { text: err?.text.slice(0, 40) ?? '-' });
  await ctx.close();
}
await browser.close(); web.close();

// Leave the seed as found: the cron intent is pending on the hub (the node never claims it); the Hub plan was resumed.
await hubPatch('sched_demo_a_daily', { revision: (await hubSchedule('sched_demo_a_daily')).revision, status: 'active' }).catch(() => {});

const cols = ['vp', 'what', 'src', 'srcX', 'nameX', 'rowCy', 'switchCy', 'dCy', 'last', 'tasksX', 'schedX', 'tasksY', 'schedY', 'titleCy', 'createCy', 'ok', 'failed'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c] ?? '').join(' | ')} |`);
console.log(`\n${rows.length} measurements, ${failures} failing`);
process.exit(failures ? 1 : 0);
