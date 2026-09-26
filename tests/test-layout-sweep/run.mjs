// App-wide layout sweep: safe-area insets + header alignment, measured in the web export with a
// simulated Android edge-to-edge safe area (src/safe-area-sim.ts). Owner 2026-09-26:
// 「怎么会有这么多乱七八糟的体验感的问题」— he was the test for #387 (rules fullscreen under the
// clock), the 新建定时任务 header under the clock, the 节点信息 double inset in the two-pane and
// the composer row (#424). This walks every screen and modal we can reach and asserts:
//
//   (a) band    no interactive element (and no header title) intersects the status-bar band
//               [0, insetTop) of its window
//   (b) gap     header.top − insetTop ≤ 8 (catches a second inset: the first one is the band)
//   (c) centre  the header's items (back / title / actions) share one centre line, ±1px
//   (d) pads    left and right padding of the header match, ±1px (visual edge gaps when an item
//               is pinned to each edge, else the CSS padding)
//   (e) panes   two-pane only: the right pane's header top == the list pane's first element top, ±1px
//
// Simulated insets: phone 390×844 top 32 / bottom 24; two-pane 1200×850 (landscape) top 32 /
// bottom 24 / left 40. Light theme, Android UA. Hub data is placeholder, served in-page by the
// Tauri stub in harness.mjs — no hub process, no port, no HOME touched.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [TAG=before|after] [ONLY=<case,...>] \
//   [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-layout-sweep/run.mjs
//
// Build the export first:  npx expo export --platform web --output-dir <dir>
// Exit 1 when any check fails or any case could not be opened (a case that never ran is a FAIL,
// not a skip — "0 failures" over fewer cases reads the same as a real pass).
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from './harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
const TAG = process.env.TAG || 'run';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
if (OUT) mkdirSync(OUT, { recursive: true });

const LAYOUTS = {
  phone: { w: 390, h: 844, insets: { top: 32, right: 0, bottom: 24, left: 0 } },
  twoPane: { w: 1200, h: 850, insets: { top: 32, right: 0, bottom: 24, left: 40 } },
};

const go = (screen) => async (page) => {
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 15000 });
  await page.evaluate((s) => window.__anetLayoutSweep.setScreen(s), screen);
};
const chat = async (page) => { await go({ name: 'chat', alias: '示例-A' })(page); await page.locator('[data-testid="chat-header"]').waitFor({ timeout: 10000 }); };
const openMessageMenu = async (page) => {
  await chat(page);
  const bubble = page.getByText('示例回复:构建通过。', { exact: true }).first();
  await bubble.waitFor({ timeout: 10000 });
  await bubble.click({ button: 'right' }).catch(() => {});
  if (!(await page.locator('[aria-modal="true"]').count())) await bubble.click({ delay: 700 });
};

