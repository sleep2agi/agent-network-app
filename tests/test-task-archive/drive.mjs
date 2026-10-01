// 任务归档 / 恢复(任务页审计 2026-10-02 H2)—— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri
// stub in tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-archive/drive.mjs
//
// desktop 1440×900 (右键菜单) and phone 390×844 (长按菜单), light + dark:
//   menu      卡片菜单里有「归档」→ 只发 { archived: true },卡从看板上消失,底部提示「已归档…」+「撤销」(在视口内);
//             点撤销 → 只发 { archived: false },卡回来
//   detail    详情「更多」里「归档这个任务」→ 详情关,卡消失
//   restore   搜到归档的卡打开:顶上「已归档」横幅 +「恢复」→ 只发 { archived: false },横幅消失,提示「已恢复…」
// Each step runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (m) => new Date(Date.now() - m * 60000).toISOString();
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: null, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(5), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [R('r1', 91, '归档示例一'), R('r2', 92, '归档示例二'), R('r3', 93, '留着的示例')],
    archived: [R('r9', 99, '归档示例九', { column: 'done', archived: true })],
    projects: [],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq', 'archived'],
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};
const inView = (b, V) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= V.w + 0.5 && b.y + b.height <= V.h + 0.5;

const VIEWPORTS = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const press = (l) => (V.ua ? l.tap() : l.click());
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const patches = () => page.evaluate(() => (window.__tasksPatches || []).map(p => JSON.stringify(p)));
    const resetPatches = () => page.evaluate(() => { window.__tasksPatches = []; });
    const onBoard = async (id) => (await page.locator(tid(`req-card-${id}`)).count()) > 0;
    const openMenu = async (id) => {
      const card = page.locator(tid(`req-card-${id}`)).first();
      if (!V.ua) await card.click({ button: 'right', position: { x: 40, y: 12 } });
      else { const b = await card.boundingBox(); await page.mouse.move(b.x + 40, b.y + 12); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); }
      await page.locator(tid('task-menu')).first().waitFor({ timeout: 4000 });
      await page.waitForTimeout(250);
    };
    const step = async (what, fn) => {
      try { await fn(); } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${what}.png` }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        if (await page.locator(tid('task-menu-scrim')).count()) await page.locator(tid('task-menu-scrim')).first().click({ position: { x: 3, y: 3 } }).catch(() => {});
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
      await page.waitForTimeout(500);
      const seg = page.locator(tid('tasks-view-board')).first();
      if (await seg.count() && await seg.isVisible()) { await press(seg); await page.waitForTimeout(300); }
      await page.locator(tid('req-card-r1')).first().waitFor({ timeout: 10000 });

      await step('menu', async () => {
        await openMenu('r1');
        const item = page.locator(tid('task-menu-archive')).first();
        const present = (await item.count()) > 0;
        await shot('1-menu');
        if (!present) { record(where, 'card menu archives, toast undoes', { menuItem: false }); await page.keyboard.press('Escape'); return; }
        await press(item);
        await page.waitForTimeout(500);
        const after = await patches();
        const gone = !(await onBoard('r1'));
        const toast = await page.locator(tid('archive-undo')).first().boundingBox().catch(() => null);
        const toastText = toast ? (await page.locator(tid('archive-undo')).first().innerText()).replace(/\s+/g, ' ') : '';
        await shot('2-archived-toast');
        await press(page.locator(tid('archive-undo-button')).first());
        await page.waitForTimeout(500);
        const undone = await patches();
        record(where, 'card menu archives, toast undoes', {
          menuItem: present,
          sentArchive: after.length === 1 && after[0] === '{"archived":true}',
          leftBoard: gone,
          toast: inView(toast, V) && toastText.includes('已归档') && toastText.includes('撤销'),
          undoSent: undone.length === 2 && undone[1] === '{"archived":false}',
          back: await onBoard('r1'),
        }, { sent: undone.join(' '), toastText });
        await resetPatches();
      });

      await step('detail', async () => {
        await press(page.locator(tid('req-card-r2')).first());
        await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 5000 });
        if (!(await page.locator(tid('req-more')).count())) await press(page.locator(tid('req-more-toggle')).first());
        const btn = page.locator(tid('req-archive')).first();
        const present = (await btn.count()) > 0;
        if (present) { await btn.scrollIntoViewIfNeeded(); await shot('3-detail-archive'); await press(btn); await page.waitForTimeout(600); }
        const sent = await patches();
        record(where, 'detail archives and closes', {
          button: present,
          sentArchive: sent.length === 1 && sent[0] === '{"archived":true}',
          detailClosed: (await page.locator(tid('req-edit-name')).count()) === 0,
          leftBoard: !(await onBoard('r2')),
        }, { sent: sent.join(' ') });
        if (!present) { const c = page.locator(tid('req-detail-close')).first(); if (await c.count()) await press(c); await page.waitForTimeout(300); }
        await resetPatches();
      });

      await step('restore', async () => {
        if (V.ua) { await press(page.locator(tid('task-search-open')).first()); await page.waitForTimeout(300); }
        await page.locator(tid('task-search-input')).first().fill('归档示例九');
        await page.waitForTimeout(900);
        await press(page.locator(`${tid('req-card-r9')}, ${tid('req-row-r9')}`).first());
        await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        const banner = await page.locator(tid('req-archived-banner')).first().boundingBox().catch(() => null);
        await shot('4-archived-banner');
        const restore = page.locator(tid('req-restore')).first();
        if (await restore.count()) { await press(restore); await page.waitForTimeout(600); }
        const sent = await patches();
        const toastText = (await page.locator(tid('archive-undo')).count()) ? (await page.locator(tid('archive-undo')).first().innerText()).replace(/\s+/g, ' ') : '';
        await shot('5-restored');
        record(where, 'archived task: banner + restore', {
          banner: inView(banner, V),
          sentRestore: sent.length === 1 && sent[0] === '{"archived":false}',
          bannerGone: (await page.locator(tid('req-archived-banner')).count()) === 0,
          toast: toastText.includes('已恢复'),
        }, { sent: sent.join(' '), toastText });
      });

      record(where, 'page errors', { none: errors.length === 0 }, errors.length ? { errors: errors.slice(0, 3) } : {});
    } catch (e) {
      record(where, 'load', { ran: false }, { error: String(e).split('\n')[0] });
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log(failures ? `\n${failures}/${rows} rows failed` : `\nall ${rows} rows passed`);
process.exit(failures || rows === 0 ? 1 : 0);
