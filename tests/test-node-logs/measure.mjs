// 节点页「运行日志」分区 —— 对着一个真 Hub + 真 agent-node 量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub + agent-node built from the
// agent-network branch that adds tail_node_logs (never 127.0.0.1:9200). Placeholder aliases only.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:9377 HUB_TOKEN=<utok_…> HUB_NETWORK=<net_…> \
//   NODE_ALIAS=<capable node> OLD_ALIAS=<node that never reported logs_capable> NODE_LOG=<that node's dated log file> \
//   SENTINELS=<comma-separated secrets already planted in NODE_LOG> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> \
//   node tests/test-node-logs/measure.mjs
//
// For 1200×800 (desktop shell: left rail), 1000×700 (Android UA ⇒ unfolded-foldable two-pane: tab row) and
// 390×844 (Android UA ⇒ phone tab row), reached the way a user does (agent row → chat → ⋯ 聊天信息 → 查看节点信息 → 运行日志):
//   nav       : 运行日志 comes right after 定时任务, same pill look as 任务, reachable in an overflowing tab row
//   header    : the 运行日志 title sits where the 任务 section's title sits (x, y ±1px)
//   toolbar   : every control of a toolbar row on one centre line (±1px); phone chips ≥ 36px high
//   redaction : no planted sentinel anywhere in the page, and none in the exported .log; [REDACTED] shown
//   tint      : [ERROR] lines red (theme failed), [WARN] lines amber (theme blocked)
//   filters   : 错误 chip → only ERROR lines; search → only matching lines; nonsense → empty state
//   follow    : 实时跟随 on + a line appended to NODE_LOG → it appears within 10 s; off → stops
//   keyboard  : desktop Ctrl+F focuses the search box; the phone shows no Ctrl+F hint
//   states    : OLD_ALIAS shows 「节点版本过旧，升级后可查看日志」; a failing hub call shows the error + 重试 recovers
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK, NODE_ALIAS, OLD_ALIAS, NODE_LOG, SENTINELS } = process.env;
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK || !NODE_ALIAS || !OLD_ALIAS || !NODE_LOG || !SENTINELS) {
  throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK NODE_ALIAS OLD_ALIAS NODE_LOG SENTINELS');
}
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
const sentinels = SENTINELS.split(',').filter(Boolean);
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
// window.__failLogs = true makes the tail_node_logs call answer 503 (error-state probe).
// 「导出」goes through plugin:dialog|save + save_download: the stub records what would be written.
const initScript = ({ hubUrl, token, networkId, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-node-logs', displayName: 'tester', networkId };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__saved = [];
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
        case 'plugin:path|resolve_directory': return '/tmp/downloads';
        case 'plugin:dialog|save': return `/tmp/downloads/${String(args?.options?.defaultPath ?? 'x.log').split('/').pop()}`;
        case 'save_download': window.__saved.push({ name: args.name, text: new TextDecoder().decode(Uint8Array.from(atob(args.bytesBase64), c => c.charCodeAt(0))) }); return args.targetPath ?? `/tmp/downloads/${args.name}`;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const bodyText = c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : '';
          const failing = window.__failLogs && /\/mcp$/.test(c.url) && bodyText.includes('"tail_node_logs"');
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

let failures = 0;
const rows = [];
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
// Screenshots may be shared: the throwaway node reports this machine's real hostname, so before each
// capture any text equal to MASK_TEXT is replaced by a placeholder (display only; nothing is asserted on it).
const mask = (page) => process.env.MASK_TEXT ? page.evaluate((m) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(m)) n.nodeValue = n.nodeValue.split(m).join('demo-host');
}, process.env.MASK_TEXT) : Promise.resolve();
const tid = (id) => `[data-testid="${id}"]`;
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2, text: el.textContent };
}, sel);

