// 任务页审计 M8 / M9 / L11 —— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-people-picker/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   filter   头部「负责人」筛选:段标题「人」在「Agent」上面,「我」是第一行且在「人」段里,所有节点在「Agent」段里,
//            未分配最后;弹层在视口内
//   owner    卡片菜单「指派负责人…」:第一行是我、名字带「（我）」;副标题是「成员」不是「人类 · u_…」;
//            搜索 u_b 时那行副标题才带 id
//   partic   点卡片参与人头像 → 设置参与人:标题行右边有「加我」(同一行、在面板内),点了我被勾上、按钮消失
//   detail   分两个角色的 Hub:详情负责人字段只写名字,不再跟「（人类）」
// Each step runs on its own, so a pre-change export shows every red, not just the first. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' }, ub = { kind: 'user', id: 'u_b' };
  const bot = { kind: 'node', id: 'n_demo' }, bot2 = { kind: 'node', id: 'n_demo2' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  // 节点任务多、我只有一张:旧的按数目排序会把「我」排到节点后面。
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 41, '示例任务一', { owner: ua, agent_owner: bot, participants: [ua] }),
      R('r2', 42, '示例任务二', { owner: ub, agent_owner: bot }),
      R('r3', 43, '示例任务三:我负责', { owner: me, agent_owner: bot2 }),
      R('r4', 44, '示例任务四', { owner: ua, agent_owner: bot }),
      R('r5', 45, '示例任务五:未分配', { owner: null, agent_owner: null }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'user', id: 'u_b', networkId: 'net-sweep', name: '示例成员乙' },
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'node', id: 'n_demo', networkId: 'net-sweep', name: '示例-A' },
      { kind: 'node', id: 'n_demo2', networkId: 'net-sweep', name: '示例-B' },
    ],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
};