// scope: 'main' (window) | 'modal' (topmost RN-web Modal). pane: 'detail' | 'list' (two-pane).
// header: selector inside the scope; null = no header bar (dialog / sheet): only (a) applies.
const CASES = [
  { name: 'agents', layouts: ['phone', 'twoPane'], open: go({ name: 'agents' }), scope: 'main', pane: 'list', header: '[data-testid="agents-list-head"]' },
  { name: 'chat', layouts: ['phone', 'twoPane'], open: chat, scope: 'main', pane: 'detail', header: '[data-testid="chat-header"]' },
  { name: 'nodeInfo', layouts: ['phone', 'twoPane'], open: go({ name: 'nodeInfo', alias: '示例-A' }), scope: 'main', pane: 'detail', header: '[data-testid="screen-header"]' },
  { name: 'nodeDetail', layouts: ['phone', 'twoPane'], open: go({ name: 'nodeDetail', alias: '示例-A' }), scope: 'main', pane: 'detail', header: '[data-testid="screen-header"]' },
  { name: 'scheduled', layouts: ['phone', 'twoPane'], open: go({ name: 'scheduled' }), scope: 'main', header: '[data-testid="screen-header"]' },
  // The server page's title row scrolls with its content, below the content padding (spacing.lg /
  // xl) — declared slack for (b). A second inset would still add 32 on top of it.
  { name: 'server', layouts: ['phone', 'twoPane'], open: go({ name: 'server' }), scope: 'main', header: '[data-testid="server-header"]', slack: 16 },
  { name: 'logs', layouts: ['phone', 'twoPane'], open: go({ name: 'logs' }), scope: 'main', header: '[data-testid="screen-header"]' },
  { name: 'taskDetail', layouts: ['phone', 'twoPane'], open: go({ name: 'taskDetail', taskId: 't_sweep_1' }), scope: 'main', header: '[data-testid="screen-header"]' },
  { name: 'picker', layouts: ['phone', 'twoPane'], open: go({ name: 'picker' }), scope: 'main', header: '[data-testid="screen-header"]' },
  { name: 'wizard', layouts: ['phone', 'twoPane'], open: go({ name: 'wizard', daemon: { daemon_node_id: 'd_sweep_1', alias: '示例-守护', online: true, runtimes_supported: ['claude-code'], can_create_nodes: true } }), scope: 'main', header: '[data-testid="screen-header"]' },
  { name: 'settings', layouts: ['phone', 'twoPane'], open: go({ name: 'settings' }), scope: 'main', header: null },
  { name: 'tasks', layouts: ['phone'], open: go({ name: 'tasks' }), scope: 'main', header: null },
  { name: 'messages', layouts: ['phone'], open: go({ name: 'messages' }), scope: 'main', header: null },
  // ── modals (separate native windows under edge-to-edge) ──
  { name: 'modal:scheduleForm', layouts: ['phone', 'twoPane'], scope: 'modal', header: '[data-testid="schedule-form-header"]',
    open: async (page) => { await go({ name: 'scheduled' })(page); await page.getByText('新建', { exact: true }).first().click({ timeout: 10000 }); } },
  // #429's node picker: a bottom sheet over the form (overlay — top 0 by design, sides/bottom inset)
  { name: 'modal:nodePicker', layouts: ['phone', 'twoPane'], scope: 'modal', header: null,
    open: async (page) => { await go({ name: 'scheduled' })(page); await page.getByText('新建', { exact: true }).first().click({ timeout: 10000 }); await page.locator('[data-testid="schedule-target-field"]').click({ timeout: 5000 }); await page.locator('[data-testid^="picker-"]').first().waitFor({ timeout: 5000 }); } },
  { name: 'modal:filesTreeDrawer', layouts: ['twoPane'], scope: 'modal', header: '[data-testid="screen-header"]',
    open: async (page) => {
      await go({ name: 'nodeDetail', alias: '示例-A' })(page);
      await page.getByText('项目文件夹', { exact: true }).first().click({ timeout: 10000 });
      await page.locator('[data-testid="node-files-tree-toggle"]').click({ timeout: 10000 });
      await page.locator('[data-testid="node-files-tree-drawer"]').waitFor({ timeout: 5000 });
    } },
  { name: 'modal:composerEditor', layouts: ['phone', 'twoPane'], scope: 'modal', header: '[data-testid="screen-header"]',
    open: async (page) => {
      await chat(page);
      const input = page.locator('textarea').first();
      await input.fill('第一行\n第二行\n第三行\n第四行\n第五行');
      await page.locator('[data-testid="composer-expand"]').click({ timeout: 5000 });
      await page.locator('[data-testid="composer-fullscreen-editor"]').waitFor({ timeout: 5000 });
    } },
  // #430's long-press menu: a floating anchored menu — the insets only clamp where it lands.
  // Pressed on the first row (the one nearest the status bar) so the clamp is what keeps it out.
  { name: 'modal:agentRowMenu', layouts: ['phone', 'twoPane'], scope: 'modal', header: null,
    open: async (page) => {
      const row = page.getByText('示例-11', { exact: true }).first();
      await row.waitFor({ timeout: 10000 });
      const b = await row.boundingBox();
      await page.mouse.move(b.x + 4, b.y + 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
      await page.locator('[data-testid="agent-row-menu"]').waitFor({ timeout: 5000 });
    } },
  { name: 'modal:messageMenu', layouts: ['phone'], scope: 'modal', header: null, open: openMessageMenu },
  { name: 'modal:selectText', layouts: ['phone', 'twoPane'], scope: 'modal', header: '[data-testid="screen-header"]',
    open: async (page) => {
      await openMessageMenu(page);
      await page.getByText('选择文本', { exact: true }).last().click({ timeout: 5000 });
      await page.getByText('拖动选区手柄选中任意段落，用系统菜单复制').waitFor({ timeout: 5000 });
    } },
  { name: 'modal:nodeAction', layouts: ['phone', 'twoPane'], scope: 'modal', header: null,
    open: async (page) => {
      await go({ name: 'nodeDetail', alias: '示例-A' })(page);
      await page.getByText('危险操作', { exact: true }).first().click({ timeout: 10000 });
      await page.getByText('重启节点', { exact: true }).first().click({ timeout: 10000 });
      await page.getByText('重启节点？').waitFor({ timeout: 5000 });
    } },
  { name: 'modal:rulesFullscreen', layouts: ['phone', 'twoPane'], scope: 'modal', header: '[data-testid="screen-header"]',
    open: async (page) => {
      await go({ name: 'nodeDetail', alias: '示例-A' })(page);
      await page.getByText('规则文件', { exact: true }).first().click({ timeout: 10000 });
      await page.getByLabel('全屏阅读规则文件').first().click({ timeout: 15000 });
      await page.getByText(/退出全屏/).first().waitFor({ timeout: 5000 });
    } },
];

// ── in-page measurement ─────────────────────────────────────────────────────────────────────
const measure = ({ scope, pane, header, inset }) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const box = (r) => ({ x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cy: r.top + r.height / 2 });
  const modals = [...document.querySelectorAll('[aria-modal="true"]')].filter(vis);
  let root = document.body;
  if (scope === 'modal') { root = modals[modals.length - 1]; if (!root) return { error: 'no modal open' }; }
  else if (modals.length) return { error: 'unexpected modal open' };
  let paneEl = null;
  if (pane && scope === 'main') paneEl = document.querySelector(`[data-testid="two-pane-${pane}"]`);
  const within = paneEl || root;
  const INTERACTIVE = 'button,a[href],input,textarea,select,[role="button"],[role="menuitem"],[role="menu"],[role="tab"],[role="link"],[role="switch"],[role="checkbox"],[tabindex]:not([tabindex="-1"])';
  const interactive = [...within.querySelectorAll(INTERACTIVE)].filter(vis);
  const hdr = header ? [...within.querySelectorAll(header)].filter(vis)[0] : null;
  // (a) status-bar band
  const inBand = [];
  // a tap-outside-to-close backdrop spans the window top to bottom and dims the status bar too —
  // it is not a control anyone aims at, so it is not held to the band
  const backdrop = (r) => r.top <= 1 && r.bottom >= innerHeight - 1 && r.width >= innerWidth * 0.3;
  for (const el of interactive) { const r = el.getBoundingClientRect(); if (backdrop(r)) continue; if (r.top < inset.top - 0.5 && r.bottom > 0) inBand.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 16)}@${Math.round(r.top)}`); }
  const out = { inBand, interactiveCount: interactive.length };
  if (header && !hdr) return { ...out, error: `header ${header} not found` };
  if (!hdr) return out;
  const H = box(hdr.getBoundingClientRect());
  out.headerTop = H.y;
  // header row = the header itself if it lays out in a row, else its first row descendant with ≥2 visible children
  const isRow = (el) => getComputedStyle(el).flexDirection === 'row' && [...el.children].filter(vis).length >= 2;
  let row = isRow(hdr) ? hdr : [...hdr.querySelectorAll('*')].find(el => vis(el) && isRow(el));
  if (!row) row = hdr;
  const R = box(row.getBoundingClientRect());
  const rcs = getComputedStyle(row);
  // visual box of one flex item: its own box if it paints (bg / border), else the union of its ink (text, svg, img, inputs)
  const paints = (el) => { const cs = getComputedStyle(el); const bg = cs.backgroundColor; return (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) || parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0; };
  const ink = (el) => {
    if (paints(el) || el.matches('input,textarea,img,svg')) return el.getBoundingClientRect();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    const add = (q) => { if (q.width <= 0 || q.height <= 0) return; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { if (!n.textContent.trim()) continue; if (!vis(n.parentElement)) continue; const rg = document.createRange(); rg.selectNodeContents(n); add(rg.getBoundingClientRect()); }
    for (const e of el.querySelectorAll('img,svg,input,textarea')) if (vis(e)) add(e.getBoundingClientRect());
    for (const e of el.querySelectorAll('*')) if (vis(e) && paints(e)) add(e.getBoundingClientRect());
    return l === Infinity ? null : { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  };
  const items = [...row.children].filter(vis).map(el => ({ el, v: ink(el) })).filter(it => it.v);
  const titleText = [...hdr.querySelectorAll('*')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !e.closest(INTERACTIVE)).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
  if (titleText) { const tr = titleText.getBoundingClientRect(); out.titleCy = tr.top + tr.height / 2; if (tr.top < inset.top - 0.5) inBand.push(`title@${Math.round(tr.top)}`); }
  const cys = items.map(it => it.v.top + it.v.height / 2);
  const sorted = [...cys].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
  out.centre = { items: items.length, dev: items.length ? Math.max(...cys.map(c => Math.abs(c - med))) : 0, labels: items.map((it, i) => `${(it.el.getAttribute('aria-label') || it.el.textContent || '').trim().slice(0, 6) || it.el.tagName.toLowerCase()}:${(cys[i] - med).toFixed(1)}`) };
  // Gaps are measured from the header box (the tagged element), so a wrapper's padding counts.
  // An icon button (glyph centred in a larger touch box) is measured by its box — the box is the
  // symmetric thing; text buttons / titles by their ink (取消 left-aligned in a 40px box reads as
  // 28px from the edge, not 16).
  const edgeBox = (it) => {
    const b = it.el.getBoundingClientRect();
    const centred = Math.abs((it.v.left + it.v.right) / 2 - (b.left + b.right) / 2) <= 1 && it.v.width < b.width;
    return centred ? b : it.v;
  };
  const padL = parseFloat(rcs.paddingLeft) + (row === hdr ? 0 : row.getBoundingClientRect().left - H.x);
  const padR = parseFloat(rcs.paddingRight) + (row === hdr ? 0 : H.r - row.getBoundingClientRect().right);
  let mode = 'css', gapL = padL, gapR = padR;
  if (items.length) {
    const first = edgeBox(items[0]), last = edgeBox(items[items.length - 1]);
    const lastPinned = H.r - last.right <= padR + 24; // something sits at the right edge
    if (lastPinned) { mode = 'visual'; gapL = first.left - H.x; gapR = H.r - last.right; }
  }
  out.pads = { mode, gapL, gapR };
  return out;
};

const listFirstTop = () => {
  const list = document.querySelector('[data-testid="two-pane-list"]');
  const head = list?.querySelector('[data-testid="agents-list-head"]');
  if (!head) return null;
  // the search box when the list shows one (> 10 agents), else the head row
  const search = head.querySelector('input');
  const sb = search ? search.parentElement.getBoundingClientRect() : null;
  return { head: head.getBoundingClientRect().top, search: sb ? sb.top : null, searchCy: sb ? sb.top + sb.height / 2 : null };
};

// ── run ──────────────────────────────────────────────────────────────────────────────────────
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const rows = [];
for (const c of CASES) {
  if (ONLY.length && !ONLY.includes(c.name)) continue;
  for (const L of c.layouts) {
    const lay = LAYOUTS[L];
    const ins = lay.insets;
    const row = { case: c.name, layout: L, a: 'FAIL', b: '-', c: '-', d: '-', e: '-', note: '' };
    const ctx = await browser.newContext({ viewport: { width: lay.w, height: lay.h }, userAgent: ANDROID_UA, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    try {
      await page.addInitScript(initScript, { theme: 'light' });
      await page.goto(`${web.url}?safeAreaSim=${ins.top},${ins.right},${ins.bottom},${ins.left}`);
      await page.getByText('示例-A', { exact: true }).first().waitFor({ timeout: 20000 });
      await c.open(page);
      await page.waitForTimeout(600);
      const m = await page.evaluate(measure, { scope: c.scope, pane: L === 'twoPane' ? c.pane : null, header: c.header, inset: ins });
      if (m.error) throw new Error(m.error);
      row.a = m.inBand.length ? 'FAIL' : 'PASS';
      if (m.inBand.length) row.note += `band:${m.inBand.slice(0, 3).join('|')} `;
      if (c.header) {
        const gap = m.headerTop - ins.top;
        row.b = gap <= 8 + (c.slack || 0) ? 'PASS' : 'FAIL';
        row.c = m.centre.dev <= 1 ? 'PASS' : 'FAIL';
        row.d = Math.abs(m.pads.gapL - m.pads.gapR) <= 1 ? 'PASS' : 'FAIL';
        row.note += `top=${m.headerTop.toFixed(1)} gap=${gap.toFixed(1)} cy±${m.centre.dev.toFixed(1)} pad(${m.pads.mode})=${m.pads.gapL.toFixed(1)}/${m.pads.gapR.toFixed(1)} `;
        if (row.c === 'FAIL') row.note += `[${m.centre.labels.join(' ')}] `;
        if (L === 'twoPane' && c.pane === 'detail') {
          const lt = await page.evaluate(listFirstTop);
          const ref = lt?.head;
          if (ref == null) { row.e = 'FAIL'; row.note += 'list head missing '; }
          else { row.e = Math.abs(m.headerTop - ref) <= 1 ? 'PASS' : 'FAIL'; row.note += `listTop=${ref.toFixed(1)}${lt.search != null ? ` searchTop=${lt.search.toFixed(1)}` : ''}${lt.searchCy != null && m.titleCy != null ? ` (info: title cy − search cy = ${(m.titleCy - lt.searchCy).toFixed(1)})` : ''} `; }
        }
      }
    } catch (err) {
      row.note += `NOT RUN: ${String(err.message || err).split('\n')[0].slice(0, 90)}`;
      row.a = row.a === 'PASS' ? 'PASS' : 'FAIL';
    }
    if (errors.length) row.note += ` pageerror:${errors[0].slice(0, 60)}`;
    if (OUT) {
      // shade the simulated system bars so the screenshot shows what the phone would cover
      await page.evaluate((ins) => {
        const add = (css) => { const d = document.createElement('div'); d.className = '__sweep_band'; d.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;background:rgba(220,38,38,0.28);${css}`; document.body.appendChild(d); };
        add(`left:0;right:0;top:0;height:${ins.top}px;border-bottom:1px solid rgba(220,38,38,0.9)`);
        if (ins.bottom) add(`left:0;right:0;bottom:0;height:${ins.bottom}px`);
        if (ins.left) add(`left:0;top:0;bottom:0;width:${ins.left}px`);
      }, ins).catch(() => {});
      await page.screenshot({ path: `${OUT}/sweep-${c.name.replace(':', '-')}-${L}-${TAG}.png` }).catch(() => {});
    }
    rows.push(row);
    await ctx.close();
  }
}
await browser.close(); web.close();

const cols = ['case', 'layout', 'a', 'b', 'c', 'd', 'e', 'note'];
console.log(`\n| ${['case', 'layout', '(a) band', '(b) gap', '(c) centre', '(d) pads', '(e) panes', 'measured'].join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${cols.map(k => r[k]).join(' | ')} |`);
const failing = rows.filter(r => ['a', 'b', 'c', 'd', 'e'].some(k => r[k] === 'FAIL'));
console.log(`\n${TAG}: ${rows.length} screen×layout rows, ${failing.length} failing`);
if (!rows.length) { console.error('no case ran (ONLY filter matched nothing?) — refusing to pass'); process.exit(1); }
process.exit(failing.length ? 1 : 0);
