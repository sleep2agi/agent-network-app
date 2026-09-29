// 连接横幅 + 任务页离线 —— 对着一个可调延迟/可断开的**假 Hub** 用 Playwright 量出来。
// Not in CI: needs Playwright + Chromium and a web export. No real hub involved (the mock hub below
// is an in-process node:http server on a random port), so nothing here can touch production.
//
//   npx expo export -p web --output-dir <dir>
//   WEB_DIR=<dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [OUT=<png dir>] node tests/test-connectivity-banner/run.mjs
//
// Phone 390×844, Android UA, 任务 tab. Scenarios (each asserted, exit 1 on any failure):
//   healthy     : board shows the seeded cards, no banner
//   one-slow    : ONE read takes 9 s (slow but succeeds) → sampled every 250 ms for 14 s: banner never appears
//   one-dead    : ONE read hangs past the 20 s read deadline (→ one failed read) → sampled for 26 s: banner never appears
//   sustained   : every request is reset → 「无法连接服务器 · 显示缓存数据（截至 HH:MM）」 appears, board keeps the cached
//                 cards (no spinner, no full-page error); HH:MM = the last successful read, not the last attempt
//   recover     : hub back + tap the banner → banner gone within 3 s
//   cold-hang   : fresh page while the hub accepts connections and never answers → the task page spinner is replaced
//                 by an error with 重试 within the 20 s deadline (+ margin), never spins forever
//   flaky       : 60 s where every 2nd request is reset → 「无法连接服务器」 never shown
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
if (OUT) mkdirSync(OUT, { recursive: true });

// ── mock hub ──────────────────────────────────────────────────────────────
// mode.kind: ok | reset (destroy every socket) | hang (accept, never answer) | flaky (reset every Nth request)
// mode.slowNext / mode.hangNext: the next matching read (path prefix) is delayed / never answered — once.
let mode = { kind: 'ok' };
let seen = 0;
const log = [];
const cards = [
  { id: 'r1', name: '离线也要看得到的卡片', priority: 'high', column: 'pool', createdAt: '2026-09-28T00:00:00.000Z' },
  { id: 'r2', name: '第二张卡片', priority: 'normal', column: 'doing', createdAt: '2026-09-28T00:00:00.000Z' },
];
const body = (path) => {
  if (path.startsWith('/api/status')) return { sessions: [{ alias: 'demo-node-a', status: 'idle', network_id: 'net_demo', updated_at: new Date().toISOString() }] };
  if (path.startsWith('/api/nodes')) return { ok: true, nodes: [], count: 0 };
  if (path.startsWith('/api/tasks')) return { tasks: [] };
  if (path.startsWith('/api/messages')) return { messages: [] };
  if (path.startsWith('/api/requirements/projects')) return { projects: [] };
  if (path.startsWith('/api/requirements')) return { requirements: cards };
  if (path.startsWith('/api/auth/me')) return { user: { user_id: 'u_demo' } };
  if (path.startsWith('/api/scheduled-tasks')) return { ok: true, schedules: [] };
  if (path.startsWith('/health')) return { ok: true };
  return {};
};
const hub = createServer((req, res) => {
  const path = req.url || '/';
  seen++;
  log.push({ at: Date.now(), path, mode: mode.kind });
  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
  const answer = () => { res.writeHead(200, { 'content-type': 'application/json', ...cors() }); res.end(JSON.stringify(body(path))); };
  if (mode.kind === 'reset' || (mode.kind === 'flaky' && seen % mode.every === 0)) return req.socket.destroy();
  if (mode.kind === 'hang') return; // never answers
  if (mode.hangNext && path.startsWith(mode.hangNext)) { mode = { ...mode, hangNext: null }; return; }
  if (mode.slowNext && path.startsWith(mode.slowNext)) { mode = { ...mode, slowNext: null }; return void setTimeout(answer, mode.slowMs); }
  answer();
}).listen(0, '127.0.0.1');
const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });

// ── web export server ─────────────────────────────────────────────────────
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const HUB_URL = `http://127.0.0.1:${hub.address().port}`;
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (the plain web branch hits SecureStore). plugin:http is forwarded to the mock hub,
// and — unlike the task-board harness — honours fetch_cancel, so the app's AbortController really aborts.
const initScript = ({ hubUrl }) => {
  const profile = { serverUrl: hubUrl, token: 'utok_demo', username: 'tester', profileId: 'p-conn', displayName: 'tester', networkId: 'net_demo' };
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
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, { c: args.clientConfig, ctrl: new AbortController() }); return id; }
        case 'plugin:http|fetch_cancel': { reqs.get(args.rid)?.ctrl.abort(); return null; }
        case 'plugin:http|fetch_send': {
          const { c, ctrl } = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined, signal: ctrl.signal });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url || c.url, headers: Array.from(r.headers.entries()), rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        case 'plugin:http|fetch_cancel_body': return null;
        default: return null;
      }
    },
  };
  try { localStorage.setItem('theme_mode_v1', 'light'); } catch {}
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const tid = (id) => `[data-testid="${id}"]`;

