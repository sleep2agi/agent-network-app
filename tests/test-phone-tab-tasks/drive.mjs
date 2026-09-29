// Phone bottom tab 服务器 → 任务 (Vincent 2026-09-29) —— measured against a real hub, not by eye.
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself
// (never 127.0.0.1:9200), seeded with tests/test-task-board/seed.mjs (placeholder nodes demo-node-a/b/c).
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:<port> HUB_TOKEN=<utok_…> HUB_NETWORK=<net_…> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [MODE=after|before] node tests/test-phone-tab-tasks/drive.mjs
//
// phone 390×844 (Android UA ⇒ phone stack):
//   tabs     : exactly Agent / 任务 / 定时任务 / 设置; the four tabs have equal widths and evenly spaced centres (±1px);
//              each tab's icon centre x = label centre x (±1px)
//   任务     : tapping it renders the task page (list/board segments incl. 派发记录, requirement cards) with 任务 lit
//   设置→服务器: the 服务器 row is the first row of the list; tapping it renders the server page with no tab bar and a
//              back arrow; back returns to the 设置 list with the tab bar and 设置 lit
// foldable 1000×700 (Android UA ⇒ rail) and desktop 1200×800 (Tauri stub): screenshots plus the rail items (label +
//   box) written to OUT/<MODE>-rails.json. Run once with MODE=before on a main export and once with MODE=after;
//   the after run diffs against the before file when it exists and fails on any difference.
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
const MODE = process.env.MODE || 'after';
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
// Below 860px the app still picks the phone stack / Android two-pane from width + UA.
const initScript = ({ hubUrl, token, networkId }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-phone-tabs', displayName: 'tester', networkId };
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
  try { localStorage.setItem('theme_mode_v1', 'light'); } catch {}
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;

let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

async function newPage(vp, ua) {
  const ctx = await browser.newContext({ viewport: vp, userAgent: ua, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK });
  return { ctx, page };
}

// Tab geometry: each tab button, its icon (first child) and label (last child).
const tabGeometry = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-testid="mobile-tab-bar"]');
  if (!bar) return null;
  const barBox = bar.getBoundingClientRect();
  const tabs = [...bar.children].map(t => {
    const b = t.getBoundingClientRect();
    const kids = [...t.children];
    const icon = kids[0]?.getBoundingClientRect();
    const label = kids[kids.length - 1];
    const lb = label?.getBoundingClientRect();
    return { id: t.getAttribute('data-testid'), label: label?.textContent, x: b.x, w: b.width, cx: b.x + b.width / 2, iconCx: icon && icon.x + icon.width / 2, labelCx: lb && lb.x + lb.width / 2, labelColor: label && getComputedStyle(label).color };
  });
  return { bar: { x: barBox.x, w: barBox.width }, tabs };
});

const railItems = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map(e => {
  const b = e.getBoundingClientRect();
  return { label: e.getAttribute('aria-label'), x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
}), sel);

