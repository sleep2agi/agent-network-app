// 新建任务带参与人 + 左栏「我参与的」—— 点真按钮、量真框。Placeholder data only, served in-page by the Tauri stub in
// tests/test-layout-sweep/harness.mjs (no hub process, no port, no HOME touched).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-task-participants/drive.mjs
//
// desktop 1440×900 (Tauri stub ⇒ mouse) and phone 390×844 (Android UA ⇒ touch), light + dark:
//   sidebar   desktop: 「我参与的」 sits right under 「我负责的」 (same x / width / height, no gap jump); counts 我负责的 2,
//             我参与的 2 (owner-only vs participant-only); click it → exactly the two cards I participate in
//   field     the create dialog has 参与人 right under 负责人 / 负责 Agent: desktop = an input row with the same x / width /
//             height as 负责人; phone = chips + an 「添加参与人」 button ≥ 44 tall inside the sheet, no horizontal overflow
//   request   pick 示例成员甲 in the shared people picker → chip shows → 添加 → the POST body carries
//             participants: [{kind:'user',id:'u_a'}] (and the picker lists humans only — no 示例-A node row)
//   phone     tapping a chip removes it (no extra layer)
// Prints a measurement table. Exit 1 when any check fails or a viewport could not be opened.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA, zeroSizeText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const fixture = () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const me = { kind: 'user', id: 'u_tester' }, ua = { kind: 'user', id: 'u_a' }, ub = { kind: 'user', id: 'u_b' };
  const R = (id, seq, name, o) => ({ id, seq, name, priority: 'normal', assignee: '', column: 'doing', owner: null, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(1), description: '', checklist: [], tags: [], parent_id: null, ...o });
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [
      R('r1', 11, '示例任务一:我负责', { owner: me }),
      R('r2', 12, '示例任务二:我参与', { owner: ua, participants: [me] }),
      R('r3', 13, '示例任务三:负责又参与', { owner: me, participants: [me, ub] }),
      R('r4', 14, '示例任务四:与我无关', { owner: ub, participants: [ua] }),
    ],
    projects: [],
    people: [
      { kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' },
      { kind: 'user', id: 'u_a', networkId: 'net-sweep', name: '示例成员甲' },
      { kind: 'user', id: 'u_b', networkId: 'net-sweep', name: '示例成员乙' },
      { kind: 'node', id: 'n_sweep_a', networkId: 'net-sweep', name: '示例-A' },
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
const bb = async (page, id) => { const l = page.locator(`[data-testid="${id}"]`).first(); return (await l.count()) ? l.boundingBox() : null; };
const measure = (where, el, b) => { if (b) measures.push({ where, el, x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }); };

const VIEWPORTS = {
  desktop: { w: 1440, h: 900, ua: undefined },
  phone: { w: 390, h: 844, ua: ANDROID_UA },
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    const press = (loc) => (V.ua ? loc.tap() : loc.click());
    let step = 'load';
    try {
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(fixture);
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.locator('[data-testid="tasks-view"]').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);

      if (name === 'desktop') {
        step = 'sidebar';
        const mine = await bb(page, 'task-side-mine'), joined = await bb(page, 'task-side-participating'), un = await bb(page, 'task-side-unassigned');
        measure(where, 'sidebar 我负责的', mine); measure(where, 'sidebar 我参与的', joined); measure(where, 'sidebar 未分配', un);
        const count = async (id) => (await page.locator(`[data-testid="${id}"]`).first().innerText()).split('\n').map(s => s.trim()).filter(Boolean);
        const mineText = mine ? await count('task-side-mine') : [], joinedText = joined ? await count('task-side-participating') : [];
        record(where, 'sidebar', {
          present: !!joined,
          rightUnderMine: !!(mine && joined && un) && joined.y > mine.y && joined.y < un.y,
          sameColumn: !!(mine && joined) && Math.abs(mine.x - joined.x) <= 0.5 && Math.abs(mine.width - joined.width) <= 0.5 && Math.abs(mine.height - joined.height) <= 0.5,
          evenSpacing: !!(mine && joined && un) && Math.abs((joined.y - mine.y) - (un.y - joined.y)) <= 0.5,
          // innerText also carries the icon glyph in front; the label and the count are the last two lines
          mineCount2: mineText.slice(-2).join('|') === '我负责的|2',
          joinedCount2: joinedText.slice(-2).join('|') === '我参与的|2',
        }, { mineText: mineText.join('|'), joinedText: joinedText.join('|') });
        if (joined) {
          await page.locator('[data-testid="task-side-participating"]').first().click();
          await page.waitForTimeout(400);
          const shown = await page.locator('[data-testid^="req-row-"]:not([data-testid^="req-row-check-"]), [data-testid^="req-card-r"]').evaluateAll(els => els.filter(e => e.getClientRects().length).map(e => e.getAttribute('data-testid').replace(/^req-(row|card)-/, '')));
          const ids = [...new Set(shown)].sort().join();
          record(where, 'participating filter', { onlyMine: ids === 'r2,r3', selected: (await page.locator('[data-testid="task-side-participating"][aria-selected="true"]').count()) === 1 }, { ids });
          if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-sidebar-participating.png` });
          await page.locator('[data-testid="task-side-all"]').first().click();
          await page.waitForTimeout(200);
        }
      }

      step = 'open dialog';
      await press(page.locator('[data-testid="req-new"]').first());
      await page.locator('[data-testid="req-create"]').first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      const panel = await bb(page, 'req-create');
      const owner = await bb(page, 'req-assignee'), agent = await bb(page, 'req-assignee-agent');
      const group = await bb(page, 'req-create-participants');
      const field = await bb(page, name === 'desktop' ? 'req-participants' : 'req-participants-add');
      measure(where, 'dialog panel', panel); measure(where, '负责人 field', owner); measure(where, '负责 Agent field', agent);
      measure(where, '参与人 group', group); measure(where, name === 'desktop' ? '参与人 field' : '参与人 添加 button', field);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const checks = {
        present: !!group && !!field,
        belowRoles: !!(group && agent) && group.y > agent.y + agent.height,
        insidePanel: !!(panel && group) && group.x >= panel.x && group.x + group.width <= panel.x + panel.width + 0.5,
        noOverflowX: !overflowX,
      };
      if (name === 'desktop') {
        checks.sameXAsOwner = !!(owner && field) && Math.abs(owner.x - field.x) <= 0.5;
        checks.sameWidthAsOwner = !!(owner && field) && Math.abs(owner.width - field.width) <= 0.5;
        checks.sameHeightAsOwner = !!(owner && field) && Math.abs(owner.height - field.height) <= 0.5;
      } else {
        checks.sheetAtBottom = !!panel && Math.abs(panel.y + panel.height - V.h) <= 1;
        checks.addTarget44 = !!field && field.height >= 44;
        checks.addLeftAligned = !!(owner && field) && Math.abs(owner.x - field.x) <= 0.5;
      }
      record(where, 'field', checks);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-create-empty.png` });

      step = 'pick';
      await press(page.locator(`[data-testid="${name === 'desktop' ? 'req-participants' : 'req-participants-add'}"]`).first());
      await page.locator('[data-testid="people-confirm"]').first().waitFor({ timeout: 5000 });
      const nodeRow = await page.locator('[data-testid="person-node:n_sweep_a"]').count();
      const humanRow = await page.locator('[data-testid="person-user:u_a"]').count();
      // owner 10-07:参与人可以是 Agent —— 人类 / Agent 两组都在。
      record(where, 'picker', { listsAgents: nodeRow === 1 && humanRow === 1 && (await page.locator('[data-testid="people-group-h:node"]').count()) === 1 });
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-picker.png` });
      await press(page.locator('[data-testid="person-user:u_a"]').first());
      await press(page.locator('[data-testid="people-confirm"]').first());
      await page.waitForTimeout(300);
      const chip = await bb(page, 'req-participants-chip-u_a');
      const fieldAfter = await bb(page, name === 'desktop' ? 'req-participants' : 'req-participants-add');
      measure(where, '参与人 chip', chip); measure(where, name === 'desktop' ? '参与人 field (1 picked)' : '参与人 添加 button (1 picked)', fieldAfter);
      const chipChecks = { chip: !!chip };
      if (name === 'desktop') {
        chipChecks.chipInsideField = !!(chip && fieldAfter) && chip.x >= fieldAfter.x && chip.x + chip.width <= fieldAfter.x + fieldAfter.width && chip.y >= fieldAfter.y && chip.y + chip.height <= fieldAfter.y + fieldAfter.height;
        chipChecks.fieldHeightUnchanged = !!(fieldAfter && field) && Math.abs(fieldAfter.height - field.height) <= 0.5;
        chipChecks.chipCentred = !!(chip && fieldAfter) && Math.abs((chip.y + chip.height / 2) - (fieldAfter.y + fieldAfter.height / 2)) <= 1;
      } else {
        chipChecks.chipTarget36 = !!chip && chip.height >= 36;
        chipChecks.chipAndAddShareCentre = !!(chip && fieldAfter) && Math.abs((chip.y + chip.height / 2) - (fieldAfter.y + fieldAfter.height / 2)) <= 1;
      }
      record(where, 'picked', chipChecks);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-create-picked.png` });

      if (name === 'phone') {
        step = 'remove chip';
        await press(page.locator('[data-testid="req-participants-chip-u_a"]').first());
        await page.waitForTimeout(200);
        record(where, 'tap chip removes', { gone: (await page.locator('[data-testid="req-participants-chip-u_a"]').count()) === 0 });
        await press(page.locator('[data-testid="req-participants-add"]').first());
        await page.locator('[data-testid="people-confirm"]').first().waitFor({ timeout: 5000 });
        await press(page.locator('[data-testid="person-user:u_a"]').first());
        await press(page.locator('[data-testid="people-confirm"]').first());
        await page.waitForTimeout(300);
      }

      step = 'submit';
      await page.locator('[data-testid="req-name"]').first().fill('示例新任务:带参与人');
      await press(page.locator('[data-testid="req-add"]').first());
      await page.waitForFunction(() => (window.__tasksCreates || []).length > 0, null, { timeout: 5000 });
      const body = await page.evaluate(() => window.__tasksCreates[window.__tasksCreates.length - 1]);
      await page.locator('[data-testid="req-create"]').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      record(where, 'request', {
        participants: JSON.stringify(body.participants) === JSON.stringify([{ kind: 'user', id: 'u_a' }]),
        noOwnerSent: body.owner === undefined,
        dialogClosed: (await page.locator('[data-testid="req-create"]').count()) === 0,
      }, { participants: JSON.stringify(body.participants) });

      const blank = await zeroSizeText(page);
      record(where, 'text', { noZeroSizeText: blank.length === 0, noPageErrors: errors.length === 0 }, blank.length || errors.length ? { blank: blank.slice(0, 5), errors: errors.slice(0, 3) } : {});
    } catch (e) {
      record(where, `crashed at ${step}`, { ran: false }, { error: String(e.message || e).split('\n')[0] });
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAILED-${step.replace(/\s+/g, '-')}.png` }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
web.close();

console.log('\nmeasurements (CSS px):');
console.table(measures);
console.log(`\n${rows.length - failures}/${rows.length} checks rows passed`);
process.exit(failures || rows.length === 0 ? 1 : 0);
