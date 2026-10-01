// 审计 M2:桌面看板右键菜单里改优先级。真右键、真点、截下真请求体。Placeholder data only, served in-page by the
// Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-card-menu-priority/drive.mjs
//
// desktop 1440×900 and 1100×620 (mouse), light + dark:
//   menu      右键一张可改的卡:菜单里有 4 档优先级(Hub 支持 P3),当前档 ✓ 且不可点,其余可点;菜单整个在视口内
//   patch     点 P0(high):PATCH 体恰好 {"priority":"high"},菜单关掉,卡片上的优先级标变成 P0
//   locked    右键一张我只是参与人的卡:4 档都灰(aria-disabled),点了不发请求
//   list      列表视图里右键一行:同一个菜单,同样有 4 档
// phone 390×844(安卓 UA):长按菜单仍是「改状态…」「改优先级…」,没有直接列档。
// Each step runs on its own; a pre-change export fails every desktop step. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 41, '示例任务一:可改', { priority: 'normal' }),
      R('r2', 42, '示例任务二:我参与', { participants: [me], viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] } }),
    ],
    projects: [],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }, { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq', 'priority_lowest'],
  };
};

const rows = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const tid = (id) => `[data-testid="${id}"]`;
const PRI = ['high', 'normal', 'low', 'lowest'];
const VIEWPORTS = {
  desktop: { w: 1440, h: 900 },
  small: { w: 1100, h: 620 },
  phone: { w: 390, h: 844, ua: ANDROID_UA },
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const patches = () => page.evaluate(() => (window.__tasksPatches || []).map(b => JSON.stringify(b)));
    const card = (id) => page.locator(tid(`req-card-${id}`)).first();
    const menuItems = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="task-menu"] [role="menuitem"]')].map(e => ({ id: e.getAttribute('data-testid'), checked: e.getAttribute('aria-checked'), disabled: e.getAttribute('aria-disabled') })));
    const openMenu = async (id) => {
      if (!V.ua) await card(id).click({ button: 'right', position: { x: 40, y: 12 } });
      else {
        const b = await card(id).boundingBox();
        await page.mouse.move(b.x + 40, b.y + 12);
        await page.mouse.down();
        await page.waitForTimeout(800);
        await page.mouse.up();
      }
      await page.locator(tid('task-menu')).first().waitFor({ timeout: 4000 });
      await page.waitForTimeout(250);
    };
    const closeMenu = async () => { if (await page.locator(tid('task-menu')).count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } if (await page.locator(tid('task-menu')).count()) { await page.locator(tid('task-menu-scrim')).first().click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(300); } };
    const guarded = async (step, fn) => {
      try { await fn(); } catch (e) {
        failures++;
        console.log(JSON.stringify({ where, step, error: String(e).split('\n')[0] }));
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${step}.png` }).catch(() => {});
        await closeMenu().catch(() => {});
      }
    };
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(fixture);
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.waitForTimeout(400);
      const seg = page.locator(tid('tasks-view-board')).first();
      if (await seg.count() && await seg.isVisible()) { await (V.ua ? seg.tap() : seg.click()); await page.waitForTimeout(300); }
      await card('r1').waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);

      if (V.ua) {
        await guarded('phone', async () => {
          await openMenu('r1');
          const items = await menuItems();
          await shot('menu');
          record(where, 'phone: long-press menu keeps 改状态… / 改优先级…, no inline priority rows', {
            quick: items.some(i => i.id === 'task-menu-status') && items.some(i => i.id === 'task-menu-priority'),
            noInline: !items.some(i => /^task-menu-priority-/.test(i.id)),
          }, { items: items.map(i => i.id).join(',') });
          await closeMenu();
        });
      } else {
        await guarded('menu', async () => {
          await openMenu('r1');
          const items = await menuItems();
          const pri = items.filter(i => /^task-menu-priority-/.test(i.id));
          const box = await page.locator(tid('task-menu')).first().boundingBox();
          await shot('menu');
          record(where, 'menu: 4 priority rows, current ✓ and inert, others clickable, menu in view', {
            four: pri.map(i => i.id.replace('task-menu-priority-', '')).join() === PRI.join(),
            currentChecked: pri.find(i => i.id === 'task-menu-priority-normal')?.checked === 'true' && pri.find(i => i.id === 'task-menu-priority-normal')?.disabled === 'true',
            othersOn: pri.filter(i => i.id !== 'task-menu-priority-normal').every(i => i.disabled !== 'true'),
            moveKept: items.filter(i => /^task-menu-move-/.test(i.id)).length === 3,
            inView: !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= V.w + 0.5 && box.y + box.height <= V.h + 0.5,
          }, { items: items.map(i => `${i.id}${i.checked === 'true' ? '✓' : ''}${i.disabled === 'true' ? '(off)' : ''}`).join(','), menu: box && `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` });
        });
        await guarded('patch', async () => {
          const before = (await patches()).length;
          if (!(await page.locator(tid('task-menu')).count())) await openMenu('r1');
          await page.locator(tid('task-menu-priority-high')).first().click();
          await page.waitForTimeout(600);
          const sent = (await patches()).slice(before);
          const badge = await card('r1').innerText();
          await shot('after-patch');
          record(where, 'patch: clicking P0 sends exactly {"priority":"high"} and the card shows P0', {
            body: sent.length === 1 && sent[0] === '{"priority":"high"}',
            closed: (await page.locator(tid('task-menu')).count()) === 0,
            badge: /P0/.test(badge),
          }, { sent: sent.join(' '), badge: badge.replace(/\s+/g, ' ').slice(0, 60) });
        });
        await guarded('locked', async () => {
          const before = (await patches()).length;
          await openMenu('r2');
          const pri = (await menuItems()).filter(i => /^task-menu-priority-/.test(i.id));
          await page.locator(tid('task-menu-priority-high')).first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(400);
          await shot('locked');
          record(where, 'locked: participant card — all priority rows disabled, nothing sent', {
            listed: pri.length === 4,
            allOff: pri.every(i => i.disabled === 'true'),
            nothingSent: (await patches()).length === before,
          });
          await closeMenu();
        });
        await guarded('list', async () => {
          const list = page.locator(tid('tasks-view-list')).first();
          if (await list.count()) { await list.click(); await page.waitForTimeout(500); }
          const row = page.getByText('示例任务一:可改', { exact: false }).first();
          await row.click({ button: 'right' });
          await page.locator(tid('task-menu')).first().waitFor({ timeout: 4000 });
          await page.waitForTimeout(250);
          const pri = (await menuItems()).filter(i => /^task-menu-priority-/.test(i.id));
          await shot('list-menu');
          record(where, 'list view: right-click a row → same menu with the 4 priority rows (current = P0 after the patch)', {
            four: pri.length === 4,
            currentHigh: pri.find(i => i.id === 'task-menu-priority-high')?.checked === 'true',
          }, { items: pri.map(i => `${i.id}${i.checked === 'true' ? '✓' : ''}`).join(',') });
          await closeMenu();
        });
      }
      record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3).join(' | ') || '-' });
    } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL.png` }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log(failures ? `\n${failures} check group(s) failed` : `\nall ${rows.length} check groups passed`);
process.exit(failures ? 1 : 0);
