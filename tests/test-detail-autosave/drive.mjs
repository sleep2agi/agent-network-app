// 任务详情改了不点「保存修改」就关 = 改的东西悄悄丢了(任务页审计 2026-10-02 H1)。点真按钮、量真框。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process,
// no port, no HOME touched). Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-detail-autosave/drive.mjs
//
// desktop 1440×900 (抽屉) and phone 390×844 (整页), light + dark:
//   picker  详情里点「P0 最高」⇒ 立刻 PATCH {priority:'high'}(只这一个字段),底栏说「已保存」(在底栏里、可见)
//   close   改标题不点保存,点 ✕ / 返回 ⇒ 先 PATCH {name} 再关,看板卡片上是新标题
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
  const R = (id, seq, name) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: null, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(5), description: '示例描述', checklist: [], tags: [], parent_id: null });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [R('r1', 81, '示例任务一'), R('r2', 82, '示例任务二')],
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
const inside = (a, b) => !!(a && b) && a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

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
    const open = async (id) => {
      await press(page.locator(tid(`req-card-${id}`)).first());
      await page.locator(tid('req-edit-name')).first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
    };
    const step = async (what, fn) => {
      try { await fn(); } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${what}.png` }).catch(() => {});
        await page.evaluate(() => { window.__tasksPatches = []; });
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

      await step('picker', async () => {
        await open('r1');
        // #701:优先级在详情头部的 pill 里,点开再选;存上后底部一个「已保存」小提示(没有「保存修改」按钮)。
        await press(page.locator(tid('req-priority-pill')).first());
        await press(page.locator(tid('req-edit-priority-high')).first());
        await page.waitForTimeout(300);
        const sent = await patches();
        const toast = page.locator(tid('req-saved-toast')).first();
        const statusText = (await toast.count()) ? (await toast.innerText()).trim() : '';
        const sb = (await toast.count()) ? await toast.boundingBox() : null;
        const detail = await page.locator(tid('req-detail')).first().boundingBox();
        await shot('1-priority-saved');
        record(where, 'picker field saves at once', {
          patchedAtOnce: sent.length === 1 && sent[0] === JSON.stringify({ priority: 'high' }),
          saidSaved: statusText.includes('已保存'),
          toastInDetail: inside(sb, detail) && !!sb && sb.width > 0 && sb.y + sb.height <= V.h,
          noSaveButton: (await page.locator(tid('req-edit-save')).count()) === 0,
        }, { sent: sent.join(' '), statusText });
        const close = page.locator(tid('req-detail-close')).first();
        await press(close);
        await page.waitForTimeout(500);
        const card = (await page.locator(tid('req-card-r1')).first().innerText()).replace(/\s+/g, ' ');
        record(where, 'card shows the new priority after closing', { p0: /P0/.test(card) }, { card });
        await page.evaluate(() => { window.__tasksPatches = []; });
      });

      await step('close', async () => {
        await open('r2');
        await page.locator(tid('req-edit-name')).first().fill('示例任务二(改了没点保存)');
        await page.waitForTimeout(200);
        await press(page.locator(tid('req-detail-close')).first());
        await page.waitForTimeout(700);
        const sent = await patches();
        const detailGone = (await page.locator(tid('req-edit-name')).count()) === 0;
        const card = (await page.locator(tid('req-card-r2')).first().innerText()).replace(/\s+/g, ' ');
        await shot('2-closed-saved');
        record(where, 'closing saves the typed title instead of dropping it', {
          savedOnClose: sent.length === 1 && sent[0] === JSON.stringify({ name: '示例任务二(改了没点保存)' }),
          closed: detailGone,
          cardShowsIt: card.includes('改了没点保存'),
        }, { sent: sent.join(' '), card });
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