// ── phone 390×844 ──
{
  const vp = 'phone 390x844';
  const { ctx, page } = await newPage({ width: 390, height: 844 }, ANDROID_UA);
  await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);
  await page.locator(tid('mobile-tab-bar')).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator(tid('mobile-tab-bar')).screenshot({ path: join(OUT, `${MODE}-phone-tabbar.png`) });
  await page.screenshot({ path: join(OUT, `${MODE}-phone-agents.png`) });
  const g = await tabGeometry(page);
  const labels = g?.tabs.map(t => t.label) ?? [];
  if (MODE === 'before') {
    record(vp, 'tabs (before)', { found: !!g }, { labels });
  } else {
    const tabs = g.tabs;
    const widths = tabs.map(t => t.w);
    const gaps = tabs.slice(1).map((t, i) => t.cx - tabs[i].cx);
    const iconOff = tabs.map(t => r1(t.iconCx - t.labelCx));
    const tabCentreOff = tabs.map(t => r1(t.labelCx - t.cx));
    record(vp, 'tab labels', { order: JSON.stringify(labels) === JSON.stringify(['Agent', '任务', '定时任务', '设置']) }, { labels });
    record(vp, 'tabs evenly spaced', {
      equalWidths: Math.max(...widths) - Math.min(...widths) <= 1,
      equalSpacing: Math.max(...gaps) - Math.min(...gaps) <= 1,
      fillBar: Math.abs(widths.reduce((a, b) => a + b, 0) - g.bar.w) <= 1,
    }, { widths: widths.map(r1), centreGaps: gaps.map(r1), barWidth: r1(g.bar.w) });
    record(vp, 'icon/label centres', {
      iconOverLabel: iconOff.every(d => Math.abs(d) <= 1),
      labelInTab: tabCentreOff.every(d => Math.abs(d) <= 1),
    }, { iconMinusLabel: iconOff, labelMinusTab: tabCentreOff });

    // 任务
    await page.locator(tid('mobile-tab-tasks')).click();
    await page.locator(tid('tasks-view')).first().waitFor({ timeout: 20000 });
    await page.locator('[data-testid^="req-card-"], [data-testid^="req-row-"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `${MODE}-phone-tasks.png`) });
    const seg = await page.locator(tid('tasks-view')).first().innerText().catch(() => '');
    const items = await page.locator('[data-testid^="req-card-"], [data-testid^="req-row-"]').count();
    const g2 = await tabGeometry(page);
    const tasksTab = g2?.tabs.find(t => t.id === 'mobile-tab-tasks');
    const agentTab = g2?.tabs.find(t => t.id === 'mobile-tab-agents');
    record(vp, '任务 → task page', {
      segments: seg.includes('列表') && seg.includes('看板') && seg.includes('派发记录'),
      requirements: items > 0,
      tabBarStays: !!g2,
      tasksLit: !!tasksTab && !!agentTab && tasksTab.labelColor !== agentTab.labelColor,
    }, { segments: seg.replace(/\s+/g, ' '), items, tasksColor: tasksTab?.labelColor, agentColor: agentTab?.labelColor });
    // Board on the phone: one column per screen.
    await page.getByText('看板', { exact: true }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `${MODE}-phone-tasks-board.png`) });

    // 设置 → 服务器 → back
    await page.locator(tid('mobile-tab-settings')).click();
    await page.locator(tid('settings-phone-list')).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${MODE}-phone-settings.png`) });
    const rowsY = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="settings-row-"]')]
      .filter(e => /^settings-row-[a-zA-Z]+$/.test(e.getAttribute('data-testid')))
      .map(e => ({ id: e.getAttribute('data-testid'), y: e.getBoundingClientRect().y, text: e.textContent })));
    const first = [...rowsY].sort((a, b) => a.y - b.y)[0];
    record(vp, '设置 list', {
      serverRow: rowsY.some(r => r.id === 'settings-row-server'),
      serverFirst: first?.id === 'settings-row-server',
      placeholderHost: !!first?.text && first.text.includes('127.0.0.1'),
    }, { rows: rowsY.map(r => `${r.id}@${r.y | 0}`).join(' '), serverRowText: first?.text });
    await page.locator(tid('settings-row-server')).click();
    await page.locator(tid('server-header')).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${MODE}-phone-server.png`) });
    const back = await page.locator(`${tid('server-header')} ${tid('pane-back')}`).boundingBox();
    const title = await page.locator(tid('server-header')).getByText('服务器', { exact: true }).boundingBox();
    record(vp, '设置 → 服务器', {
      serverPage: await visible(page, tid('server-status-pill')),
      noTabBar: !(await visible(page, tid('mobile-tab-bar'))),
      backArrow: !!back,
      backBesideTitle: !!back && !!title && back.x + back.width <= title.x,
      backTouch: !!back && back.width >= 24 && back.height >= 24,
    }, { back: back && { x: r1(back.x), y: r1(back.y), w: r1(back.width), h: r1(back.height) }, title: title && { x: r1(title.x), y: r1(title.y) } });
    // server → 事件与日志 → back returns to the server page (existing leaf, unchanged).
    await page.locator(tid('server-action-logs')).click().catch(() => {});
    await page.locator(tid('logs-title')).waitFor({ timeout: 20000 }).catch(() => {});
    const logsOpen = await visible(page, tid('logs-title'));
    await page.locator(tid('pane-back')).first().click().catch(() => {});
    await page.locator(tid('server-header')).waitFor({ timeout: 20000 }).catch(() => {});
    record(vp, '服务器 → 事件流 → back', { logsOpen, backToServer: await visible(page, tid('server-header')) });
    await page.locator(`${tid('server-header')} ${tid('pane-back')}`).click();
    await page.locator(tid('settings-phone-list')).waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${MODE}-phone-settings-after-back.png`) });
    const g3 = await tabGeometry(page);
    const settingsTab = g3?.tabs.find(t => t.id === 'mobile-tab-settings');
    const agentTab3 = g3?.tabs.find(t => t.id === 'mobile-tab-agents');
    record(vp, '服务器 → back', {
      settingsList: await visible(page, tid('settings-phone-list')),
      tabBarBack: !!g3,
      settingsLit: !!settingsTab && !!agentTab3 && settingsTab.labelColor !== agentTab3.labelColor,
    });
  }
  await ctx.close();
}

// ── foldable 1000×700 (Android two-pane rail) and desktop 1200×800 (Tauri workspace) ──
const rails = {};
{
  const { ctx, page } = await newPage({ width: 1000, height: 700 }, ANDROID_UA);
  await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);
  await page.locator(tid('mobile-nav-rail')).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, `${MODE}-foldable-1000x700.png`) });
  rails.foldable = await railItems(page, '[data-testid^="nav-rail-"]:not([data-testid^="nav-rail-badge"])');
  record('foldable 1000x700', 'rail', {
    labels: JSON.stringify(rails.foldable.map(r => r.label.split('，')[0])) === JSON.stringify(['Agent', '任务', '定时任务', '服务器', '设置']),
    noBottomBar: !(await visible(page, tid('mobile-tab-bar'))),
  }, { rail: rails.foldable.map(r => r.label).join(' / ') });
  // The rail's 设置 has no 服务器 row (the rail already has 服务器).
  await page.locator(tid('nav-rail-settings')).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${MODE}-foldable-settings.png`) });
  record('foldable 1000x700', '设置 has no 服务器 row', { none: !(await visible(page, tid('settings-row-server'))) });
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ width: 1200, height: 800 }, MAC_UA);
  await page.goto(WEB_URL);
  await page.locator(tid('desktop-rail')).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, `${MODE}-desktop-1200x800.png`) });
  rails.desktop = await railItems(page, `${tid('desktop-rail')} [role="tab"]`);
  record('desktop 1200x800', 'rail', {
    labels: JSON.stringify(rails.desktop.map(r => r.label)) === JSON.stringify(['Agents', 'Tasks', '定时', 'Messages', '服务器设置', '设置']),
    noBottomBar: !(await visible(page, tid('mobile-tab-bar'))),
  }, { rail: rails.desktop.map(r => r.label).join(' / ') });
  await ctx.close();
}
writeFileSync(join(OUT, `${MODE}-rails.json`), JSON.stringify(rails, null, 2));
if (MODE === 'after' && existsSync(join(OUT, 'before-rails.json'))) {
  const before = JSON.parse(readFileSync(join(OUT, 'before-rails.json'), 'utf8'));
  for (const k of ['foldable', 'desktop']) {
    record(k, 'rail identical to main (labels + boxes)', { same: JSON.stringify(before[k]) === JSON.stringify(rails[k]) }, { items: rails[k].length });
  }
}

await browser.close();
web.close();
console.log(failures ? `${failures} check group(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
