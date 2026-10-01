// 「上次异常退出」end to end on the web export (owner 2026-10-01: small chip, no blocking Alert).
// Not in CI (same as test-changelog / test-schedule-copy): needs Playwright + Chromium and a web export.
// No hub at all: a Tauri stub signs in with a placeholder profile, page.route() answers every hub request.
// Nothing touches 127.0.0.1:9200 or ~/.anet.
//
//   WEB_DIR=<expo export dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [OUT=<png dir>] node tests/test-fatal-recorder/drive.mjs
//
//   1  a child that throws in render → 「出错了 · 重新加载」 screen (not a blank page), the error is recorded
//      (kind=boundary, message + component stack); 重新加载 remounts the children
//   2  next launch with a record → the corner chip 「上次异常退出 · 发送诊断」; no dialog; 发送诊断 POSTs /api/task
//      to the maintainer alias with the diagnostics JSON, then the record is deleted
//   3  untouched chip auto-hides after ~8 s; the record stays (flagged shown) and the chip does not come back
//   4  Settings › 关于 shows 「复制上次崩溃信息」 only while a record exists; tapping copies the diagnostics and deletes it
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB) throw new Error('need WEB_DIR');
if (OUT) mkdirSync(OUT, { recursive: true });
const HUB = 'http://hub.placeholder.invalid';
const KEY = 'anet.lastFatal.v1';
const ALIAS = /DIAGNOSTICS_ALIAS = '([^']+)'/.exec(readFileSync(new URL('../../src/LastCrashChip.tsx', import.meta.url), 'utf8'))[1];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

const REPORT = {
  v: 1, kind: 'global', at: '2026-10-01T07:55:39.000Z', name: 'TypeError', message: "undefined is not an object (evaluating 'x.y')",
  stack: 'TypeError: undefined is not an object\n    at render (index.bundle:1:2)', appVersion: '0.2.180', platform: 'ios', osVersion: '18.7.10', width: 1080, height: 810,
};

// Desktop-shell stub (same as tests/test-changelog): plugin:http goes to page fetch, which page.route() answers.
const initScript = ({ hubUrl, seed, key }) => {
  try {
    localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh');
    // Seed once per context (a reload must see what the app left behind, not the seed again).
    if (seed && !sessionStorage.getItem('seeded')) { localStorage.setItem(key, seed); sessionStorage.setItem('seeded', '1'); }
  } catch {}
  const profile = { serverUrl: hubUrl, token: 'utok_placeholder', username: 'tester', profileId: 'p-fatal', displayName: 'tester', networkId: 'net-placeholder' };
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
const stored = (page) => page.evaluate(k => localStorage.getItem(k), KEY);

const open = async ({ seed, query = '' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, locale: 'zh-CN', deviceScaleFactor: 2, hasTouch: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_URL.replace(/\/$/, '') });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message.split('\n')[0]));
  const posted = [];
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.route(`${HUB}/**`, route => {
    const req = route.request();
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/task') {
      posted.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill(json({ ok: true, task_id: 't-diag-1' }));
    }
    return route.fulfill(json({ ok: true, messages: [], tasks: [], nodes: [], sessions: [], schedules: [] }));
  });
  await page.addInitScript(initScript, { hubUrl: HUB, seed: seed ? JSON.stringify(seed) : null, key: KEY });
  await page.goto(`${WEB_URL}${query}`);
  return { ctx, page, posted, dialogs, pageErrors };
};

// 1 boundary
{
  const { ctx, page } = await open({ query: '?fixture=fatal-boundary' });
  const screen = page.locator(tid('fatal-boundary'));
  await screen.waitFor({ timeout: 25000 }).catch(() => {});
  const text = await screen.textContent().catch(() => '');
  ck('render throw → 「出错了 · 重新加载」 screen', text.includes('出错了') && text.includes('重新加载'), JSON.stringify(text));
  if (OUT) await page.screenshot({ path: `${OUT}/boundary.png` });
  const rec = JSON.parse((await stored(page)) || 'null');
  ck('boundary recorded the error (kind=boundary, message, component stack)', rec?.kind === 'boundary' && rec.message.includes('fixture') && (rec.componentStack || '').trim().length > 0, JSON.stringify(rec)?.slice(0, 200));
  await page.evaluate(() => { globalThis.__fatalFixtureHealed = true; });
  await page.locator(tid('fatal-reload')).click();
  const ok = await page.locator(tid('fatal-fixture-ok')).waitFor({ timeout: 5000 }).then(() => true, () => false);
  ck('重新加载 remounts the children', ok && !(await screen.isVisible().catch(() => false)));
  await ctx.close();
}

