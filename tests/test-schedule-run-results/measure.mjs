// 定时任务「执行记录」展开看执行结果 —— 对着一个真 Hub 量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself
// (never 127.0.0.1:9200). The hub must already hold the seed from seed.mjs in this directory
// (placeholder alias `demo-node`, schedule `sched_demo_daily`, runs srun_demo_1…5).
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:9299 HUB_TOKEN=<utok_…> \
//   HUB_NETWORK=<net_…> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-schedule-run-results/measure.mjs
//
// For 1200×800 (desktop shell, master-detail) × light/dark and 390×844 (Android UA ⇒ phone, list → detail):
//   rows     : every run row shows the mapped state (执行中 / 已完成 / 失败 / 已跳过 / 已送达) and 用时 where
//              the run finished; time + 用时 share one baseline (±1px); status chip and chevron centred on the
//              row (±1px)
//   expanded : the replied run opens inline — the reply (markdown table) and the image attachment render,
//              the reply block starts on the time text's left edge (±1px); the failed run shows its reason
//   去会话    : opens the chat with the node, and the scheduled task's bubble is inside the viewport
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

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
const initScript = ({ hubUrl, token, networkId, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-sched-results', displayName: 'tester', networkId };
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
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const r1 = (n) => Math.round(n * 10) / 10;

const rows = [];
let failures = 0;
function record(vp, scheme, what, checks, detail) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, scheme, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
// Box + text baseline (from the element's own font metrics — boxes of different font sizes can share a
// baseline while their bottoms differ, so comparing bottoms would be the wrong judge).
const measure = (page, testId) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText(el.textContent || 'x');
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  const lh = cs.lineHeight === 'normal' ? asc + desc : parseFloat(cs.lineHeight);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const baseline = b.top + padTop + (lh - (asc + desc)) / 2 + asc;
  return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2, baseline, text: el.textContent };
}, testId);

const replyInView = (page) => page.evaluate(() => {
  const hits = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && (e.textContent || '').includes('心跳 12 分钟前'));
  const b = hits[0]?.getBoundingClientRect();
  return b ? { top: b.top, bottom: b.bottom, vh: window.innerHeight } : null;
});

const EXPECT = {
  srun_demo_1: { label: '执行中', duration: false },
  srun_demo_2: { label: '已完成', duration: '用时 3 分 12 秒' },
  srun_demo_3: { label: '失败', duration: '用时 1 天' },
  srun_demo_4: { label: '已跳过', duration: false },
  srun_demo_5: { label: '已送达', duration: false },
};

