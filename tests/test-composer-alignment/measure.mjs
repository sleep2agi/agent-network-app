// Mobile composer row alignment — measured, not eyeballed (owner 2026-09-26 on the unfolded
// foldable: the 「按住 说话」 bar sat ~23px above the centre of the ⌨ / ＋ circles, and the side
// margins were uneven). Not in CI: needs Playwright + Chromium + a throwaway hub.
//
//   HUB_URL=http://127.0.0.1:<not 9200> HUB_TOKEN=utok_… ALIAS=<session alias> WEB_DIR=<expo export dir> \
//   OUT=<png dir> TAG=<before|after> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-composer-alignment/measure.mjs
//
// For every viewport (390×844 phone = one pane / standard density; 1200×850 + Android UA = two
// panes / 更紧凑 default density) × light/dark × composer state it reads the boundingBox of
// left toggle (⌨/🎤), middle (bar or input) and right slot (＋ or 发送), and of the row, then
// asserts (single-line states):
//   |centerY(left) − centerY(mid)| ≤ 1, |centerY(right) − centerY(mid)| ≤ 1
//   |leftPad − rightPad| ≤ 1   (outer padding inside the row)
//   |gapL − gapR| ≤ 1          (toggle→mid and mid→right)
//   |h(mid) − h(left)| ≤ 1, |h(right) − h(left)| ≤ 1 (one control height)
// and for the multi-line keyboard state: the input has grown and the buttons are bottom-aligned
// with it (WeChat), ≤ 1.
// Exit code 1 when any assertion fails. Screenshots get a 1px red line at the middle element's
// vertical centre.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const HUB_URL = process.env.HUB_URL, TOKEN = process.env.HUB_TOKEN, ALIAS = process.env.ALIAS, WEB = process.env.WEB_DIR, OUT = process.env.OUT;
const TAG = process.env.TAG || 'run';
if (!HUB_URL || !TOKEN || !ALIAS || !WEB || !OUT) throw new Error('need HUB_URL HUB_TOKEN ALIAS WEB_DIR OUT');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing the production hub port 9200');
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

// Desktop-shell branch (voice input needs its secure storage); same stub as test-voice-composer-visual.
const initScript = ({ hubUrl, token, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-align', displayName: 'tester' };
  const creds = { appId: '', accessToken: 'align-api-key-0000', endpoint: 'http://127.0.0.1:9/flash' };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  try { localStorage.setItem('voice_composer_input_mode_v1', 'voice'); } catch {}
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'load_voice_credentials': return JSON.stringify(creds);
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
async function measure(page, midSel, rightSel) {
  return page.evaluate(([midSel, rightSel]) => {
    const q = (s) => document.querySelector(s);
    const left = q('[data-testid="composer-mode-toggle"]');
    const mid = q(midSel);
    const right = q(rightSel);
    if (!left || !mid || !right) return { missing: { left: !!left, mid: !!mid, right: !!right } };
    let row = left.parentElement;
    while (row && !row.contains(right)) row = row.parentElement;
    const cs = getComputedStyle(row);
    const b = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, cy: r.y + r.height / 2 }; };
    const R = b(row);
    // content box of the row (outer padding measured from the row's border box edges)
    return { left: b(left), mid: b(mid), right: b(right), row: R, rowAlign: cs.alignItems, rowPadL: cs.paddingLeft, rowPadR: cs.paddingRight };
  }, [midSel, rightSel]);
}