// 2 chip → send
{
  const { ctx, page, posted, dialogs } = await open({ seed: REPORT });
  const chip = page.locator(tid('last-crash-chip'));
  const seen = await chip.waitFor({ timeout: 25000 }).then(() => true, () => false);
  const text = seen ? await chip.textContent() : '';
  ck('next launch: corner chip 「上次异常退出 · 发送诊断」', seen && text.includes('上次异常退出') && text.includes('发送诊断'), JSON.stringify(text));
  const b = seen ? await chip.boundingBox() : null;
  ck('chip is small and in the corner (not a dialog)', !!b && b.height <= 40 && b.width < 300 && b.x + b.width > 390 - 40 && dialogs.length === 0, JSON.stringify(b));
  if (OUT) await page.screenshot({ path: `${OUT}/chip.png` });
  await page.locator(tid('last-crash-send')).click();
  await page.waitForTimeout(800);
  const p = posted[0];
  ck(`发送诊断 → POST /api/task to ${ALIAS} with the diagnostics JSON`, posted.length === 1 && p.alias === ALIAS && p.task.startsWith('[diagnostics] last fatal JS error · v0.2.180') && p.task.includes("evaluating 'x.y'"), JSON.stringify(p)?.slice(0, 200));
  ck('sent → record deleted, chip says 诊断已发送', (await stored(page)) === null && (await chip.textContent().catch(() => '')).includes('诊断已发送'));
  await ctx.close();
}

// 3 auto-hide
{
  const { ctx, page } = await open({ seed: REPORT });
  const chip = page.locator(tid('last-crash-chip'));
  await chip.waitFor({ timeout: 25000 }).catch(() => {});
  const shownAt = Date.now();
  const gone = await chip.waitFor({ state: 'detached', timeout: 12000 }).then(() => true, () => false);
  const after = (Date.now() - shownAt) / 1000;
  const rec = JSON.parse((await stored(page)) || 'null');
  ck('untouched chip auto-hides after ~8 s', gone && after >= 6 && after <= 11, `${after.toFixed(1)} s`);
  ck('auto-hide keeps the record, flagged shown', rec?.shown === true && rec.message === REPORT.message);
  await page.reload();
  await page.locator(tid('mobile-tab-settings')).waitFor({ timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ck('a shown record does not bring the chip back', !(await chip.isVisible().catch(() => false)));

  // 4 Settings › 关于
  await page.locator(tid('mobile-tab-settings')).click({ timeout: 25000 });
  await page.locator(tid('settings-row-about')).click({ timeout: 10000 });
  const row = page.locator(tid('settings-last-crash-row'));
  const rowSeen = await row.waitFor({ timeout: 10000 }).then(() => true, () => false);
  ck('设置 › 关于 has 「复制上次崩溃信息」 while a record exists', rowSeen && (await row.textContent()).includes('复制上次崩溃信息'));
  if (OUT) await page.screenshot({ path: `${OUT}/about.png` });
  await row.click();
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ck('tap copies the diagnostics text', clip.startsWith('[diagnostics] last fatal JS error') && clip.includes(REPORT.message), clip.slice(0, 80));
  ck('…and deletes the record (row disappears)', (await stored(page)) === null && !(await row.isVisible().catch(() => false)));
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await page.locator(tid('mobile-tab-settings')).click({ timeout: 25000 });
  await page.locator(tid('settings-row-about')).click({ timeout: 10000 });
  await page.locator(tid('settings-about')).waitFor({ timeout: 10000 }).catch(() => {});
  ck('no record → no row, no chip', !(await page.locator(tid('settings-last-crash-row')).isVisible().catch(() => false)) && !(await page.locator(tid('last-crash-chip')).isVisible().catch(() => false)));
  await ctx.close();
}

await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
