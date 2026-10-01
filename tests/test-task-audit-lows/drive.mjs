// 任务页审计 L10 / L12 / L13 —— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-audit-lows/drive.mjs
//
// desktop 1440×900 + a short desktop 1100×620 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   L10 card     r1 的参与人里我排第 4:卡片头像第一个是我、强调色描边,和别的头像一样高(卡片不长高);悬停名单标「我」
//   L12 detail   桌面详情:点负责人 → 锚在字段下面的下拉(不是居中面板),左边对齐字段、在视口内;打字筛、↓ 回车选中即关;
//                点「编辑参与人」→ 同样锚定,Esc 关;短窗口里靠底的字段 → 翻到上面、仍在视口内
//                手机:照旧居中面板(people-panel),没有下拉
//   L13 create   「仅相关任务」成员(项目带 viewer_can):新建对话框的项目下拉只有「无项目」+ 能编辑的项目;
//                全是只看授权时只剩「无项目」+ 一句说明
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
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' }, ub = { kind: 'user', id: 'u_b' }, uc = { kind: 'user', id: 'u_c' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  const allRo = new URLSearchParams(location.search).get('allRo') === '1';
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 51, '示例任务一:我是第 4 位参与人', { participants: [ua, ub, uc, me] }),
      R('r2', 52, '示例任务二:我不参与', { participants: [ua, ub] }),
    ],
    // 「仅相关任务」成员看到的项目:hub 只列授权给他的,只看的带 viewer_can.edit=false。
    projects: allRo
      ? [{ id: 'p_ro', name: '示例只看项目', color: '#dc2626', sort: 0, viewer_can: { edit: false } }]
      : [{ id: 'p_rw', name: '示例可编辑项目', color: '#16a34a', sort: 0, viewer_can: { edit: true } }, { id: 'p_ro', name: '示例只看项目', color: '#dc2626', sort: 1, viewer_can: { edit: false } }],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'user', id: 'u_b', networkId: 'net-sweep', name: '示例成员乙' },
      { kind: 'user', id: 'u_c', networkId: 'net-sweep', name: '示例成员丙' },
      { kind: 'node', id: 'n_demo', networkId: 'net-sweep', name: '示例-A' },
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
const inView = (b, V) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= V.w + 0.5 && b.y + b.height <= V.h + 0.5;

