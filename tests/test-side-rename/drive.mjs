// 左栏项目 / 标签右键改名(#760,owner:「项目和标签都不能改名吗？」截图框着左栏的「军团基建」)。
// Hub 数据是占位的,由 tests/test-layout-sweep/harness.mjs 的 Tauri 桩在页内应答(项目 PATCH 用 __routeOverride 记下)。
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-side-rename/drive.mjs
//
// Desktop 1320×754, light + dark:
//   menu      : 右键项目行 → 菜单 改名 / 颜色 / 归档;右键标签行 → 改名 / 颜色 / 删除
//   align     : 改名框文字左缘 = 原文字左缘(±1)、框竖直居中于行(±1)、行高不变、框不越出行
//   rename    : 输入新名 + 回车 → PATCH /api/requirements/projects/p_a { name } → 左栏显示新名
//   tag       : 标签改名 → tags/ops { op: rename } → 左栏出现新标签行
//   esc       : Esc → 输入框消失、名字不变、没有发请求
//   gating    : viewer_can.edit=false 的项目 / can_manage=false 的标签:右键没有菜单
// Phone 390×844 (Android UA, touch):
//   longpress : 项目筛选里长按一个项目 → 同一份菜单(行高 ≥ 44);改名 → 管理项目里那一项直接是输入框
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = (canManage) => {
  const now = Date.now();
  const at = (d) => new Date(now + d * 86400000).toISOString();
  const R = (id, name, tags, o) => ({ id, name, priority: 'normal', assignee: '', column: 'pool', owner: null, participants: [], agent_owner: null, project_id: 'p_a', due: '', createdAt: at(-5), updatedAt: at(-1), description: '', checklist: [], tags, parent_id: null, ...o });
  const projects = [
    { id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false },
    { id: 'p_b', name: '示例项目-B', color: '#16a34a', sort: 2, archived: false },
    { id: 'p_ro', name: '只读项目', color: '#9333ea', sort: 3, archived: false, viewer_can: { edit: false } },
  ];
  window.__tasksFixture = {
    requirements: [R('t1', '示例任务一', ['UI']), R('t2', '示例任务二', ['UI', '交互']), R('t3', '示例任务三', [], { project_id: 'p_ro' })],
    projects,
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'tags', 'sub_requirements', 'tag_ops'],
    tagCanManage: canManage, tagColors: {},
  };
  window.__routeOverride = (u, body, method) => {
    const m = /^\/api\/requirements\/projects\/([^/]+)$/.exec(u.pathname);
    if (!m || !body) return undefined;
    const patch = JSON.parse(body);
    (window.__projPatches ||= []).push({ id: decodeURIComponent(m[1]), method, patch });
    const p = projects.find(x => x.id === decodeURIComponent(m[1]));
    if (!p) return null;
    Object.assign(p, patch);
    return { ok: true, project: p };
  };
};

const rows = [];
let failures = 0;
const r1 = (n) => (n == null ? n : Math.round(n * 10) / 10);
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
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, text: el.tagName === 'INPUT' ? el.value : el.textContent };
}, sel);
// 文字真实左缘:标签文字用 Range 量字形;输入框用 value 的左缘 = 内容盒左缘(padding-left + border-left)。
const textLeft = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length);
  if (!el) return null;
  if (el.tagName === 'INPUT') { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return { x: b.x + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), size: cs.fontSize }; }
  const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: b.x, size: getComputedStyle(el).fontSize };
}, sel);
const menuItems = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^="side-menu-"]')].filter(e => e.getAttribute('role') === 'menuitem' && e.getClientRects().length).map(e => ({ id: e.getAttribute('data-testid').slice(10), h: e.getBoundingClientRect().height })));

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });

async function open(v, theme, canManage) {
  const touch = v.kind === 'phone';
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(fixture, canManage);
  await page.addInitScript(initScript, { theme });
  await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
  await page.goto(touch ? `${url}?safeAreaSim=0,0,0,0` : url);
  if (!touch) await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  else { await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 }); await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' })); }
  await page.getByText('示例任务二').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}
const rightClick = async (page, sel) => { await page.locator(sel).first().click({ button: 'right', position: { x: 60, y: 19 } }); await page.waitForTimeout(250); };

