// #429 「任务」tab 的未读角标:别人改过的任务数,手机底栏 / 安卓左栏 / 桌面左栏各画一份。量真框,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs — no hub process, no port, no HOME touched.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-unread-badge/drive.mjs
//
// Fixture: lastSeen (localStorage task_unread_seen_v1) = an hour ago; after it, 3 cards changed by others (a user, a
// node), 1 by me, 1 archived by someone else; before it, 1 by someone else. Expect 3. The 99+ case adds 120 more.
// Per surface × theme (light, dark):
//   count     badge text = 3 (99+ case: 「99+」)
//   glyph     badge covers ≤ 40% of the tab icon (badge-anchor.ts MIN_ICON_VISIBLE)
//   outward   one digit: its left edge is right of the icon's centre (it grows outward, not over the glyph)
//   label     phone / rail: the badge does not touch the tab label
//   window    the badge is fully inside the viewport
//   painted   no overflow-hidden ancestor (the rail's ScrollView) clips any of it
//   noTextHit it touches no other text in the nav — e.g. the label of the tab above (Android rail, 99+)
//   tooltip   desktop: hovering 任务 shows 「任务 · 3 个任务有新动态」 on one line, not clipped
//   seen      tap 任务 → badge gone; back to Agent → still gone; lastSeen in localStorage moved to the newest card time
// Exit 1 when any check fails or a surface could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const SEEN_KEY = 'task_unread_seen_v1';
// Runs in the page before the app: the board + lastSeen for the sweep profile (harness: p-sweep / net-sweep).
const seed = ({ many, density }) => {
  if (density) try { localStorage.setItem('ui_scale_v1', JSON.stringify({ font: null, density })); } catch {}
  const now = Date.now();
  const at = (min) => new Date(now + min * 60000).toISOString();
  const seen = at(-60);
  try { if (!localStorage.getItem('task_unread_seen_v1')) localStorage.setItem('task_unread_seen_v1', JSON.stringify({ 'p-sweep|net-sweep': seen })); } catch {}
  const R = (id, name, min, by, o) => ({ id, name, priority: 'normal', assignee: '', column: 'doing', owner: null, participants: [], agent_owner: null, due: '', createdAt: at(-600), updatedAt: at(min), updated_by: by, description: '', checklist: [], tags: [], parent_id: null, ...o });
  const other = { kind: 'user', id: 'u_other' };
  const requirements = [
    R('t1', '示例任务一', -5, other),
    R('t2', '示例任务二', -20, { kind: 'node', id: 'n_sweep_b' }),
    R('t3', '示例任务三', -40, other, { column: 'done' }),
    R('t4', '示例任务四(我改的)', -3, { kind: 'user', id: 'u_tester' }),
    R('t5', '示例任务五(一小时前)', -90, other),
  ];
  if (many) for (let i = 0; i < 120; i++) requirements.push(R(`m${i}`, `示例批量任务 ${i}`, -30 - i / 10, other));
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements,
    archived: [R('t6', '示例任务六(归档)', -10, other, { archived: true })],
    projects: [],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }, { kind: 'user', id: 'u_other', networkId: 'net-sweep', name: '示例同事' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'tags', 'list_summary', 'changes'],
  };
  window.__seedNewest = at(-3);
};

const SURFACES = {
  // phone: bottom tab bar
  phone: { w: 390, h: 844, ua: ANDROID_UA, tab: '[data-testid="mobile-tab-tasks"]', badge: '[data-testid="mobile-tab-badge-tasks"]', agents: '[data-testid="mobile-tab-agents"]' },
  // Android unfolded / landscape: left rail with labels. Wide screens default to 更紧凑 (items abut, 44 dp pitch).
  rail: { w: 1200, h: 850, ua: ANDROID_UA, tab: '[data-testid="nav-rail-tasks"]', badge: '[data-testid="nav-rail-badge-tasks"]', agents: '[data-testid="nav-rail-agents"]' },
  // the same rail at 标准 density (56 dp items with a gap)
  'rail-standard': { w: 1200, h: 850, ua: ANDROID_UA, density: 'standard', tab: '[data-testid="nav-rail-tasks"]', badge: '[data-testid="nav-rail-badge-tasks"]', agents: '[data-testid="nav-rail-agents"]' },
  // desktop (Tauri stub, mouse): icon rail + hover tooltip
  desktop: { w: 1440, h: 900, ua: undefined, tab: '[data-testid="desktop-rail"] [aria-label^="任务"]', badge: '[data-testid="desktop-rail-badge-tasks"]', agents: '[data-testid="desktop-rail"] [aria-label="Agent"]' },
};