const VIEWPORTS = {
  desktop: { w: 1440, h: 900, ua: undefined },
  short: { w: 1100, h: 620, ua: undefined },
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
    const card = (id) => page.locator(tid(`req-card-${id}`)).first();
    const load = async (q = '') => {
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0${q}`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.waitForTimeout(300);
      const seg = page.locator(tid('tasks-view-board')).first();
      if (await seg.count() && await seg.isVisible()) { await press(seg); await page.waitForTimeout(300); }
      await card('r1').waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
    };
    const closeDetail = async () => {
      const close = page.locator(tid('req-detail-close')).first();
      if (await close.count() && await close.isVisible()) await press(close); else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    };
    const guarded = async (step, fn) => {
      try { await fn(); } catch (e) {
        failures++;
        console.log(JSON.stringify({ where, step, error: String(e).split('\n')[0] }));
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${step.replace(/\s+/g, '-')}.png` }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        if (await page.locator(tid('people-cancel')).count()) await page.locator(tid('people-cancel')).first().click().catch(() => {});
        if (await page.locator(tid('req-detail')).count()) await closeDetail().catch(() => {});
      }
    };
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(fixture);
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await load();

      if (name !== 'short') await guarded('L10 card', async () => {
        const avatars = page.locator(`${tid('req-card-r1')} ${tid('task-participant-avatar')}`);
        const first = await avatars.first().boundingBox(), second = await avatars.nth(1).boundingBox();
        const meMark = await page.locator(`${tid('req-card-r1')} [data-participant-me="1"]`).count();
        const meFirst = await avatars.first().getAttribute('data-participant-me');
        const colorsOf = await avatars.evaluateAll(els => els.map(e => getComputedStyle(e).borderTopColor));
        const accent = await page.evaluate(() => { const b = document.querySelector('[data-testid="req-new"]'); return b ? getComputedStyle(b).backgroundColor : ''; });
        const title = await page.locator(`${tid('req-card-r1')} ${tid('task-participants')}`).first().getAttribute('title');
        const otherMark = await page.locator(`${tid('req-card-r2')} [data-participant-me="1"]`).count();
        const c1 = await bb(page, tid('req-card-r1')), c2 = await bb(page, tid('req-card-r2'));
        measure(where, 'r1 我的头像', first); measure(where, 'r1 第 2 个头像', second); measure(where, '卡片 r1', c1); measure(where, '卡片 r2', c2);
        record(where, 'L10 card shows I participate', {
          meMarked: meMark === 1 && meFirst === '1',
          ringDiffers: colorsOf.length >= 2 && colorsOf[0] !== colorsOf[1],
          sameSize: !!(first && second) && Math.abs(first.height - second.height) <= 0.5 && Math.abs(first.width - second.width) <= 0.5,
          sameCardHeight: !!(c1 && c2) && Math.abs(c1.height - c2.height) <= 0.5,
          tooltipSaysMe: !!title && /tester \((我|me)\)/.test(title),
          notOnOtherCard: otherMark === 0,
        }, { colors: colorsOf.join(' / '), accent, title });
        await shot('L10-card');
      });

      await guarded('L12 detail owner', async () => {
        await press(card('r2'));
        await page.locator(tid('req-edit-owner')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
        const field = await bb(page, tid('req-edit-owner'));
        const detail = await bb(page, tid('req-detail'));
        await press(page.locator(tid('req-edit-owner')).first());
        await page.waitForTimeout(500);
        const drop = await bb(page, tid('people-dropdown'));
        const panel = await bb(page, tid('people-panel'));
        measure(where, '详情 负责人字段', field); measure(where, '负责人 下拉', drop); measure(where, '居中面板', panel); measure(where, '详情面板', detail);
        await shot('L12-owner-dropdown');
        if (V.ua) {
          record(where, 'L12 phone keeps the centred panel', { panel: !!panel, noDropdown: !drop });
          if (await page.locator(tid('people-cancel')).count()) await press(page.locator(tid('people-cancel')).first());
          await page.waitForTimeout(300);
          await closeDetail();
          return;
        }
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
        const checks = {
          dropdown: !!drop,
          noCentredPanel: !panel,
          leftAligned: !!(drop && field) && Math.abs(drop.x - field.x) <= 1,
          belowOrAbove: !!(drop && field) && (drop.y >= field.y + field.height - 0.5 || drop.y + drop.height <= field.y + 0.5),
          inView: inView(drop, V),
          searchFocused: focused === 'people-search',
        };
        // 打字就筛 → ↓ 一下 → 回车 = 选中第二个匹配,即刻生效并关闭。
        await page.keyboard.type('示例成员');
        await page.waitForTimeout(250);
        const shown = await page.evaluate(() => [...document.querySelectorAll('[data-testid="people-dropdown"] [data-testid^="person-user:"],[data-testid="people-dropdown"] [data-testid^="person-node:"]')].map(e => e.getAttribute('data-testid')));
        await shot('L12-owner-filtered');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        const after = (await page.locator(tid('req-edit-owner')).first().innerText()).replace(/\s+/g, ' ');
        record(where, 'L12 owner dropdown anchored + keyboard', { ...checks,
          typedFilters: shown.length === 3 && shown.every(id => ['person-user:u_a', 'person-user:u_b', 'person-user:u_c'].includes(id)),
          enterPicks: after.includes(shown[1] === 'person-user:u_b' ? '示例成员乙' : '?'),
          closedAfterPick: (await page.locator(tid('people-dropdown')).count()) === 0,
        }, { shown: shown.join(','), after, focused });

        // 参与人:同样锚定,Esc 关掉不改。
        const edit = page.locator(tid('edit-participants')).first();
        await edit.scrollIntoViewIfNeeded();
        await press(edit);
        await page.waitForTimeout(500);
        const editBox = await bb(page, tid('edit-participants')); // 量开着时的位置(成员表读完那行小字消失,按钮会上移)
        const pdrop = await bb(page, tid('people-dropdown'));
        const confirm = await bb(page, tid('people-confirm'));
        measure(where, '编辑参与人 按钮', editBox); measure(where, '参与人 下拉', pdrop); measure(where, '参与人 下拉 确定', confirm);
        await shot('L12-participants-dropdown');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        record(where, 'L12 participants dropdown anchored, Esc closes', {
          dropdown: !!pdrop,
          nearButton: !!(pdrop && editBox) && (Math.abs(pdrop.y - (editBox.y + editBox.height + 4)) <= 2 || Math.abs(pdrop.y + pdrop.height - (editBox.y - 4)) <= 2),
          inView: inView(pdrop, V),
          confirmInside: !!(pdrop && confirm) && confirm.y + confirm.height <= pdrop.y + pdrop.height + 0.5,
          escCloses: (await page.locator(tid('people-dropdown')).count()) === 0 && (await page.locator(tid('req-detail')).count()) > 0,
        });
        await closeDetail();
      });

      if (name !== 'short') await guarded('L13 create projects', async () => {
        await press(page.locator(tid('req-new')).first());
        await page.locator(tid('req-create')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        await page.locator(tid('req-project')).first().scrollIntoViewIfNeeded();
        await press(page.locator(tid('req-project')).first());
        await page.waitForTimeout(400);
        const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-project-menu-opt-"]')].map(e => e.getAttribute('data-testid').replace('req-project-menu-opt-', '')));
        await shot('L13-create-projects');
        record(where, 'L13 create lists editable projects only', { onlyEditable: opts.join() === 'none,p_rw' }, { opts: opts.join() });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        if (await page.locator(tid('req-project-menu-scrim')).count()) await press(page.locator(tid('req-project-menu-scrim')).first());
        await page.waitForTimeout(200);

        await load('&allRo=1');
        await press(page.locator(tid('req-new')).first());
        await page.locator(tid('req-create')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        await page.locator(tid('req-project')).first().scrollIntoViewIfNeeded();
        const note = await page.locator(tid('req-project-none-editable')).count();
        await shot('L13-create-none-editable');
        await press(page.locator(tid('req-project')).first());
        await page.waitForTimeout(400);
        const opts2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-project-menu-opt-"]')].map(e => e.getAttribute('data-testid').replace('req-project-menu-opt-', '')));
        record(where, 'L13 no editable project → 无项目 only', { onlyNone: opts2.join() === 'none', note: note === 1 }, { opts: opts2.join() });
      });

      record(where, 'page errors', { none: errors.length === 0 }, { errors: errors.join(' | ') });
    } catch (e) {
      failures++;
      console.log(JSON.stringify({ where, step: 'load', error: String(e).split('\n')[0] }));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-load.png` }).catch(() => {});
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