const rows = [];
const measures = [];
let failures = 0;
function record(where, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { where, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
const bb = async (page, sel) => { const l = page.locator(sel).first(); return (await l.count()) && await l.isVisible() ? l.boundingBox() : null; };
const measure = (where, el, b) => { if (b) measures.push({ where, el, x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }); };
const inside = (a, b) => !!(a && b) && a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
const inView = (b, V) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= V.w + 0.5 && b.y + b.height <= V.h + 0.5;

const VIEWPORTS = {
  desktop: { w: 1440, h: 900, ua: undefined },
  phone: { w: 390, h: 844, ua: ANDROID_UA },
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2, locale: 'zh-CN' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const press = (loc) => (V.ua ? loc.tap() : loc.click());
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-${n}.png` }); };
    const patches = () => page.evaluate(() => (window.__tasksPatches || []).map(b => JSON.stringify(b)));
    const card = (id) => page.locator(tid(`req-card-${id}`)).first();
    // Desktop: right-click (task-board-dom contextmenu). Phone: a held press on the card (Pressable onLongPress, 350 ms).
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
    const closeMenu = async () => { if (await page.locator(tid('task-menu')).count()) { await page.locator(tid('task-menu-scrim')).first().click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(300); } };
    const pickerRows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="person-"]')].map(e => e.getAttribute('data-testid')));
    const closeDetail = async () => {
      const close = page.locator(tid('req-detail-close')).first();
      if (await close.count() && await close.isVisible()) await press(close); else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    };
    const toBoard = async () => {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.waitForTimeout(300);
      const seg = page.locator(tid('tasks-view-board')).first();
      if (await seg.count() && await seg.isVisible()) { await press(seg); await page.waitForTimeout(300); }
    };
    // innerText carries the icon glyph on its own line first; the label is the last line. Missing element = ''/null, not a throw.
    const label = async (id) => ((await page.locator(tid(id)).count()) ? (await page.locator(tid(id)).first().innerText()) : '').split('\n').map(x => x.trim()).filter(Boolean).pop() ?? '';
    const dis = async (id) => ((await page.locator(tid(id)).count()) ? page.locator(tid(id)).first().getAttribute('aria-disabled') : null);
    // Each step runs on its own: a missing control fails that step and the next steps still run (evidence = every red, not the first).
    const guarded = async (name, fn) => {
      try { await fn(); } catch (e) {
        failures++;
        console.log(JSON.stringify({ where, step: name, error: String(e).split('\n')[0] }));
        if (OUT) await page.screenshot({ path: `${OUT}/${where.replace('/', '-')}-FAIL-${name.replace(/\s+/g, '-')}.png` }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        if (await page.locator(tid('people-cancel')).count()) await page.locator(tid('people-cancel')).first().click().catch(() => {});
        if (await page.locator(tid('task-menu')).count()) await closeMenu().catch(() => {});
        if (await page.locator(tid('req-detail')).count()) await closeDetail().catch(() => {});
        if (name !== 'load') await toBoard().catch(() => {});
      }
    };
    let step = 'load';
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(fixture);
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await toBoard();
      await page.locator(tid('tasks-view')).first().waitFor({ timeout: 15000 });
      await card('r1').waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);

      await guarded('filter', async () => {
        await press(page.locator(tid('task-filter-owner')).first());
        await page.locator(tid('task-filter-menu-owner')).first().waitFor({ timeout: 4000 });
        await page.waitForTimeout(300);
        const menu = await bb(page, tid('task-filter-menu-owner'));
        const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid="task-filter-menu-owner"] [data-testid^="task-filter-"]')].map(e => e.getAttribute('data-testid')).filter(id => id.startsWith('task-filter-opt-') || id.startsWith('task-filter-sec-')));
        const secP = await bb(page, tid('task-filter-sec-people')), secA = await bb(page, tid('task-filter-sec-agents'));
        const meRow = await bb(page, tid('task-filter-opt-user:u_tester'));
        measure(where, '筛选弹层', menu); measure(where, '段「人」', secP); measure(where, '我', meRow); measure(where, '段「Agent」', secA);
        const iP = order.indexOf('task-filter-sec-people'), iA = order.indexOf('task-filter-sec-agents');
        const opts = order.filter(id => id.startsWith('task-filter-opt-'));
        record(where, 'owner filter grouped, me first', {
          sections: iP >= 0 && iA > iP,
          meFirst: opts[0] === 'task-filter-opt-user:u_tester' && !!(meRow && secP) && meRow.y > secP.y,
          meLabel: (await page.locator(tid('task-filter-opt-user:u_tester')).first().innerText()).includes('（我）'),
          humansInPeople: order.slice(iP + 1, iA).every(id => !id.includes('node:')) && order.slice(iP + 1, iA).filter(id => id.includes('user:')).length === 3,
          agentsInAgents: iA >= 0 && order.slice(iA + 1).filter(id => id.includes('node:')).length === 2 && order.slice(iA + 1).every(id => !id.includes('user:')),
          unassignedLast: opts.at(-1) === 'task-filter-opt-none',
          inView: inView(menu, V),
        }, { order: order.map(id => id.replace('task-filter-', '')).join(',') });
        await shot('filter-owner');
        await press(page.locator(tid('task-filter-scrim')).first()).catch(() => page.keyboard.press('Escape'));
        await page.waitForTimeout(300);
      });

      await guarded('owner picker', async () => {
        await openMenu('r1');
        await press(page.locator(tid('task-menu-assign-owner')).first());
        await page.locator(tid('people-confirm')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        const ids = await pickerRows();
        const meRow = await bb(page, tid('person-user:u_tester')), aRow = await bb(page, tid('person-user:u_a'));
        measure(where, '负责人选择器 我', meRow); measure(where, '负责人选择器 甲', aRow);
        const meText = (await page.locator(tid('person-user:u_tester')).first().innerText()).replace(/\s+/g, ' ');
        const aText = (await page.locator(tid('person-user:u_a')).first().innerText()).replace(/\s+/g, ' ');
        await shot('picker-owner');
        await page.locator(tid('people-search')).first().fill('u_b');
        await page.waitForTimeout(300);
        const bText = (await page.locator(tid('person-user:u_b')).first().innerText()).replace(/\s+/g, ' ');
        await shot('picker-owner-search-id');
        record(where, 'owner picker rows', {
          meFirst: ids[0] === 'person-user:u_tester' && !!(meRow && aRow) && meRow.y < aRow.y,
          meLabel: meText.includes('tester（我）'),
          roleNotId: aText.includes('成员') && !aText.includes('u_a') && !aText.includes('人类'),
          idWhenSearched: bText.includes('u_b'),
        }, { meText, aText, bText });
        await press(page.locator(tid('people-cancel')).first());
        await page.waitForTimeout(300);
      });

      await guarded('participants add me', async () => {
        await press(page.locator(`${tid('req-card-r1')} ${tid('task-participants')}`).first());
        await page.locator(tid('people-confirm')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        const addMe = await bb(page, tid('people-add-me'));
        const panel = await bb(page, tid('people-panel'));
        const title = await page.getByText('选择参与人', { exact: true }).first().boundingBox().catch(() => null);
        measure(where, '参与人 加我', addMe); measure(where, '参与人 面板', panel); measure(where, '参与人 标题', title);
        await shot('picker-participants');
        // RN-web 不渲染 accessibilityState 的 aria-checked;说明里的「已选 N 人」又是看板传进来的已保存数。
        // 看行尾 ✓ 的不透明度(没选 = opacity 0)。
        const picked = () => page.evaluate(() => { const row = document.querySelector('[data-testid="person-user:u_tester"]'); const mark = row && [...row.querySelectorAll('*')].find(e => e.textContent === '✓' && !e.children.length); return mark ? getComputedStyle(mark).opacity === '1' : null; });
        const before = await picked();
        if (addMe) await press(page.locator(tid('people-add-me')).first());
        await page.waitForTimeout(300);
        const after = await picked();
        await shot('picker-participants-added');
        record(where, 'participants: 加我', {
          present: !!addMe,
          sameLineAsTitle: !!(addMe && title) && Math.abs((addMe.y + addMe.height / 2) - (title.y + title.height / 2)) <= 4,
          rightOfTitle: !!(addMe && title) && addMe.x >= title.x + title.width,
          insidePanel: inside(addMe, panel),
          tapTarget: !!addMe && addMe.height >= 32,
          checksMe: before === false && after === true,
          goneAfter: (await page.locator(tid('people-add-me')).count()) === 0,
        }, { before, after });
        await press(page.locator(tid('people-cancel')).first());
        await page.waitForTimeout(300);
      });

      await guarded('detail owner', async () => {
        await press(card('r3'));
        await page.locator(tid('req-edit-owner')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
        const f = await bb(page, tid('req-edit-owner'));
        measure(where, '详情 负责人', f);
        const text = (await page.locator(tid('req-edit-owner')).first().innerText()).replace(/\s+/g, ' ');
        await shot('detail-owner');
        record(where, 'detail owner has no 人类 suffix', { name: text.includes('tester'), noSuffix: !text.includes('人类') }, { text });
        await closeDetail();
      });

      record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.join(' | ') });
    } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, step, error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${step.replace(/\s+/g, '-')}.png` }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
web.close();
console.log('\nmeasurements (CSS px):');
console.table(measures);
console.log(failures ? `\n${failures} check group(s) failed` : `\nall ${rows.length} check groups passed`);
process.exit(failures ? 1 : 0);