let failures = 0;
function record(what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
}
const bannerNow = (page) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, tid('connectivity-banner'));
async function sample(page, ms) {
  const seenTexts = new Set();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const b = await bannerNow(page);
    if (b) seenTexts.add(b);
    await page.waitForTimeout(250);
  }
  return [...seenTexts];
}
async function openTasks() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: ANDROID_UA, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { hubUrl: HUB_URL });
  await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  return { ctx, page };
}
const hhmm = (at) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`) }); };

// ── healthy ──
mode = { kind: 'ok' };
const { ctx, page } = await openTasks();
await page.getByText('离线也要看得到的卡片').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
record('healthy', { cardsShown: await page.getByText('离线也要看得到的卡片').count() > 0, noBanner: (await bannerNow(page)) === null });
await shot(page, '1-healthy');

// ── one slow read (9 s, succeeds) ──
mode = { kind: 'ok', slowNext: '/api/', slowMs: 9_000 };
const slowSeen = await sample(page, 14_000);
record('one-slow: a single 9 s read never shows the banner', { neverShown: slowSeen.length === 0 }, { seen: slowSeen });

// ── one dead read (hangs past the 20 s deadline → one failed read) ──
mode = { kind: 'ok', hangNext: '/api/' };
const deadSeen = await sample(page, 26_000);
record('one-dead: a single read that times out never shows the banner', { neverShown: deadSeen.length === 0, hangConsumed: !mode.hangNext }, { seen: deadSeen });

// ── sustained failure ──
mode = { kind: 'reset' };
const t0 = Date.now();
let offlineText = null;
while (Date.now() - t0 < 120_000) {
  const b = await bannerNow(page);
  if (b && b.includes('无法连接服务器')) { offlineText = b; break; }
  await page.waitForTimeout(500);
}
const tookMs = Date.now() - t0;
await shot(page, '2-offline');
// Honest = the last read that actually succeeded before the outage: never a time after it started
// (an attempt), and not older than the page's polling cadence allows (reads succeed every ≤ 15 s while healthy).
const honestStamps = new Set([0, 10, 20, 30].map(s => hhmm(t0 - s * 1000)));
const stamp = offlineText?.match(/截至 (\d\d:\d\d)/)?.[1];
record('sustained: banner shows after sustained failure', {
  shown: !!offlineText,
  saysCached: !!offlineText && offlineText.includes('显示缓存数据'),
  honestTime: !!stamp && honestStamps.has(stamp),
  notInstant: tookMs >= 9_000,
  boardKeepsCache: await page.getByText('离线也要看得到的卡片').count() > 0,
  noSpinner: (await page.locator(tid('req-loading')).count()) === 0,
}, { tookMs, offlineText, honestStamps: [...honestStamps] });
const perMinute = log.filter(l => l.at > t0 && l.at <= t0 + tookMs).length;
record('sustained: requests back off (no hammering the dead hub)', { backedOff: perMinute / Math.max(tookMs / 60_000, 0.1) < 60 }, { requestsDuringOutage: perMinute, tookMs });

// ── recover: hub back + tap the banner ──
mode = { kind: 'ok' };
const tr = Date.now();
await page.locator(tid('connectivity-banner')).click();
let gone = false;
while (Date.now() - tr < 3_000) { if ((await bannerNow(page)) === null) { gone = true; break; } await page.waitForTimeout(100); }
record('recover: tap → banner gone within 3 s', { gone }, { ms: Date.now() - tr });
await ctx.close();

// ── cold start while the hub never answers ──
mode = { kind: 'hang' };
{
  const { ctx: c2, page: p2 } = await openTasks();
  const tc = Date.now();
  let settled = null;
  while (Date.now() - tc < 30_000) {
    const spinning = await p2.locator(tid('req-loading')).count();
    const err = await p2.locator(`${tid('req-retry')}, ${tid('req-retrying')}`).count();
    if (!spinning && err) { settled = Date.now() - tc; break; }
    await p2.waitForTimeout(250);
  }
  await shot(p2, '3-cold-hang');
  record('cold-hang: task page spinner resolves to error + 重试 within the deadline', { settled: settled !== null && settled <= 25_000 }, { settledMs: settled });
  const b = await bannerNow(p2);
  record('cold-hang: banner says there is no data yet (does not invent a time)', { noData: !!b && b.includes('尚未获取到数据') }, { banner: b });
  await c2.close();
}

// ── flaky: every 2nd request reset, for 60 s ──
mode = { kind: 'ok' };
{
  const { ctx: c3, page: p3 } = await openTasks();
  await p3.getByText('离线也要看得到的卡片').first().waitFor({ timeout: 30000 });
  seen = 0;
  mode = { kind: 'flaky', every: 2 };
  const flakySeen = await sample(p3, 60_000);
  const resets = log.filter(l => l.mode === 'flaky').length;
  record('flaky: 1-in-2 resets for 60 s never says 无法连接', { neverOffline: !flakySeen.some(s => s.includes('无法连接')), someResets: Math.floor(resets / 2) >= 3 }, { seen: flakySeen, requests: resets });
  await c3.close();
}

if (process.env.DEBUG_LOG) { const t00 = log[0]?.at || 0; for (const l of log) console.log(((l.at - t00) / 1000).toFixed(1), l.mode, l.path); }
await browser.close(); hub.close(); web.close();
console.log(failures ? `\n${failures} scenario(s) FAILED` : '\nall scenarios passed');
process.exit(failures ? 1 : 0);