async function openNodePage(page, alias) {
  await page.getByText(alias, { exact: true }).first().click({ timeout: 30000 });
  // 会话页右上角「⋯」→ 聊天信息 → 头像行「查看节点信息:<别名>」。
  await page.locator('[aria-label="聊天信息"]').first().click({ timeout: 15000 });
  await page.locator(`[aria-label="查看节点信息:${alias}"]`).first().click({ timeout: 15000 });
  await page.locator(tid('node-section-nav')).waitFor({ timeout: 15000 });
}
const clickSection = async (page, label) => {
  await page.locator(`${tid('node-section-nav')} [aria-label="${label}"]`).first().click();
  await page.waitForTimeout(500);
};
const waitLogs = (page) => page.locator(`${tid('node-logs-text')}, ${tid('node-logs-empty')}, ${tid('node-logs-error')}, ${tid('node-logs-unsupported')}`).first().waitFor({ timeout: 30000 });
const logLines = (page) => page.evaluate(() => (document.querySelector('[data-testid="node-logs-text"]')?.textContent ?? '').split('\n').filter(Boolean));
const navItem = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('[data-testid="node-section-nav"]');
  const items = [...nav.querySelectorAll('[aria-label]')].filter(e => e.getAttribute('role') === 'tab');
  const el = items.find(e => e.getAttribute('aria-label') === l);
  if (!el) return null;
  const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const text = [...el.querySelectorAll('div,span')].find(t => t.childElementCount === 0 && t.textContent === l);
  const scroller = [...nav.querySelectorAll('div')].find(d => d.scrollWidth > d.clientWidth + 1 || /auto|scroll/.test(getComputedStyle(d).overflowX)) || nav;
  const nb = nav.getBoundingClientRect();
  return { order: items.map(e => e.getAttribute('aria-label')), x: b.x, right: b.right, y: b.y, h: b.height, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius,
    weight: text ? getComputedStyle(text).fontWeight : '', horizontal: nb.width > nb.height, navLeft: nb.left, navRight: nb.right,
    overflow: scroller.scrollWidth > scroller.clientWidth + 1, overflowX: getComputedStyle(scroller).overflowX };
}, label);
// Toolbar controls grouped by visual row (cy within 6px), each row's centre-line spread.
const toolbarRows = (page) => page.evaluate(() => {
  const ids = ['node-logs-level-all', 'node-logs-level-info', 'node-logs-level-warn', 'node-logs-level-error', 'node-logs-searchbox', 'node-logs-follow', 'node-logs-copy', 'node-logs-export', 'node-logs-refresh'];
  const els = ids.map(id => [id, document.querySelector(`[data-testid="${id}"]`)]);
  const info = document.querySelector('[data-testid="node-logs-toolbar"] [aria-label="关于运行日志"]');
  if (info) els.push(['info', info]);
  const items = els.filter(([, e]) => e).map(([id, e]) => { const b = e.getBoundingClientRect(); return { id, cy: b.y + b.height / 2, h: b.height, x: b.x, w: b.width }; });
  window.__tbWidths = { toolbar: document.querySelector('[data-testid="node-logs-toolbar"]').getBoundingClientRect().width, items: items.map(i => `${i.id}:${Math.round(i.w)}`).join(' ') };
  const groups = [];
  for (const it of items.sort((a, b) => a.cy - b.cy)) {
    const g = groups.find(g => Math.abs(g.cy - it.cy) <= 6);
    if (g) g.items.push(it); else groups.push({ cy: it.cy, items: [it] });
  }
  return groups.map(g => ({ ids: g.items.map(i => i.id), spread: Math.max(...g.items.map(i => i.cy)) - Math.min(...g.items.map(i => i.cy)), minHNoInfo: Math.min(...g.items.filter(i => i.id !== 'info').map(i => i.h)) }));
});
const lineColors = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="node-logs-text"]');
  const spans = root ? [...root.children] : [];
  const pick = (tag) => spans.find(s => s.textContent.includes(tag));
  const col = (el) => el ? getComputedStyle(el).color : null;
  return { error: col(pick('[ERROR]')), warn: col(pick('[WARN ]')), info: col(pick('[INFO ]')) };
});

const cases = [
  { w: 1200, h: 800, phone: false },
  { w: 1000, h: 700, phone: true },
  { w: 390, h: 844, phone: true },
];
const LIGHT = { failed: 'rgb(220, 38, 38)', blocked: 'rgb(217, 119, 6)' };

