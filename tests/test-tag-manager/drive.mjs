// 管理标签 + 左栏标签组 / 项目组重排 —— 在 web 导出里量出来,不靠眼睛(owner 0.2.162 截图:「标签」「项目」两组挤在一起、没法管标签)。
// Not in CI: needs Playwright + Chromium and a web export. Hub data is placeholder, answered in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (window.__tasksFixture + the tag routes there) — no hub process, no port, no HOME.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-tag-manager/drive.mjs
//
// Desktop 1320×754, light + dark:
//   headers   : 标签 / 项目 组头文字同高(±0.5)、左缘对齐(±0.5)、组头文字真的画出来了(paintedText ≥ 16px 宽)
//   spacing   : 项目组头上沿 − 标签组最后一行下沿 ≥ 16(不再挤在一起),组头下沿 ≤ 本组第一行上沿(不压行)
//   manage    : 「管理标签」在标签组最后一行、画出来 ≥ 40px 宽;标签组可折叠(折叠后标签行和管理入口都不在,展开回来)
//   dialog    : 对话框在视口内;每行名字 / 用量都画出来;勾两个 → 合并栏出现 → 合并发出 {op:merge};删除确认写明任务数;
//               调色板点一下发出 {op:color}
//   create    : 新建任务里输入「U」→ 补全第一个是 UI(前缀 + 用量最多)
//   gating    : 旧 Hub(没有 can_manage)/ scoped 成员(can_manage false)→ 没有「管理标签」
// Phone 390×844 (Android UA, touch), light + dark:
//   entry     : 顶栏标签筛选里有「管理标签」
//   sheet     : 底部面板贴底(下沿 = 视口下沿 ±1),列表行高 ≥ 56、整行宽(行宽 ≥ 面板内宽 − 1)
//   actions   : 点一行 → 操作面板 改名 / 颜色 / 删除 + 取消,每项高 ≥ 56;删除 → 确认写明任务数 → 发出 {op:delete}
//   select    : 「选择」→ 勾两个 → 合并(2)可点
//   overflow  : 没有横向滚动
// Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, initScript, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = (canManage) => {
  const now = Date.now();
  const at = (d) => new Date(now + d * 86400000).toISOString();
  const R = (id, name, tags, o) => ({ id, name, priority: 'normal', assignee: '', column: 'pool', owner: null, participants: [], agent_owner: null, project_id: 'p_a', due: '', createdAt: at(-5), updatedAt: at(-1), description: '', checklist: [], tags, parent_id: null, ...o });
  window.__tasksFixture = {
    requirements: [
      R('t1', '设置弹层增加关闭 ×', ['TMWork', '交互']),
      R('t2', '示例任务二', ['UI', '交互']),
      R('t3', '示例任务三', ['UI']),
      R('t4', '示例任务四', ['UI', '一个比较长的标签名字十个字']),
      R('t5', '示例任务五', ['Build'], { project_id: 'p_b' }),
    ],
    projects: [{ id: 'p_a', name: '示例项目-A', color: '#2563eb', sort: 1, archived: false }, { id: 'p_b', name: '示例项目-B', color: '#16a34a', sort: 2, archived: false }],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'projects', 'tags', 'sub_requirements', ...(canManage === 'old' ? [] : ['tag_ops'])],
    ...(canManage === 'old' ? {} : { tagCanManage: canManage === 'yes', tagColors: { UI: '#2563eb' } }),
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
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, text: el.textContent };
}, sel);
const boxes = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return { id: e.getAttribute('data-testid'), x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; }), sel);
const ops = (page) => page.evaluate(() => window.__tagOps ?? []);
const headerText = (page, id) => paintedText(page, `${tid(id)} div[dir="auto"]`);

const { url, close } = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--disable-web-security'] });

async function open(v, theme, canManage) {
  const touch = v.kind === 'phone';
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(fixture, canManage);
  await page.addInitScript(initScript, { theme });
  await page.goto(touch ? `${url}?safeAreaSim=0,0,0,0` : url);
  if (!touch) await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  else { await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 }); await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' })); }
  await page.getByText('示例任务二').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}

