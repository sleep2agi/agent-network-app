// 任务标题看得见 —— 列表 / 看板 / 详情里标题「画出来了」,不只是「在 DOM 里」。在 web 导出里量,不靠眼睛。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (window.__tasksFixture) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-title-visible/drive.mjs
//
// 0.2.159–0.2.162 的列表标题列整列空白(owner 09-30 Windows 截图):标题文字带 `flex: 0`,react-native-web 把它原样写成
// CSS `flex: 0` = `0 1 0%` —— 基准宽 0、不伸长,再加 overflow:hidden,字宽 0。textContent 照样是标题,
// 所以只查文字的检查(test-task-list-tablet 的 fallback)一直绿。这里量的是画出来的宽:
//   list   : 每行标题文字的宽 ≥ 40px,且 ≥ 标题格宽的 30% 或整段标题的宽(短标题)
//   board  : 看板卡片的标题文字宽 ≥ 40px
//   detail : 点开详情,标题输入框的值 = 任务名、输入框宽 ≥ 120px
//   every  : 整页没有「有字却画成 < 1px 宽 / 高」的元素(harness zeroSizeText)
// 桌面 1320×754 / 1000×700 + 平板 1000×700,浅色 + 深色;另跑一轮「老版本存下来的字段配置」(title 拖过宽 + 老的列集合)。
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA, zeroSizeText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

// Production-shaped rows: the title rides in `name` (Hub has no `title` field), with seq / agent_owner / project.
const fixture = ({ fields }) => {
  const now = Date.now();
  const at = (d) => new Date(now + d * 86400000).toISOString();
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'high', assignee: '', column: 'doing', owner: { kind: 'user', id: 'u_tester' }, participants: [], agent_owner: { kind: 'node', id: 'n_sweep_a' }, project_id: 'p_a', due: '', start: '', createdAt: at(-5), updatedAt: at(-1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    requirements: [
      R('t1', 385, '示例门户 | 首页改版文案', {}),
      R('t2', 382, '短', { column: 'todo' }),
      ...Array.from({ length: 6 }, (_, i) => R(`t${i + 3}`, 300 - i, `示例基建 | 一个比较长的任务标题,用来占满标题列 ${i + 1}`, {})),
    ],
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }, { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-门户牛' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'priority_lowest', 'start_date', 'tags', 'sub_requirements', 'requirement_seq'],
  };
  if (fields) try { localStorage.setItem('task_list_fields_v1', fields); } catch { /* no storage: default fields */ }
};
const IDS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
const NAMES = { t1: '示例门户 | 首页改版文案', t2: '短' };
// Saved by 0.2.15x (#513/#527): no `seq` column yet, title dragged to 320px, a column hidden.
const LEGACY_FIELDS = JSON.stringify([{ id: 'title', visible: true, width: 320 }, { id: 'owner', visible: true }, { id: 'priority', visible: true }, { id: 'due', visible: true }, { id: 'participants', visible: false }, { id: 'project', visible: true }, { id: 'status', visible: true, width: 96 }]);

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
// Width of the element that actually paints the title text, plus the width the full text would need.
const textBox = (page, sel, text) => page.evaluate(([s, text]) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length && (text === undefined || e.textContent === text));
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const range = document.createRange(); range.selectNodeContents(el);
  const probe = el.cloneNode(true); Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', width: 'auto', maxWidth: 'none', flex: 'none', whiteSpace: 'nowrap' });
  document.body.appendChild(probe); const natural = probe.getBoundingClientRect().width; probe.remove();
  return { w: b.width, h: b.height, natural, text: el.textContent };
}, [sel, text]);

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });
const VIEWPORTS = [
  { w: 1320, h: 754, kind: 'desktop' }, { w: 1000, h: 700, kind: 'desktop' }, { w: 1000, h: 700, kind: 'tablet' },
  { w: 1320, h: 754, kind: 'desktop', legacy: true },
];
for (const theme of ['light', 'dark']) {
  for (const v of VIEWPORTS) {
    const vp = `${v.kind} ${v.w}x${v.h} ${theme}${v.legacy ? ' +老字段配置' : ''}`;
    const touch = v.kind !== 'desktop';
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(fixture, { fields: v.legacy ? LEGACY_FIELDS : null });
    await page.addInitScript(initScript, { theme });
    const shot = (n) => OUT ? page.screenshot({ path: join(OUT, `${v.kind}-${v.w}x${v.h}-${theme}${v.legacy ? '-legacy' : ''}-${n}.png`) }) : null;
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
    await shot('list');
    // list: every row's title paints
    const narrow = [];
    for (const id of IDS) {
      const t = await textBox(page, `${tid(`task-title-${id}`)} div[dir="auto"]`);
      const cell = await textBox(page, tid(`task-cell-${id}-title`));
      const ok = !!t && !!cell && t.w >= Math.min(40, t.natural - 0.5) && t.w >= Math.min(cell.w * 0.3, t.natural - 0.5) && (!NAMES[id] || t.text === NAMES[id]);
      if (!ok) narrow.push(`${id}:${r1(t?.w ?? -1)}/${r1(cell?.w ?? -1)}`);
    }
    const zeroList = await zeroSizeText(page);
    record(vp, 'list', { allTitlesPainted: narrow.length === 0, noZeroSizeText: zeroList.length === 0 }, { narrow: narrow.join(' ') || '-', zero: zeroList.slice(0, 3).join(' | ') || '-' });
    // board
    try {
      await page.locator(tid('tasks-view-board')).first().click({ timeout: 10000 });
      await page.locator(tid('req-card-t1')).first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await shot('board');
      const card = await textBox(page, `${tid('req-card-t1')} div[dir="auto"]`, NAMES.t1);
      const zeroBoard = await zeroSizeText(page);
      record(vp, 'board', { cardTitlePainted: !!card && card.w >= 40, noZeroSizeText: zeroBoard.length === 0 }, { w: r1(card?.w ?? -1), text: card?.text.slice(0, 20), zero: zeroBoard.slice(0, 3).join(' | ') || '-' });
    } catch (e) { record(vp, 'board', { opened: false }, { error: String(e).split('\n')[0] }); }
    // detail (from the list row)
    try {
      await page.locator(tid('tasks-view-list')).first().click({ timeout: 10000 });
      await page.locator(tid('req-row-t1')).first().click({ timeout: 10000 });
      const input = page.locator(tid('req-edit-name')).first();
      await input.waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await shot('detail');
      const value = await input.inputValue();
      const w = (await input.boundingBox())?.width ?? -1;
      const zeroDetail = await zeroSizeText(page);
      record(vp, 'detail', { nameValue: value === NAMES.t1, inputWide: w >= 120, noZeroSizeText: zeroDetail.length === 0 }, { w: r1(w), value: value.slice(0, 20), zero: zeroDetail.slice(0, 3).join(' | ') || '-' });
    } catch (e) { record(vp, 'detail', { opened: false }, { error: String(e).split('\n')[0] }); }
    await ctx.close();
  }
}
await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
if (failures) process.exit(1);