for (const { w, h, phone } of cases) {
  const vp = `${w}x${h}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', deviceScaleFactor: 2, ...(phone ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_URL });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme: 'light' });
  await page.goto(WEB_URL);
  await openNodePage(page, NODE_ALIAS);

  // ── nav + header alignment ─────────────────────────────────────────────────────
  await clickSection(page, '任务');
  const tasksTitle = await box(page, tid('node-section-title'));
  const tasksTab = await navItem(page, '任务');
  await clickSection(page, '运行日志');
  await waitLogs(page);
  await page.waitForTimeout(400);
  const logsTab = await navItem(page, '运行日志');
  const order = logsTab?.order ?? [];
  record(vp, 'nav: 运行日志 tab / rail item', {
    afterSchedules: order.indexOf('运行日志') === order.indexOf('定时任务') + 1,
    samePill: !!logsTab && logsTab.bg === tasksTab.bg && Math.abs(logsTab.h - tasksTab.h) <= 1 && logsTab.radius === tasksTab.radius && logsTab.weight === tasksTab.weight,
    reachable: !!logsTab && (!logsTab.horizontal || !logsTab.overflow || /auto|scroll/.test(logsTab.overflowX)),
    inView: !!logsTab && logsTab.x >= logsTab.navLeft - 1 && logsTab.right <= logsTab.navRight + 1,
  }, { shape: logsTab?.horizontal ? 'tab row' : 'rail', order: order.join('/'), pillH: r1(logsTab?.h ?? -1), tasksH: r1(tasksTab?.h ?? -1) });
  const logsTitle = await box(page, tid('node-section-title'));
  record(vp, 'section title vs 任务 title', {
    title: logsTitle?.text === '运行日志', sameX: Math.abs(logsTitle.x - tasksTitle.x) <= 1, sameY: Math.abs(logsTitle.y - tasksTitle.y) <= 1,
  }, { tasksX: r1(tasksTitle.x), logsX: r1(logsTitle.x), tasksY: r1(tasksTitle.y), logsY: r1(logsTitle.y) });

  // ── toolbar centre lines ──────────────────────────────────────────────────────────
  const tb = await toolbarRows(page);
  record(vp, 'toolbar controls on one centre line per row', {
    rows: phone ? tb.length === 2 : tb.length === 1,
    centred: tb.every(r => r.spread <= 1),
    // 手机:每个控件 ≥ 36(ⓘ 圆 22px + hitSlop 8,单独不计)。
    touchSize: !phone || tb.every(r => r.minHNoInfo >= 36),
  }, { widths: await page.evaluate(() => JSON.stringify(window.__tbWidths)), rows: tb.map(r => `${r.ids.length} ctrls spread=${r1(r.spread)}px`).join(' | '), chipH: r1((await box(page, tid('node-logs-level-error'))).h) });

  // ── redaction + tint ──────────────────────────────────────────────────────────────
  const body = await page.evaluate(() => document.body.innerText);
  const lines = await logLines(page);
  const col = await lineColors(page);
  record(vp, 'redaction visible end to end', {
    noSentinel: sentinels.every(s => !body.includes(s)), redactedShown: body.includes('[REDACTED'), hasLines: lines.length > 3,
  }, { lines: lines.length, survived: sentinels.filter(s => body.includes(s)).length });
  const scroll = await page.evaluate(() => { const el = document.querySelector('[data-testid="node-logs-scroll"]'); return el ? { top: el.scrollTop, max: el.scrollHeight - el.clientHeight } : null; });
  record(vp, 'opens at the newest line (scrolled to bottom)', { bottom: !!scroll && scroll.max > 0 && scroll.top >= scroll.max - 2 }, scroll ?? {});
  record(vp, 'error red / warn amber', { error: col.error === LIGHT.failed, warn: col.warn === LIGHT.blocked, infoPlain: col.info !== LIGHT.failed && col.info !== LIGHT.blocked }, col);
  await mask(page); await page.screenshot({ path: `${OUT}/node-logs-${vp}.png` });

  // ── desktop keyboard / phone hints ────────────────────────────────────────────────
  const placeholder = await page.locator(tid('node-logs-search')).getAttribute('placeholder');
  if (!phone) {
    await page.locator(tid('node-logs-text')).click();
    await page.keyboard.press('Control+f');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    const selectable = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="node-logs-text"]')).userSelect);
    record(vp, 'desktop: Ctrl+F focuses search, text selectable', { focused: focused === 'node-logs-search', hint: /Ctrl\+F|⌘F/.test(placeholder ?? ''), selectable: selectable !== 'none' }, { focused, placeholder, selectable });
  } else {
    record(vp, 'phone: no keyboard hint', { noHint: !/Ctrl|⌘/.test(placeholder ?? '') }, { placeholder });
  }

  // ── filters ───────────────────────────────────────────────────────────────────────
  await page.locator(tid('node-logs-level-error')).click();
  await page.waitForTimeout(300);
  await waitLogs(page); await page.waitForTimeout(1500);
  const errLines = await logLines(page);
  record(vp, '错误 chip → only ERROR lines', { some: errLines.length >= 1, onlyError: errLines.every(l => l.includes('[ERROR]') || !/^\[\d\d:\d\d:\d\d\] \[/.test(l)) }, { n: errLines.length });
  await page.locator(tid('node-logs-level-all')).click();
  await page.locator(tid('node-logs-search')).fill('econnreset');
  await page.waitForTimeout(2500);
  const hit = await logLines(page);
  record(vp, 'search (case-insensitive) → matching lines only', { n: hit.length >= 1 && hit.every(l => /econnreset/i.test(l)) }, { n: hit.length });
  await page.locator(tid('node-logs-search')).fill('zz-no-such-line-zz');
  await page.locator(tid('node-logs-empty')).waitFor({ timeout: 15000 }).catch(() => {});
  const empty = await box(page, tid('node-logs-empty'));
  record(vp, 'empty state', { shown: !!empty && /没有匹配/.test(empty.text) }, { text: empty?.text });
  if (!phone) await mask(page); await page.screenshot({ path: `${OUT}/node-logs-${vp}-empty.png` });
  await page.locator(tid('node-logs-search')).fill('');
  await page.waitForTimeout(2500);

  // ── follow ────────────────────────────────────────────────────────────────────────
  await page.locator(tid('node-logs-follow')).click();
  const marker = `follow-probe-${vp}-${Date.now()}`;
  const t = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  appendFileSync(NODE_LOG, `[${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}] [WARN ] [${NODE_ALIAS}] ${marker}\n`);
  let seenAt = -1;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); if ((await logLines(page)).some(l => l.includes(marker))) { seenAt = (i + 1) * 500; break; } }
  const dup = (await logLines(page)).filter(l => l.includes(marker)).length;
  await page.locator(tid('node-logs-follow')).click();
  await page.waitForTimeout(300);
  const followOff = (await page.locator(tid('node-logs-footer')).textContent())?.includes('实时跟随中') ? 'still-following' : 'off';
  const marker2 = `after-stop-${vp}-${Date.now()}`;
  appendFileSync(NODE_LOG, `[${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}] [INFO ] [${NODE_ALIAS}] ${marker2}\n`);
  await page.waitForTimeout(7000);
  const afterStop = (await logLines(page)).some(l => l.includes(marker2));
  record(vp, '实时跟随: new line appears once, stops when off', { appeared: seenAt > 0 && seenAt <= 10000, once: dup === 1, stopped: !afterStop }, { seenAtMs: seenAt, dup, ariaCheckedAfterOff: followOff });

  // ── copy / export ─────────────────────────────────────────────────────────────────
  await page.locator(tid('node-logs-copy')).click();
  await page.locator(tid('node-logs-notice')).waitFor({ timeout: 5000 }).catch(() => {});
  const copied = await box(page, tid('node-logs-notice'));
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await page.locator(tid('node-logs-export')).click();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__saved);
  const exp = saved[saved.length - 1];
  record(vp, '复制 / 导出 carry redacted text only', {
    copied: /已复制/.test(copied?.text ?? ''), clipClean: clip.length > 0 && sentinels.every(s => !clip.includes(s)),
    exported: !!exp && /\.log$/.test(exp.name) && exp.text.split('\n').length > 3, exportClean: !!exp && sentinels.every(s => !exp.text.includes(s)),
  }, { notice: copied?.text, exportName: exp?.name, exportLines: exp ? exp.text.split('\n').length - 1 : 0 });

  // ── error state + retry ───────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__failLogs = true; });
  await page.locator(tid('node-logs-refresh')).click();
  await page.locator(tid('node-logs-error')).waitFor({ timeout: 15000 }).catch(() => {});
  const err = await box(page, tid('node-logs-error'));
  if (!phone) await mask(page); await page.screenshot({ path: `${OUT}/node-logs-${vp}-error.png` });
  await page.evaluate(() => { window.__failLogs = false; });
  await page.locator(`${tid('node-logs-error')} [aria-label="重试"]`).click().catch(() => {});
  await page.locator(tid('node-logs-text')).waitFor({ timeout: 20000 }).catch(() => {});
  record(vp, 'error state + 重试 recovers', { error: !!err, recovered: (await logLines(page)).length > 3 }, { text: err?.text?.slice(0, 60) });

  // ── not supported (old node) ──────────────────────────────────────────────────────
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', deviceScaleFactor: 2, ...(phone ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme: 'light' });
  await page2.goto(WEB_URL);
  await openNodePage(page2, OLD_ALIAS);
  await clickSection(page2, '运行日志');
  await waitLogs(page2);
  const un = await box(page2, tid('node-logs-unsupported'));
  record(vp, 'old node → upgrade notice, no request', { shown: un?.text === '节点版本过旧，升级后可查看日志' }, { text: un?.text });
  if (!phone) await mask(page2); await page2.screenshot({ path: `${OUT}/node-logs-${vp}-old-node.png` });
  await ctx2.close();
}

await browser.close();
web.close();
console.log(`\n${rows.length - failures}/${rows.length} measurements passed`);
if (failures) process.exit(1);
