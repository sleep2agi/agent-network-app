// 详情里打了字没存,不是经过 ✕ 关的(点了另一张卡、点子任务跳过去)—— 打的字照样存上(任务页审计 2026-10-02 M1)。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process,
// no port, no HOME touched). Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-detail-flush/drive.mjs
//
// desktop 1440×900 (抽屉) and phone 390×844 (整页), light + dark:
//   child    r1 的详情里改标题不点保存 →「更多」里点子任务 r2 ⇒ 先 PATCH {name}(r1 的),详情换成 r2、显示 r2 自己的标题;
//            回到看板 r1 卡片上是新标题
//   switch   (桌面)改 r3 的标题 → 直接点看板上的 r4 卡 ⇒ PATCH {name},r3 卡片是新标题
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
    requirements: [R('r1', 101, '母任务示例', { children: { total: 1, done: 0 } }), R('r2', 102, '子任务示例', { parent_id: 'r1', column: 'doing' }), R('r3', 103, '换卡示例三'), R('r4', 104, '换卡示例四')],
    projects: [],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};

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
    const cardText = async (id) => ((await page.locator(tid(`req-card-${id}`)).count()) ? (await page.locator(tid(`req-card-${id}`)).first().innerText()).replace(/\s+/g, ' ') : '');
    const closeDetail = async () => { const c = page.locator(tid('req-detail-close')).first(); if (await c.count()) { await press(c); await page.waitForTimeout(500); } };
    const step = async (what, fn) => {
      try { await fn(); } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${what}.png` }).catch(() => {});
        await closeDetail().catch(() => {});
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

      await step('child', async () => {
        await press(page.locator(tid('req-card-r1')).first());
        await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 5000 });
        await page.locator(tid('req-edit-name')).first().fill('母任务示例(改了没点保存)');
        if (!(await page.locator(tid('req-more')).count())) await press(page.locator(tid('req-more-toggle')).first());
        const child = page.locator(tid('req-child-r2')).first();
        await child.scrollIntoViewIfNeeded();
        await press(child);
        await page.waitForTimeout(700);
        const sent = await patches();
        const nowTitle = await page.locator(tid('req-edit-name')).first().inputValue();
        await shot('1-child-opened');
        await closeDetail();
        if (V.ua) await page.waitForTimeout(300);
        const r1 = await cardText('r1');
        record(where, 'jumping to a sub-task saves the typed title first', {
          sent: sent.length === 1 && sent[0] === JSON.stringify({ name: '母任务示例(改了没点保存)' }),
          showsChild: nowTitle === '子任务示例',
          cardUpdated: r1.includes('改了没点保存'),
          noExtraOnClose: (await patches()).length === 1,
        }, { sent: sent.join(' '), nowTitle, r1 });
        await resetPatches();
      });

      if (!V.ua) await step('switch', async () => {
        await press(page.locator(tid('req-card-r3')).first());
        await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 5000 });
        await page.locator(tid('req-edit-name')).first().fill('换卡示例三(改了没点保存)');
        await press(page.locator(tid('req-card-r4')).first());
        await page.waitForTimeout(700);
        const sent = await patches();
        const nowTitle = await page.locator(tid('req-edit-name')).first().inputValue();
        await shot('2-switched');
        record(where, 'clicking another card saves the typed title first', {
          sent: sent.length === 1 && sent[0] === JSON.stringify({ name: '换卡示例三(改了没点保存)' }),
          showsNext: nowTitle === '换卡示例四',
          cardUpdated: (await cardText('r3')).includes('改了没点保存'),
        }, { sent: sent.join(' '), nowTitle });
        await closeDetail();
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