for (const theme of ['light', 'dark']) {
  // ── desktop ──
  {
    const vp = `desktop 1320x754 ${theme}`;
    let ctx, page;
    try { ({ ctx, page } = await open({ w: 1320, h: 754, kind: 'desktop' }, theme, 'yes')); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); continue; }
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-sidebar.png`) });
    const tagsHead = await box(page, tid('task-side-tags-header'));
    const projHead = await box(page, tid('task-side-projects-header'));
    const tagsText = await headerText(page, 'task-side-tags-header');
    const projText = await headerText(page, 'task-side-projects-header');
    // 每个组头的第一个文字节点(标签组头后面还有折叠箭头的字形)。
    const tagTexts = await page.evaluate(() => ['task-side-tags-header', 'task-side-projects-header'].map(id => document.querySelector(`[data-testid="${id}"] div[dir="auto"]`)?.getBoundingClientRect().x));
    const manage = await box(page, tid('task-side-manage-tags'));
    const manageText = await paintedText(page, `${tid('task-side-manage-tags')} div[dir="auto"]`, '管理标签');
    const tagRows = await boxes(page, '[data-testid^="task-filter-tag-"]');
    const lastTagRow = [...tagRows, ...(manage ? [manage] : [])].reduce((m, b) => (b.b > m.b ? b : m), { b: 0 });
    const firstProj = await box(page, tid('task-side-project-all'));
    record(vp, 'sidebar', {
      bothHeaders: !!tagsHead && !!projHead,
      textPainted: !!tagsText?.painted && tagsText.w >= 16 && !!projText?.painted && projText.w >= 16,
      textAligned: tagTexts.length === 2 && Math.abs(tagTexts[0] - tagTexts[1]) <= 0.5,
      textSameHeight: !!tagsText && !!projText && Math.abs(tagsText.h - projText.h) <= 0.5,
      manageLastInGroup: !!manage && manage.b === lastTagRow.b && manage.b <= (projHead?.y ?? 0),
      managePainted: !!manageText?.painted && manageText.w >= 40,
      groupsSeparated: !!projHead && projHead.y - lastTagRow.b >= 16,
      headerAboveRows: !!projHead && !!firstProj && projHead.b <= firstProj.y + 0.5,
      tagRowsListed: tagRows.length >= 6,
    }, { tagsHead: tagsHead && `${r1(tagsHead.y)}+${r1(tagsHead.h)}`, projHead: projHead && `${r1(projHead.y)}+${r1(projHead.h)}`, gap: r1(projHead && projHead.y - lastTagRow.b), manageW: r1(manageText?.w), headerTextW: `${r1(tagsText?.w)}/${r1(projText?.w)}` });

    // collapse / expand
    await page.locator(tid('task-side-tags-header')).first().click();
    await page.waitForTimeout(200);
    const collapsedRows = (await boxes(page, '[data-testid^="task-filter-tag-"]')).length;
    const collapsedManage = await box(page, tid('task-side-manage-tags'));
    const projAfter = await box(page, tid('task-side-projects-header'));
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-sidebar-collapsed.png`) });
    await page.locator(tid('task-side-tags-header')).first().click();
    await page.waitForTimeout(200);
    const expandedRows = (await boxes(page, '[data-testid^="task-filter-tag-"]')).length;
    record(vp, 'collapse', { hidesRows: collapsedRows === 0 && !collapsedManage, projectsMoveUp: !!projAfter && projAfter.y < projHead.y, restores: expandedRows === tagRows.length }, { collapsedRows, expandedRows });

    // manager dialog
    await page.locator(tid('task-side-manage-tags')).first().click();
    await page.locator(tid('tag-manager')).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-manager.png`) });
    const dlg = await box(page, tid('tag-manager'));
    const names = [];
    for (const tag of ['UI', '交互', 'TMWork', 'Build', '一个比较长的标签名字十个字']) names.push([tag, await paintedText(page, `${tid(`tag-name-${tag}`)} div[dir="auto"]`, tag), await paintedText(page, tid(`tag-usage-${tag}`))]);
    const uiUsage = await box(page, tid('tag-usage-UI'));
    record(vp, 'dialog', {
      inViewport: !!dlg && dlg.x >= 0 && dlg.y >= 0 && dlg.r <= 1320 && dlg.b <= 754,
      namesPainted: names.every(([, n]) => n?.painted && n.w >= 10),
      usagePainted: names.every(([, , u]) => u?.painted && u.w >= 20),
      usageCount: uiUsage?.text === '3 个任务',
    }, { dlg: dlg && `${r1(dlg.x)},${r1(dlg.y)} ${r1(dlg.w)}×${r1(dlg.h)}`, narrowest: r1(Math.min(...names.map(([, n]) => n?.w ?? 0))) });

    // color
    await page.locator(tid('tag-swatch-交互')).first().click();
    await page.locator(tid('tag-color-dc2626')).first().click();
    await page.waitForTimeout(300);
    const afterColor = await ops(page);
    // delete confirm (then cancel)
    await page.locator(tid('tag-delete-UI')).first().click();
    const confirm = await box(page, tid('tag-delete-confirm'));
    const goText = await paintedText(page, `${tid('tag-delete-go')} div[dir="auto"]`);
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-delete-confirm.png`) });
    await page.locator(tid('tag-delete-cancel')).first().click();
    // merge
    await page.locator(tid('tag-pick-TMWork')).first().click();
    const noBarYet = !(await box(page, tid('tag-merge-bar')));
    await page.locator(tid('tag-pick-Build')).first().click();
    const bar = await box(page, tid('tag-merge-bar'));
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-merge.png`) });
    await page.locator(tid('tag-merge-input')).first().fill('工程');
    await page.locator(tid('tag-merge-go')).first().click();
    await page.waitForTimeout(400);
    const after = await ops(page);
    const merged = after.find(o => o.op === 'merge');
    record(vp, 'actions', {
      colorOp: afterColor.some(o => o.op === 'color' && o.tag === '交互' && o.color === '#dc2626'),
      deleteConfirmNamesCount: !!confirm && /3 个任务/.test(confirm.text) && !!goText?.painted,
      noDeleteSent: !after.some(o => o.op === 'delete'),
      mergeBarOnlyAt2: noBarYet && !!bar && bar.r <= dlg.r,
      mergeOp: !!merged && merged.to === '工程' && merged.from.length === 2 && merged.from.includes('TMWork') && merged.from.includes('Build'),
      boardUpdated: !!(await box(page, tid('tag-name-工程'))),
    }, { ops: after.map(o => o.op).join(',') });
    await page.locator(tid('tag-manager-close')).first().click();

    // create dialog autocomplete
    await page.locator(tid('req-new')).first().click();
    await page.locator(tid('req-create-tag-input')).first().fill('U');
    await page.waitForTimeout(200);
    await page.locator(tid('req-create-tag-option-UI')).first().scrollIntoViewIfNeeded();
    const opts = await boxes(page, '[data-testid^="req-create-tag-option-"]');
    const firstOpt = await paintedText(page, `${tid('req-create-tag-option-UI')} div[dir="auto"]`, 'UI');
    if (OUT) await page.screenshot({ path: join(OUT, `desktop-${theme}-create-autocomplete.png`) });
    record(vp, 'create autocomplete', { firstIsUI: opts[0]?.id === 'req-create-tag-option-UI', painted: !!firstOpt?.painted }, { opts: opts.map(o => o.id.replace('req-create-tag-option-', '')).join(',') });
    await ctx.close();
  }
  // ── gating ──
  for (const mode of ['old', 'no']) {
    const vp = `desktop 1320x754 ${theme} ${mode === 'old' ? 'old-hub' : 'scoped'}`;
    let ctx, page;
    try { ({ ctx, page } = await open({ w: 1320, h: 754, kind: 'desktop' }, theme, mode)); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); continue; }
    record(vp, 'gating', { noManageEntry: !(await box(page, tid('task-side-manage-tags'))), tagsStillListed: (await boxes(page, '[data-testid^="task-filter-tag-"]')).length >= 6 });
    await ctx.close();
  }
  // ── phone ──
  {
    const vp = `phone 390x844 ${theme}`;
    let ctx, page;
    try { ({ ctx, page } = await open({ w: 390, h: 844, kind: 'phone' }, theme, 'yes')); } catch (e) { record(vp, 'open', { opened: false }, { error: String(e).split('\n')[0] }); continue; }
    await page.locator(tid('task-tags-filter')).first().click();
    const entry = await box(page, tid('task-tags-manage'));
    record(vp, 'entry', { manageInFilter: !!entry });
    await page.locator(tid('task-tags-manage')).first().tap();
    await page.locator(tid('tag-manager')).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    if (OUT) await page.screenshot({ path: join(OUT, `phone-${theme}-manager.png`) });
    const sheet = await box(page, tid('tag-manager'));
    const list = await box(page, tid('tag-manager-list'));
    const prow = await boxes(page, '[data-testid^="tag-row-"]');
    const nameUI = await paintedText(page, `${tid('tag-name-UI')}`, 'UI');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    record(vp, 'sheet', {
      bottomAnchored: !!sheet && Math.abs(sheet.b - 844) <= 1,
      rowsTall: prow.length >= 5 && prow.every(r => r.h >= 56),
      rowsFullWidth: !!list && prow.every(r => r.w >= list.w - 1),
      namePainted: !!nameUI?.painted,
      noOverflow: overflow <= 0,
    }, { rows: prow.length, rowH: r1(Math.min(...prow.map(r => r.h))), sheetB: r1(sheet?.b) });

    await page.locator(tid('tag-row-UI')).first().tap();
    await page.locator(tid('tag-action-sheet')).first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    if (OUT) await page.screenshot({ path: join(OUT, `phone-${theme}-actions.png`) });
    const acts = await boxes(page, '[data-testid^="tag-action-"]:not([data-testid="tag-action-sheet"])');
    record(vp, 'actions', { fourButtons: ['tag-action-rename', 'tag-action-color', 'tag-action-delete', 'tag-action-cancel'].every(id => acts.some(a => a.id === id)), tall: acts.every(a => a.h >= 56) }, { acts: acts.map(a => `${a.id.replace('tag-action-', '')}:${r1(a.h)}`).join(' ') });
    await page.locator(tid('tag-action-delete')).first().tap();
    await page.waitForTimeout(300);
    const title = await box(page, tid('tag-action-sheet'));
    if (OUT) await page.screenshot({ path: join(OUT, `phone-${theme}-delete-confirm.png`) });
    await page.locator(tid('tag-action-delete-go')).first().tap();
    await page.waitForTimeout(500);
    const del = (await ops(page)).find(o => o.op === 'delete');
    record(vp, 'delete', { confirmNamesCount: !!title && /3 个任务/.test(title.text), deleteOp: del?.tag === 'UI', backToList: !!(await box(page, tid('tag-manager-list'))) && !(await box(page, tid('tag-row-UI'))) });

    await page.locator(tid('tag-select-toggle')).first().tap();
    await page.locator(tid('tag-row-交互')).first().tap();
    await page.locator(tid('tag-row-TMWork')).first().tap();
    await page.waitForTimeout(200);
    const mergeBtn = await box(page, tid('tag-merge-open'));
    if (OUT) await page.screenshot({ path: join(OUT, `phone-${theme}-select.png`) });
    const enabled = await page.evaluate(() => { const el = document.querySelector('[data-testid="tag-merge-open"]'); return !!el && el.getAttribute('aria-disabled') !== 'true'; });
    record(vp, 'select', { mergeReady: !!mergeBtn && /合并（2）/.test(mergeBtn.text) && enabled });
    await ctx.close();
  }
}
await browser.close();
close();
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
if (failures) process.exit(1);
