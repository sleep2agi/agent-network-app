// 弹层按 Esc 只关自己,不连带关掉下面那层 —— 点真按钮、按真键。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-select-menu-esc/drive.mjs
//
// 任务页:1100×620(鼠标,看板窄 ⇒ 详情是整页 Modal)和 1440×900(详情是抽屉),light + dark,每种弹层按一次 Esc:
//   select     详情「项目」下拉(TaskSelectMenu)       ⇒ 菜单关了、详情还在
//   due        详情「预计完成」日期面板(TaskDuePicker) ⇒ 面板关了、详情还在
//   people     详情「负责人」锚定下拉(RequirementPeoplePicker)⇒ 下拉关了、详情还在
//   fullscreen 详情描述「全屏」(TaskDescriptionFullscreen)⇒ 全屏关了、详情还在
//   cell       列表视图里负责人格的就地编辑(TaskListCellEditor 的 ChipPicker,只在宽窗口)⇒ 编辑器关了、列表还在
// 设置窗口 1440×900:
//   appselect  语音输入 → 麦克风下拉(AppSelect)      ⇒ 下拉关了、还在「语音输入」分类
// Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const ua = { kind: 'user', id: 'u_a' };
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [{ id: 'r1', seq: 61, name: '示例任务一', priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null }],
    projects: [{ id: 'p1', name: '示例项目', color: '#16a34a', sort: 0 }],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }, { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq', 'projects'],
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

const VIEWPORTS = { narrow: { w: 1100, h: 620 }, wide: { w: 1440, h: 900 } };
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const gone = async (id) => (await page.locator(tid(id)).count()) === 0;
    const detailOpen = async () => (await page.locator(tid('req-edit-project')).count()) > 0;
    const openDetail = async () => {
      if (await detailOpen()) return;
      await page.locator(tid('req-card-r1')).first().click();
      await page.locator(tid('req-edit-project')).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
    };
    const step = async (what, fn) => {
      try { await fn(); } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
    };
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(fixture);
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.waitForTimeout(300);
      const seg = page.locator(tid('tasks-view-board')).first();
      if (await seg.count() && await seg.isVisible()) { await seg.click(); await page.waitForTimeout(300); }

      await step('select', async () => {
        await openDetail();
        await page.locator(tid('req-edit-project')).first().scrollIntoViewIfNeeded();
        await page.locator(tid('req-edit-project')).first().click();
        await page.locator(tid('req-edit-project-menu')).first().waitFor({ timeout: 4000 });
        await shot('select-open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        record(where, 'select', { closed: await gone('req-edit-project-menu'), detailStays: await detailOpen() });
      });

      await step('due', async () => {
        await openDetail();
        await page.locator(tid('req-edit-due')).first().scrollIntoViewIfNeeded();
        await page.locator(tid('req-edit-due')).first().click();
        await page.locator(tid('req-edit-due-panel')).first().waitFor({ timeout: 4000 });
        await shot('due-open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        record(where, 'due', { closed: await gone('req-edit-due-panel'), detailStays: await detailOpen() });
      });

      await step('people', async () => {
        await openDetail();
        await page.locator(tid('req-edit-owner')).first().scrollIntoViewIfNeeded();
        await page.locator(tid('req-edit-owner')).first().click();
        await page.locator(tid('people-dropdown')).first().waitFor({ timeout: 4000 });
        await shot('people-open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        record(where, 'people', { closed: await gone('people-dropdown'), detailStays: await detailOpen() });
      });

      await step('fullscreen', async () => {
        await openDetail();
        // 「全屏」按钮在编辑模式下出现;按钮和全屏层用的是同一个 testID,开没开看全屏工具栏。
        const edit = page.locator(tid('req-description-mode-edit')).first();
        if (await edit.count()) { await edit.scrollIntoViewIfNeeded(); await edit.click(); await page.waitForTimeout(300); }
        await page.locator(tid('req-description-fullscreen')).first().scrollIntoViewIfNeeded();
        await page.locator(tid('req-description-fullscreen')).first().click();
        await page.locator(tid('req-description-full-toolbar')).first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(300);
        await shot('fullscreen-open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        record(where, 'fullscreen', { closed: (await page.locator(tid('req-description-full-toolbar')).count()) === 0, detailStays: await detailOpen() });
      });

      if (name === 'wide') await step('cell', async () => {
        if (await detailOpen()) { const c = page.locator(tid('req-detail-close')).first(); if (await c.count()) await c.click(); await page.waitForTimeout(300); }
        await page.locator(tid('tasks-view-list')).first().click();
        await page.waitForTimeout(400);
        const cell = page.locator(tid('task-cell-r1-owner')).first();
        await cell.click({ position: { x: 6, y: 10 } }); await page.waitForTimeout(150);
        await cell.click({ position: { x: 6, y: 10 } });
        await page.locator(tid('list-edit-owner')).first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(250);
        await shot('cell-open');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        record(where, 'cell', { closed: await gone('list-edit-owner'), listStays: (await page.locator(tid('req-row-r1')).count()) > 0 });
      });

      record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
    } catch (e) {
      record(where, 'load', { ran: false }, { error: String(e).split('\n')[0] });
    }
    await ctx.close();
  }
}

// 设置窗口:AppSelect(语音输入 → 麦克风)。
for (const theme of ['light', 'dark']) {
  const where = `settings/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(initScript, { theme });
    await page.addInitScript(() => { window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'settings' }, currentWebview: { windowLabel: 'settings', label: 'settings' } }; });
    await page.goto(`${web.url}?safeAreaSim=0,0,0,0&settings=1&category=voice`);
    await page.getByRole('button', { name: '设置分类 语音输入' }).click({ timeout: 20000 });
    await page.locator(tid('voice-mic-select')).first().waitFor({ timeout: 10000 });
    await page.locator(tid('voice-mic-select')).first().click();
    await page.locator(tid('voice-mic-select-menu')).first().waitFor({ timeout: 4000 });
    if (OUT) await page.screenshot({ path: `${OUT}/settings-${theme}-appselect-open.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    record(where, 'appselect', {
      closed: (await page.locator(tid('voice-mic-select-menu')).count()) === 0,
      stillOnVoice: await page.locator(tid('voice-mic-select')).first().isVisible(),
    });
  } catch (e) {
    record(where, 'appselect', { ran: false }, { error: String(e).split('\n')[0] });
  }
  await ctx.close();
}
await browser.close();
web.close();
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