const rows = [];
let failures = 0;
const r1 = (n) => Math.round(n * 10) / 10;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}

// The badge, the icon glyph it annotates (the badge's previous sibling), and the tab label if any.
const geometry = (sel) => {
  const badge = document.querySelector(sel);
  if (!badge) return null;
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const glyph = badge.previousElementSibling;
  // the label: the first text in the tab that is not inside the badge
  let tab = badge.parentElement;
  while (tab && tab.getAttribute('role') !== 'tab' && tab.getAttribute('aria-selected') === null && !tab.getAttribute('data-testid')?.startsWith('mobile-tab-') && !tab.getAttribute('data-testid')?.startsWith('nav-rail-')) tab = tab.parentElement;
  const label = tab ? [...tab.querySelectorAll('div,span')].find(e => !badge.contains(e) && !e.children.length && e.textContent.trim() && e !== glyph && !glyph?.contains(e) && getComputedStyle(e).fontFamily.indexOf('ionicons') < 0) : null;
  // painted = the badge box clipped by every overflow-hidden ancestor (a ScrollView clips; the viewport alone does not)
  const b = badge.getBoundingClientRect();
  let vis = { l: b.left, t: b.top, r: b.right, btm: b.bottom };
  for (let a = badge.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = a.getBoundingClientRect();
    vis = { l: Math.max(vis.l, r.left), t: Math.max(vis.t, r.top), r: Math.min(vis.r, r.right), btm: Math.min(vis.btm, r.bottom) };
  }
  const paintedShare = Math.max(0, vis.r - vis.l) * Math.max(0, vis.btm - vis.t) / (b.width * b.height);
  // any other text in the whole nav (rail / tab bar) the badge touches — e.g. the label of the tab above it
  const nav = badge.closest('[data-testid="mobile-nav-rail"],[data-testid="mobile-tab-bar"],[data-testid="desktop-rail"]');
  const hits = [];
  for (const e of nav ? nav.querySelectorAll('div,span') : []) {
    if (badge.contains(e) || e.contains(badge) || e.children.length || !e.textContent.trim()) continue;
    if (getComputedStyle(e).fontFamily.toLowerCase().includes('ionicons')) continue;
    const r = e.getBoundingClientRect();
    const w = Math.min(r.right, b.right) - Math.max(r.left, b.left), h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
    if (w > 0.5 && h > 0.5) hits.push(`${e.textContent.trim().slice(0, 12)} ${Math.round(w)}×${Math.round(h)}`);
  }
  return { badge: rect(badge), text: badge.textContent, glyph: glyph ? rect(glyph) : null, label: label ? rect(label) : null, vw: innerWidth, vh: innerHeight, paintedShare, hits };
};
const inter = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; };

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, S] of Object.entries(SURFACES)) {
  for (const theme of ['light', 'dark']) {
    for (const many of [false, true]) {
      if (many && theme === 'dark') continue;
      if (name === 'rail-standard' && theme === 'dark') continue;
      const where = `${name}/${theme}${many ? '/99+' : ''}`;
      const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, ...(S.ua ? { userAgent: S.ua } : {}), colorScheme: theme, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
      try {
        await page.addInitScript(initScript, { theme });
        await page.addInitScript(seed, { many, density: S.density ?? null });
        await page.goto(web.url);
        // signed in → lands on Agent (the badge shows on every screen but 任务)
        await page.locator(S.badge).waitFor({ timeout: 20000 });
        await page.waitForTimeout(400);
        const g = await page.evaluate(geometry, S.badge);
        const covered = g.glyph ? inter(g.glyph, g.badge) / (g.glyph.w * g.glyph.h) : 1;
        record(where, 'badge', {
          count: g.text === (many ? '99+' : '3'),
          glyph: !!g.glyph && covered <= 0.4,
          // a one-digit badge sits outward of the glyph's centre; 「99+」 on the rail is pulled left by the rail edge (clampBadge)
          outward: many || (!!g.glyph && g.badge.x > g.glyph.x + g.glyph.w / 2),
          label: !g.label || inter(g.label, g.badge) === 0,
          window: g.badge.x >= 0 && g.badge.y >= 0 && g.badge.x + g.badge.w <= g.vw && g.badge.y + g.badge.h <= g.vh,
          painted: g.paintedShare >= 0.999,
          noTextHit: g.hits.length === 0,
        }, { text: g.text, painted: `${Math.round(g.paintedShare * 100)}%`, hits: g.hits.join('|') || '-', badge: `${r1(g.badge.w)}×${r1(g.badge.h)}`, covered: `${Math.round(covered * 100)}%`, labelGap: g.label ? r1(g.label.y - (g.badge.y + g.badge.h)) : '-' });

        if (name === 'desktop') {
          await page.locator(S.tab).first().hover();
          const tip = page.getByText(/个任务有新动态/).first();
          await tip.waitFor({ timeout: 5000 });
          const tb = await tip.evaluate(el => { const b = el.getBoundingClientRect(); return { h: b.height, w: b.width, sw: el.scrollWidth, cw: el.clientWidth, text: el.textContent }; });
          record(where, 'tooltip', { text: tb.text === `任务 · ${many ? '99+' : '3'} 个任务有新动态`, oneLine: tb.h < 24, notClipped: tb.sw <= tb.cw + 1 }, { text: tb.text, h: r1(tb.h) });
        }
        if (OUT) {
          const clipW = name === 'phone' ? S.w : Math.min(S.w, 520);
          await page.screenshot({ path: `${OUT}/${name}-badge-${theme}${many ? '-99' : ''}.png`, ...(name === 'phone' ? {} : { clip: { x: 0, y: 0, width: clipW, height: Math.min(S.h, 420) } }) });
          if (name !== 'phone') await page.screenshot({ path: `${OUT}/${name}-full-${theme}${many ? '-99' : ''}.png` });
        }
        await page.mouse.move(S.w - 5, S.h - 5);

        if (!many && theme === 'light') {
          // open 任务 → badge gone; back to Agent → still gone; lastSeen moved up to the newest card
          const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}')['p-sweep|net-sweep'], SEEN_KEY);
          await page.locator(S.tab).first().click();
          await page.getByText('示例任务一', { exact: true }).first().waitFor({ timeout: 15000 });
          await page.waitForTimeout(800);
          const onTasks = await page.locator(S.badge).count();
          await page.locator(S.agents).first().click();
          await page.waitForTimeout(800);
          const after = await page.locator(S.badge).count();
          const seen = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}')['p-sweep|net-sweep'], SEEN_KEY);
          const newest = await page.evaluate(() => window.__seedNewest);
          record(where, 'seen', { goneOnTasks: onTasks === 0, goneAfter: after === 0, lastSeenMoved: seen !== before && Date.parse(seen) === Date.parse(newest) }, { before, seen });
        }
      } catch (err) {
        record(where, 'NOT RUN', { ran: false }, { error: String(err.message || err).split('\n')[0].slice(0, 120) });
      }
      if (errors.length) record(where, 'pageerror', { none: false }, { error: errors[0].slice(0, 120) });
      await ctx.close();
    }
  }
}
await browser.close(); web.close();
console.log(`\n${rows.length} rows, ${failures} failing`);
if (!rows.length) { console.error('nothing ran — refusing to pass'); process.exit(1); }
process.exit(failures ? 1 : 0);