for (const theme of ['light', 'dark']) {
  const vp = `desktop 1320x754 ${theme}`;
  let ctx, page;
  try { ({ ctx, page } = await open({ w: 1320, h: 754, kind: 'desktop' }, theme, true)); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); continue; }
  try {
    // ── 项目:右键 → 菜单 ──
    const rowSel = tid('task-side-project-p_a');
    const rowBefore = await box(page, rowSel);
    const labelBefore = await textLeft(page, `${rowSel} div[dir="auto"]`);
    await rightClick(page, rowSel);
    const pItems = await menuItems(page);
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-menu.png`) });
    record(vp, 'project menu', { opened: !!(await box(page, tid('side-menu'))), items: pItems.map(i => i.id).join() === 'rename,color,archive' }, { items: pItems.map(i => i.id).join() });
    // ── 改名 → 行内输入框,量对齐 ──
    await page.locator(tid('side-menu-rename')).first().click();
    const inputSel = tid('task-side-rename-p_a');
    await page.locator(inputSel).first().waitFor({ timeout: 3000 });
    await page.waitForTimeout(150);
    const rowEdit = await box(page, rowSel);
    const input = await box(page, inputSel);
    const inputText = await textLeft(page, inputSel);
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-inline.png`) });
    const dLeft = inputText && labelBefore ? inputText.x - labelBefore.x : null;
    const dMid = input && rowEdit ? (input.y + input.h / 2) - (rowEdit.y + rowEdit.h / 2) : null;
    record(vp, 'inline align', {
      menuClosed: !(await box(page, tid('side-menu'))),
      focused: await page.evaluate((s) => document.activeElement === document.querySelector(s), inputSel),
      prefilled: input?.text === '示例项目-A',
      textLeftAligned: dLeft !== null && Math.abs(dLeft) <= 1,
      verticallyCentered: dMid !== null && Math.abs(dMid) <= 1,
      rowHeightKept: !!rowBefore && !!rowEdit && Math.abs(rowEdit.h - rowBefore.h) <= 0.5,
      insideRow: !!input && !!rowEdit && input.y >= rowEdit.y && input.b <= rowEdit.b,
      sameFont: inputText?.size === labelBefore?.size,
    }, { dLeft: r1(dLeft), dMid: r1(dMid), rowH: r1(rowEdit?.h), inputH: r1(input?.h), font: `${labelBefore?.size}/${inputText?.size}` });
    // ── 回车存 ──
    await page.locator(inputSel).first().fill('军团基建');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const patches = await page.evaluate(() => window.__projPatches ?? []);
    const shown = await box(page, `${rowSel} div[dir="auto"]`);
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-renamed.png`) });
    record(vp, 'project rename', {
      patchSent: patches.length === 1 && patches[0].id === 'p_a' && JSON.stringify(patches[0].patch) === JSON.stringify({ name: '军团基建' }),
      inputGone: !(await box(page, inputSel)),
      sidebarShowsNewName: shown?.text === '军团基建',
    }, { patches: JSON.stringify(patches), shown: shown?.text });
    // ── 标签:Esc 取消 ──
    const tagSel = tid('task-filter-tag-UI');
    await rightClick(page, tagSel);
    const tItems = await menuItems(page);
    await page.locator(tid('side-menu-rename')).first().click();
    await page.locator(tid('task-side-rename-UI')).first().fill('不要存');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    record(vp, 'tag esc', {
      items: tItems.map(i => i.id).join() === 'rename,color,delete',
      inputGone: !(await box(page, tid('task-side-rename-UI'))),
      nameKept: (await box(page, `${tagSel} div[dir="auto"]`))?.text === 'UI',
      noRequest: (await page.evaluate(() => (window.__tagOps ?? []).length)) === 0,
    }, { items: tItems.map(i => i.id).join() });
    // ── 标签改名 ──
    await rightClick(page, tagSel);
    await page.locator(tid('side-menu-rename')).first().click();
    await page.locator(tid('task-side-rename-UI')).first().fill('界面');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const ops = await page.evaluate(() => window.__tagOps ?? []);
    record(vp, 'tag rename', {
      opSent: ops.length === 1 && JSON.stringify(ops[0]) === JSON.stringify({ op: 'rename', from: 'UI', to: '界面' }),
      newRow: !!(await box(page, tid('task-filter-tag-界面'))),
      oldRowGone: !(await box(page, tagSel)),
    }, { ops: JSON.stringify(ops) });
    // ── 没权限的项目 ──
    await rightClick(page, tid('task-side-project-p_ro'));
    record(vp, 'gating project', { noMenu: !(await box(page, tid('side-menu'))) });
  } catch (e) { record(vp, 'flow', { completed: false }, { error: String(e).split('\n')[0] }); }
  await ctx.close();

  // can_manage=false:标签行右键没有菜单
  try {
    ({ ctx, page } = await open({ w: 1320, h: 754, kind: 'desktop' }, theme, false));
    await rightClick(page, tid('task-filter-tag-UI'));
    record(vp, 'gating tag', { noMenu: !(await box(page, tid('side-menu'))), noRename: !(await box(page, tid('side-menu-rename'))) });
    await ctx.close();
  } catch (e) { record(vp, 'gating tag', { opened: false }, { error: String(e).split('\n')[0] }); }

  // ── 手机:长按 ──
  const pvp = `phone 390x844 ${theme}`;
  try {
    ({ ctx, page } = await open({ w: 390, h: 844, kind: 'phone' }, theme, true));
    await page.locator(tid('task-filter-project')).first().tap();
    const opt = page.locator(tid('task-filter-opt-p_a')).first();
    await opt.waitFor({ timeout: 4000 });
    const b = await opt.boundingBox();
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const items = await menuItems(page);
    if (OUT) await page.screenshot({ path: join(OUT, `phone-${theme}-sheet.png`) });
    record(pvp, 'longpress', { opened: !!(await box(page, tid('side-menu'))), items: items.map(i => i.id).join() === 'rename,color,archive', touchRows: items.every(i => i.h >= 44) }, { items: items.map(i => `${i.id}:${r1(i.h)}`).join() });
    await page.locator(tid('side-menu-rename')).first().tap();
    await page.locator(tid('project-name-input-p_a')).first().waitFor({ timeout: 4000 });
    record(pvp, 'rename page', { managerOpen: !!(await box(page, tid('project-manager'))), editingThatProject: (await box(page, tid('project-name-input-p_a')))?.text === '示例项目-A' });
    await ctx.close();
  } catch (e) { record(pvp, 'longpress', { completed: false }, { error: String(e).split('\n')[0] }); }
}

await browser.close();
await close();
console.log(`\n${rows.length - failures}/${rows.length} rows ok`);
process.exit(failures ? 1 : 0);
