// 任务列表在平板横屏 / 桌面窄窗口(900–1100 宽)—— 在 web 导出里量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-list-tablet/drive.mjs
//
// Tablet 900 / 1000 / 1100 × 700 (Android UA, touch) and desktop 1000×700 / 1320×754 (mouse), light + dark:
//   status    : the 状态 column header lies inside the visible part of the table (not pushed off the right edge)
//   centred   : a row's title sits on the same centre line as its owner cell ±1.5 (the title is not pinned to the row top)
//   untitled  : a row whose name is only zero-width characters shows 「（无标题）· <id tail>」 instead of an empty title,
//               painted ≥ 40px wide (not only present in textContent)
//   overflow  : no horizontal page scroll
// Phone 390×844: the untitled task's card shows the same fallback.
// Tablet 1000×700 with the #563 ID column (requirement_seq hub): 状态 still inside the table.
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = (seq) => {
  const now = Date.now();
  const at = (d) => new Date(now + d * 86400000).toISOString();
  const R = (id, name, o) => ({ id, ...(seq ? { seq: Number(id.replace(/\D/g, '')) || 99 } : {}), name, priority: 'high', assignee: '', column: 'doing', owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: { kind: 'node', id: 'n_sweep_a' }, project_id: 'p_a', due: '', createdAt: at(-5), updatedAt: at(-1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    requirements: [
      R('r_untitled01', '​', { due: at(-0.2) }),
      R('t2', '示例企业组织树权限设置', { due: at(5) }),
      ...Array.from({ length: 8 }, (_, i) => R(`t${i + 3}`, `示例文案 | 一个比较长的任务标题,用来占满标题列 ${i + 1}`, {})),
    ],
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }, { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-门户牛' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date', 'tags', 'sub_requirements', ...(seq ? ['requirement_seq'] : [])],
  };
};

const rows = [];
let failures = 0;
const r1 = (n) => Math.round(n * 10) / 10;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tid = (id) => `[data-testid="${id}"]`;
const box = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2, text: el.textContent };
}, sel);

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });
const VIEWPORTS = [
  { w: 900, h: 700, kind: 'tablet' }, { w: 1000, h: 700, kind: 'tablet' }, { w: 1100, h: 700, kind: 'tablet' },
  { w: 1000, h: 700, kind: 'desktop' }, { w: 1320, h: 754, kind: 'desktop' }, { w: 390, h: 844, kind: 'phone' },
  // #563 的 ID 列(requirement_seq Hub):多一列,平板 1000 宽「状态」照样在表格里
  { w: 1000, h: 700, kind: 'tablet', seq: true },
];
for (const theme of ['light', 'dark']) {
  for (const v of VIEWPORTS) {
    const vp = `${v.kind} ${v.w}x${v.h} ${theme}${v.seq ? ' +ID列' : ''}`;
    const touch = v.kind !== 'desktop';
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(fixture, !!v.seq);
    await page.addInitScript(initScript, { theme });
    try {
      await page.goto(v.kind === 'desktop' ? url : `${url}?safeAreaSim=0,0,0,0`);
      if (v.kind === 'desktop') await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
      else { await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 }); await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' })); }
      await page.locator(tid('tasks-view-list')).first().click({ timeout: 20000 });
      await page.locator(tid('req-row-t2')).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(700);
    } catch (e) {
      record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] });
      await ctx.close();
      continue;
    }
    if (OUT) await page.screenshot({ path: join(OUT, `${v.kind}-${v.w}x${v.h}-${theme}${v.seq ? '-seq' : ''}-list.png`) });
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    const untitled = await box(page, tid('req-row-r_untitled01'));
    // Painted, not only textContent: 0.2.159–0.2.162 kept this text in the DOM at 0px wide and this check stayed green.
    const fbText = await paintedText(page, `${tid('req-row-r_untitled01')} div[dir="auto"]`, '（无标题）· tled01');
    const fallback = !!untitled && untitled.text.includes('（无标题）· tled01') && !!fbText?.painted && fbText.w >= 40;
    if (v.kind === 'phone') {
      record(vp, 'untitled card', { fallback, noOverflow: overflow <= 0 }, { text: untitled?.text.slice(0, 30) });
    } else {
      const table = await box(page, tid('req-list'));
      const status = await box(page, tid('task-column-status'));
      const title = await box(page, `${tid('task-cell-t2-title')} div[dir="auto"]`);
      const owner = await box(page, tid('task-cell-t2-owner'));
      record(vp, 'list', {
        statusVisible: !!status && status.r <= table.r + 0.5,
        centred: !!title && !!owner && Math.abs(title.cy - owner.cy) <= 1.5,
        fallback, noOverflow: overflow <= 0,
      }, { table: `${r1(table.x)}..${r1(table.r)}`, status: status && `${r1(status.x)}..${r1(status.r)}`, titleCy: r1(title?.cy), ownerCy: r1(owner?.cy) });
    }
    await ctx.close();
  }
}
await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
if (failures) process.exit(1);