const cases = [
  { w: 1200, h: 800, scheme: 'light', phone: false },
  { w: 1200, h: 800, scheme: 'dark', phone: false },
  { w: 390, h: 844, scheme: 'light', phone: true },
];
for (const { w, h, scheme, phone } of cases) {
  const vp = `${w}x${h}`;
  const tag = `${w}-${scheme}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2, ...(phone ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme: scheme });
  await page.goto(WEB_URL);
  const nav = phone ? page.getByText('定时任务', { exact: true }).first() : page.locator('[aria-label="定时"]').first();
  await nav.click({ timeout: 30000 });
  await page.locator('[data-testid="schedule-row-sched_demo_daily"]').waitFor({ timeout: 15000 });
  if (phone) await page.locator('[data-testid="schedule-row-sched_demo_daily"]').click();
  await page.locator('[data-testid="schedule-run-srun_demo_2"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500); // open runs read their task (执行中)

  // ── collapsed rows ───────────────────────────────────────────────────────
  for (const [id, want] of Object.entries(EXPECT)) {
    const head = await measure(page, `schedule-run-toggle-${id}`);
    const time = await measure(page, `schedule-run-time-${id}`);
    const dur = await measure(page, `schedule-run-duration-${id}`);
    const pill = await measure(page, `schedule-run-status-${id}`);
    const chev = await measure(page, `schedule-run-chevron-${id}`);
    const checks = {
      label: pill?.text === want.label,
      duration: want.duration ? dur?.text === want.duration : !dur,
      pillCentred: !!pill && Math.abs(pill.cy - head.cy) <= 1,
      chevronCentred: !!chev && Math.abs(chev.cy - head.cy) <= 1,
    };
    if (dur) checks.sameBaseline = Math.abs(dur.baseline - time.baseline) <= 1;
    record(vp, scheme, `row ${id}`, checks, {
      status: pill?.text, dur: dur?.text ?? '-', baseTime: r1(time.baseline), baseDur: dur ? r1(dur.baseline) : '-',
      dBase: dur ? r1(Math.abs(dur.baseline - time.baseline)) : '-', cyRow: r1(head.cy), cyPill: r1(pill?.cy ?? -1), cyChev: r1(chev?.cy ?? -1),
    });
  }
  await page.screenshot({ path: `${OUT}/runs-${tag}-collapsed.png` });

  // ── expand the replied run ───────────────────────────────────────────────
  await page.locator('[data-testid="schedule-run-toggle-srun_demo_2"]').click();
  await page.locator('[data-testid="schedule-run-reply"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200); // authed thumbnail fetch
  const reply = await measure(page, 'schedule-run-reply');
  const time2 = await measure(page, 'schedule-run-time-srun_demo_2');
  const btn = await measure(page, 'schedule-run-open-chat');
  const hasTable = await page.locator('[data-testid="schedule-run-reply"] >> text=心跳 12 分钟前').count();
  const img = await page.evaluate(() => [...document.querySelectorAll('[data-testid="schedule-run-reply"] img')].map(i => ({ w: i.naturalWidth, ok: i.complete && i.naturalWidth > 0 })));
  record(vp, scheme, 'expanded replied run', {
    table: hasTable > 0, image: img.some(i => i.ok), leftEdge: !!reply && Math.abs(reply.x - time2.x) <= 1, button: !!btn && Math.abs(btn.x - time2.x) <= 1,
  }, { replyX: r1(reply?.x ?? -1), timeX: r1(time2.x), btnX: r1(btn?.x ?? -1), imgs: img.length });
  await page.locator('[data-testid="schedule-run-srun_demo_2"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/runs-${tag}-expanded.png` });

  // ── the failed run shows its reason ───────────────────────────────────────
  await page.locator('[data-testid="schedule-run-toggle-srun_demo_3"]').click();
  await page.locator('[data-testid="schedule-run-result-srun_demo_3"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  const failText = await page.locator('[data-testid="schedule-run-result-srun_demo_3"]').textContent();
  record(vp, scheme, 'expanded failed run', { reason: failText.includes('任务过期') && failText.includes('task_expired') }, { text: failText.slice(0, 40) });

  // ── 去会话 ────────────────────────────────────────────────────────────────
  await page.locator('[data-testid="schedule-run-toggle-srun_demo_2"]').click();
  await page.locator('[data-testid="schedule-run-open-chat"]').first().click();
  await page.waitForTimeout(2500);
  // task_demo_2's reply text is unique in the conversation; 12 newer exchanges keep it off-screen
  // unless the chat scrolled to it (the control below opens the same chat without 去会话).
  const bubble = await replyInView(page);
  record(vp, scheme, '去会话 → focused bubble', { inView: !!bubble && bubble.bottom > 0 && bubble.top < bubble.vh }, { top: r1(bubble?.top ?? -1), bottom: r1(bubble?.bottom ?? -1) });
  await page.screenshot({ path: `${OUT}/runs-${tag}-chat.png` });
  await ctx.close();
}
// ── control: the same chat opened from the conversation list is NOT at task_demo_2 ─────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: 'light', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme: 'light' });
  await page.goto(WEB_URL);
  await page.getByText('demo-node', { exact: true }).first().click({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const bubble = await replyInView(page);
  record('1200x800', 'light', 'control: chat opened normally', { notInView: !bubble || bubble.top >= bubble.vh || bubble.bottom <= 0 }, { top: r1(bubble?.top ?? -1), bottom: r1(bubble?.bottom ?? -1) });
  await ctx.close();
}
await browser.close(); web.close();

const cols = ['vp', 'scheme', 'what', 'status', 'dur', 'baseTime', 'baseDur', 'dBase', 'cyRow', 'cyPill', 'cyChev', 'replyX', 'timeX', 'btnX', 'ok', 'failed'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c] ?? '').join(' | ')} |`);
console.log(`\n${rows.length} measurements, ${failures} failing`);
process.exit(failures ? 1 : 0);