const rows = [];
let failures = 0;
async function record(page, vp, scheme, state, midSel, rightSel, { multiline = false } = {}) {
  const m = await measure(page, midSel, rightSel);
  if (m.missing) { console.log('MISSING', vp, scheme, state, JSON.stringify(m.missing)); failures++; return; }
  const leftPad = m.left.x - m.row.x, rightPad = m.row.r - m.right.r;
  const gapL = m.mid.x - m.left.r, gapR = m.right.x - m.mid.r;
  const dL = m.left.cy - m.mid.cy, dR = m.right.cy - m.mid.cy;
  const dBL = m.left.b - m.mid.b, dBR = m.right.b - m.mid.b;
  const checks = multiline
    // multi-line: the input must really have grown (else this state proves nothing), buttons at its bottom
    ? { bottomAligned: Math.abs(dBL) <= 1 && Math.abs(dBR) <= 1, grew: m.mid.h > m.left.h + 10 }
    // single line: one centre line AND one height (a collapsed bar can share the centre line too)
    : { centreLine: Math.abs(dL) <= 1 && Math.abs(dR) <= 1, sameHeight: Math.abs(m.mid.h - m.left.h) <= 1 && Math.abs(m.right.h - m.left.h) <= 1 };
  checks.pads = Math.abs(leftPad - rightPad) <= 1;
  checks.gaps = Math.abs(gapL - gapR) <= 1;
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = {
    vp, scheme, state,
    hL: r1(m.left.h), hMid: r1(m.mid.h), hR: r1(m.right.h),
    cyL: r1(m.left.cy), cyMid: r1(m.mid.cy), cyR: r1(m.right.cy),
    dCyL: r1(dL), dCyR: r1(dR), dBotL: r1(dBL), dBotR: r1(dBR),
    padL: r1(leftPad), padR: r1(rightPad), gapL: r1(gapL), gapR: r1(gapR),
    align: m.rowAlign, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-',
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  // guide line at the middle element's centre + screenshot cropped around the row
  await page.evaluate((y) => {
    document.getElementById('__align_guide')?.remove();
    const d = document.createElement('div');
    d.id = '__align_guide';
    d.style.cssText = `position:fixed;left:0;right:0;top:${y - 0.5}px;height:1px;background:#ff0000;z-index:2147483647;pointer-events:none`;
    document.body.appendChild(d);
  }, m.mid.cy);
  const top = Math.max(0, m.row.y - 70), bottom = Math.min(page.viewportSize().height, m.row.b + 10);
  await page.screenshot({ path: `${OUT}/align-${TAG}-${vp}-${scheme}-${state}.png`, clip: { x: 0, y: top, width: page.viewportSize().width, height: bottom - top } });
  await page.evaluate(() => document.getElementById('__align_guide')?.remove());
}

for (const [w, h, ua] of [[390, 844, ANDROID_UA], [1200, 850, ANDROID_UA]]) {
  for (const scheme of ['light', 'dark']) {
    const vp = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, userAgent: ua, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, theme: scheme });
    await page.goto(WEB_URL);
    await page.getByText(ALIAS, { exact: true }).first().click({ timeout: 20000 });
    await page.locator('[data-testid="voice-hold-bar"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    await record(page, vp, scheme, 'voice', '[data-testid="voice-hold-bar"]', '[data-testid="composer-plus"]');

    await page.locator('[data-testid="composer-mode-toggle"]').click();
    const input = page.locator(`textarea[placeholder="Message ${ALIAS}…"]`);
    await input.waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    await record(page, vp, scheme, 'keyboard-empty', 'textarea', '[data-testid="composer-plus"]');

    await input.fill('帮我看一下今天的构建');
    await page.locator('[data-testid="composer-send"]').waitFor({ timeout: 3000 });
    await page.waitForTimeout(300);
    await record(page, vp, scheme, 'keyboard-send', 'textarea', '[data-testid="composer-send"]');

    await input.fill('第一行\n第二行\n第三行');
    await page.waitForTimeout(400);
    await record(page, vp, scheme, 'keyboard-multiline', 'textarea', '[data-testid="composer-send"]', { multiline: true });

    // back to voice with a draft → #422 draft card above the bar, right slot = 发送
    await input.fill('帮我看一下今天的构建为什么失败了');
    await page.locator('[data-testid="composer-mode-toggle"]').click();
    await page.locator('[data-testid="voice-draft-card"]').waitFor({ timeout: 3000 });
    await page.waitForTimeout(300);
    await record(page, vp, scheme, 'voice-draftcard', '[data-testid="voice-hold-bar"]', '[data-testid="composer-send"]');
    await ctx.close();
  }
}
await browser.close(); web.close();

const cols = ['vp', 'scheme', 'state', 'hL', 'hMid', 'hR', 'dCyL', 'dCyR', 'dBotL', 'dBotR', 'padL', 'padR', 'gapL', 'gapR', 'align', 'ok', 'failed'];
console.log(`\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(c => r[c]).join(' | ')} |`);
console.log(`\n${TAG}: ${rows.length} states measured, ${failures} failing`);
process.exit(failures ? 1 : 0);
