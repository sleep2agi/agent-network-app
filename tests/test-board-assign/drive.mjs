// 从看板直接指派 —— 点真按钮、量真框、截下真请求体。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export. No workflow runs any tests/*/drive.mjs — only the
// requirement-details Docker suite is in unit-tests.yml — so run this by hand when touching the board / picker.
// (Refreshed 2026-10-02: it had been red since #637 / #646 changed the desktop pickers and nobody noticed.)
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-board-assign/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   menu        right-click (desktop) / long-press (phone) a card: 「指派负责人…」「设置参与人…」 right under 查看详情,
//               inside the menu and the viewport; on a participant's card (viewer_can.edit=false) both are aria-disabled
//   owner       指派负责人… → the same people picker as create/detail, humans only on a two-role hub → PATCH body
//               exactly {"owner":{kind,id}}, card shows the new owner without opening the detail
//   avatars     tapping the participant avatars on an editable card opens 设置参与人 (humans only; desktop = the anchored
//               dropdown under the avatars, #646; phone = the centred panel) → PATCH body
//               exactly {"participants":[…]} with the existing Agent participant kept; on a read-only card it opens
//               the detail instead and sends nothing
//   bulk        desktop: Ctrl-click three cards (one read-only) → 「指派负责人…」 → PATCH only for the two editable
//               ones, bar says 「跳过 1 个(无权修改)」
//   priority    (owner 10-01) 优先级 sits right under 状态, above 负责人 and the ~40-line 描述, inside the first screen;
//               on a participant card the order is 状态 → 检查项 → 优先级 → 负责人 → 描述
//   detail      参与人 sits right under 负责人 / 负责 Agent (no 更多 needed, above the fold); changing 负责人 (desktop:
//               anchored dropdown, a click applies it; phone: panel + 确定) saves at once (PATCH {"owner"}), 「已保存」
//               shows, 保存修改 stays disabled
// Prints a measurement table. Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' }, bot = { kind: 'node', id: 'n_demo' };
  // ~40 行的描述:优先级必须在它上面、打开详情第一屏就看得到(owner 10-01)。
  const longDesc = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行:示例描述,用来把详情撑长。`).join('\n');
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'pool', owner: ua, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '示例描述', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 31, '示例任务一:可指派', { participants: [ua, bot] }),
      R('r2', 32, '示例任务二:我参与', { participants: [me], description: longDesc, checklist: [{ id: 'i1', text: '示例检查项', done: false }], viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] } }),
      R('r3', 33, '示例任务三:没有参与人', { owner: null, description: longDesc }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'user', id: 'u_b', networkId: 'net-sweep', name: '示例成员乙' },
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
    // Picker rows only: `person-<kind>:<id>`. The rows' name / subtitle texts carry `person-name-…` / `person-sub-…` ids
    // (added after this drive was written), which a bare ^="person-" prefix also matched — and failed humansOnly.
    const pickerRows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="person-"]')].map(e => e.getAttribute('data-testid')).filter(id => /^person-(user|node):/.test(id)));
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
      await shot('board');

      await guarded('menu r1', async () => {
        await openMenu('r1');
        const menu = await bb(page, tid('task-menu'));
        const openItem = await bb(page, tid('task-menu-open')), mOwner = await bb(page, tid('task-menu-assign-owner')), mPart = await bb(page, tid('task-menu-assign-participants'));
        // 手机菜单的三个「移到」换成了「改状态…」(test-phone-quick-status)。
        const firstMove = await bb(page, tid(V.ua ? 'task-menu-status' : 'task-menu-move-pool'));
        measure(where, '菜单', menu); measure(where, '菜单 指派负责人…', mOwner); measure(where, '菜单 设置参与人…', mPart);
        record(where, 'menu items (editable card)', {
          present: !!mOwner && !!mPart,
          order: !!(openItem && mOwner && mPart && firstMove) && openItem.y < mOwner.y && mOwner.y < mPart.y && mPart.y < firstMove.y,
          insideMenu: inside(mOwner, menu) && inside(mPart, menu),
          menuInView: inView(menu, V),
          enabled: (await dis('task-menu-assign-owner')) !== 'true' && (await dis('task-menu-assign-participants')) !== 'true',
          rowHeight: !!mOwner && mOwner.height >= (V.ua ? 44 : 28),
          // innerText carries the icon glyph on its own line first; the label is the last line.
          labels: (await label('task-menu-assign-owner')) === '指派负责人…' && (await label('task-menu-assign-participants')) === '设置参与人…',
      });
      await shot('menu');

      });
      await guarded('assign owner', async () => {
        await press(page.locator(tid('task-menu-assign-owner')).first());
        await page.locator(tid('people-confirm')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        const ownerRows = await pickerRows();
        measure(where, '负责人选择器 确定', await bb(page, tid('people-confirm')));
        await shot('picker-owner');
        await press(page.locator(tid('person-user:u_b')).first());
        await press(page.locator(tid('people-confirm')).first());
        await page.waitForTimeout(600);
        const afterOwner = await patches();
        const r1Text = await card('r1').innerText();
        record(where, 'owner from card menu', {
          humansOnly: ownerRows.length > 0 && ownerRows.every(r => r.startsWith('person-user:')),
          body: afterOwner.length === 1 && afterOwner[0] === '{"owner":{"kind":"user","id":"u_b"}}',
          cardShowsOwner: V.ua ? true : r1Text.includes('示例成员乙'),
          noDetailOpened: (await page.locator(tid('req-detail')).count()) === 0,
        }, { bodies: afterOwner.join(' | '), ownerRows: ownerRows.join(',') });
        await shot('after-owner');

      });
      await guarded('menu r2 locked', async () => {
        await openMenu('r2');
        record(where, 'menu items (participant card = locked)', {
          present: (await page.locator(tid('task-menu-assign-owner')).count()) === 1,
          disabled: (await dis('task-menu-assign-owner')) === 'true' && (await dis('task-menu-assign-participants')) === 'true',
      });
      await shot('menu-locked');
      await closeMenu();

      });
      await guarded('avatars r1', async () => {
        const stack = page.locator(`${tid('req-card-r1')} ${tid('task-participants')}`).first();
        const stackBox = await bb(page, `${tid('req-card-r1')} ${tid('task-participants')}`);
        measure(where, '卡片参与人头像', stackBox);
        await press(stack);
        await page.locator(tid('people-confirm')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        // Desktop (#646): the avatars open the anchored dropdown under the avatar group (multi-select, 确定 in its footer);
        // phone: the centred panel. Both are the same RequirementPeoplePicker.
        const partSurface = (await page.locator(tid('people-dropdown')).count()) ? 'dropdown' : (await page.locator(tid('people-panel')).count()) ? 'panel' : 'none';
        const partRows = await pickerRows();
        await shot('picker-participants');
        await press(page.locator(tid('person-user:u_b')).first());
        await press(page.locator(tid('people-confirm')).first());
        await page.waitForTimeout(600);
        const afterPart = await patches();
        record(where, 'participants from avatar tap', {
          stackInsideCard: inside(stackBox, await bb(page, tid('req-card-r1'))),
          surface: partSurface === (V.ua ? 'panel' : 'dropdown'),
          humansOnly: partRows.length > 0 && partRows.every(r => r.startsWith('person-user:')),
          body: afterPart.length === 2 && afterPart[1] === '{"participants":[{"kind":"user","id":"u_a"},{"kind":"user","id":"u_b"},{"kind":"node","id":"n_demo"}]}',
          noDetailOpened: (await page.locator(tid('req-detail')).count()) === 0,
        }, { surface: partSurface, bodies: afterPart.join(' | '), rows: partRows.join(',') });

      });
      await guarded('avatars r2', async () => {
        await press(page.locator(`${tid('req-card-r2')} ${tid('task-participants')}`).first());
        await page.locator(tid('req-detail-read-only')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        record(where, 'read-only avatars open detail', { detail: true, noPicker: (await page.locator(tid('people-confirm')).count()) === 0, noRequest: (await patches()).length === 2 });
        // #701 参与人的卡(只可改状态和检查项):头部状态 / 优先级 pill(优先级只读)· 属性只画值 · 检查项可勾。
        const pStatus = await bb(page, tid('req-status-pill')), pPrio = await bb(page, tid('req-priority-pill')), pCheck = await bb(page, tid('req-checklist-wrap'));
        const pOwner = await bb(page, tid('req-locked-row-owner')), pDesc = await bb(page, tid('req-locked-row-description'));
        measure(where, '参与人详情 优先级 pill', pPrio); measure(where, '参与人详情 描述(只读)', pDesc);
        record(where, 'partial detail: status + priority pills in the header, locked values below, checklist reachable', {
          pillsInHeader: !!(pStatus && pPrio) && Math.abs(pStatus.y - pPrio.y) <= 1 && !!pOwner && pStatus.y < pOwner.y,
          priorityLocked: (await page.locator(tid('req-priority-pill')).first().getAttribute('aria-disabled')) === 'true',
          checklistShown: !!pCheck,
          descriptionLocked: !!pDesc,
          firstScreen: !!pPrio && pPrio.y + pPrio.height <= V.h,
        });
        await shot('detail-partial');
        await closeDetail();
        if (name === 'phone') await toBoard();

      });

      if (name === 'desktop') await guarded('bulk', async () => {
          for (const id of ['r1', 'r2', 'r3']) { await card(id).click({ modifiers: ['Control'], position: { x: 40, y: 12 } }); await page.waitForTimeout(150); }
          await page.locator(tid('task-bulk-owner')).first().waitFor({ timeout: 4000 });
          const bar = await bb(page, tid('task-bulk-bar')), bOwner = await bb(page, tid('task-bulk-owner'));
          measure(where, '批量条', bar); measure(where, '批量 指派负责人…', bOwner);
          await shot('bulk-bar');
          await page.locator(tid('task-bulk-owner')).first().click();
          await page.locator(tid('task-bulk-menu-owner-opt-user:u_a')).first().waitFor({ timeout: 4000 });
          const optIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="task-bulk-menu-owner-opt-"]')].map(e => e.getAttribute('data-testid')));
          await shot('bulk-menu');
          await page.locator(tid('task-bulk-menu-owner-opt-user:u_a')).first().click();
          await page.waitForTimeout(800);
          const bulkBodies = (await patches()).slice(2);
          const barText = (await page.locator(tid('task-bulk-count')).first().innerText().catch(() => '')).trim();
          record(where, 'bulk owner', {
            buttonInsideBar: inside(bOwner, bar),
            humansOnly: optIds.every(id => /opt-(none|user:)/.test(id)),
            // r1 is already 示例成员甲 → u_b after the menu step; r3 has no owner; r2 is read-only → skipped.
            twoRequests: bulkBodies.length === 2 && bulkBodies.every(b => b === '{"owner":{"kind":"user","id":"u_a"}}'),
            skippedShown: barText.includes('跳过 1 个'),
          }, { barText, bodies: bulkBodies.join(' | ') });
          await shot('bulk-done');
          await page.waitForTimeout(2800);
      });

      await guarded('detail r3', async () => {
        const before = (await patches()).length;
        await press(card('r3'));
        await page.locator(tid('req-edit-owner')).first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
        const ownerF = await bb(page, tid('req-edit-owner')), agentF = await bb(page, tid('req-edit-owner-agent'));
        const partRow = await bb(page, tid('req-participants-row')), dueF = await bb(page, tid('req-edit-due')), moreT = await bb(page, tid('req-more-toggle'));
        measure(where, '详情 负责人', ownerF); measure(where, '详情 负责 Agent', agentF); measure(where, '详情 参与人行(挪出更多)', partRow); measure(where, '详情 预计完成', dueF); measure(where, '详情 更多', moreT);
        const moreOpen = (await page.locator(tid('req-more')).count()) > 0;
        // #701:优先级是头部的 pill(和状态 pill 同一行),永远在第一屏、在描述之上。
        const prio = await bb(page, tid('req-priority-pill')), desc = await bb(page, tid('req-description'));
        const statusSeg = await bb(page, tid('req-status-pill'));
        measure(where, '详情 优先级 pill', prio); measure(where, '详情 描述(40 行)', desc);
        record(where, 'detail: 优先级 pill next to the status pill, above the long 描述, first screen', {
          present: !!prio,
          nextToStatus: !!(prio && statusSeg) && Math.abs(prio.y - statusSeg.y) <= 1 && prio.x > statusSeg.x,
          aboveDescription: !!(prio && desc) && prio.y < desc.y,
          firstScreen: !!prio && prio.y + prio.height <= V.h,
          notInMore: (await page.locator(`${tid('req-more')} ${tid('req-priority-pill')}`).count()) === 0,
        });
        record(where, 'detail: 参与人 under 负责人 / 负责 Agent', {
          present: !!partRow,
          underRoles: !!(partRow && agentF && ownerF) && partRow.y >= agentF.y + agentF.height && agentF.y > ownerF.y,
          aboveDue: !!(partRow && dueF) && partRow.y + partRow.height <= dueF.y + 0.5,
          notInMore: (await page.locator(`${tid('req-more')} ${tid('req-participants-row')}`).count()) === 0,
          aboveFold: !!partRow && partRow.y + partRow.height <= V.h,
        }, { moreOpen });
        await shot('detail');
        await press(page.locator(tid('req-edit-owner')).first());
        // Desktop (#637): the owner picker is the anchored dropdown under the field — single choice, a click applies it,
        // there is no 确定. Phone: the centred panel with 确定.
        if (V.ua) {
          await page.locator(tid('people-confirm')).first().waitFor({ timeout: 5000 });
          await press(page.locator(tid('person-user:u_b')).first());
          await press(page.locator(tid('people-confirm')).first());
        } else {
          await page.locator(tid('people-dropdown')).first().waitFor({ timeout: 5000 });
          await press(page.locator(tid('person-user:u_b')).first());
        }
        await page.waitForTimeout(700);
        const detailBodies = (await patches()).slice(before);
        const status = await bb(page, tid('req-saved-toast'));
        measure(where, '详情 已保存', status);
        record(where, 'detail owner saves immediately', {
          body: detailBodies.length === 1 && detailBodies[0] === '{"owner":{"kind":"user","id":"u_b"}}',
          saved: (await page.locator(tid('req-saved-toast')).first().innerText().catch(() => '')).includes('已保存'),
          noSaveButton: (await page.locator(tid('req-edit-save')).count()) === 0,
          toastOnScreen: !!status && status.y + status.height <= V.h,
        }, { bodies: detailBodies.join(' | ') });
        await shot('detail-owner-saved');
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
