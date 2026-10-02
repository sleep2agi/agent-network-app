// 编辑器全屏顶栏 —— 一行、同高、同中线,保存禁用一眼看得出(2026-10-02 #450 Vincent iPad 截图:规则文件全屏里
// 「重新读取」「保存」「退出全屏」不在一条线上,退出全屏低一截,三个按钮三种样子,保存禁用只是调淡)。量真框。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process,
// no port, no HOME touched). Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-editor-header/drive.mjs
//
// iPad 横屏 1366×1024 和截图里的 1024×724 窗口(iPad UA ⇒ 触屏)、桌面 1440×900(鼠标)、手机 390×844(安卓 UA),浅色 + 深色,三个全屏编辑器:
//   rules     节点页 → 规则文件 → 全屏:阅读/编辑 · 重新读取 · 保存 · 退出全屏 同一中线 ±1px、同高(±0.5px)、同圆角;
//             手机竖屏放不下一行:第一行 阅读/编辑 · 退出全屏、第二行 重新读取 · 保存,各自同一中线、四个同高。
//             打开时量一次,改字 → 保存(状态句「已保存到节点工作目录」出现,截图里就是这个状态)后再量一次。
//             保存禁用:aria-disabled、自身和祖先 opacity 都是 1、底色 ≠ 能点时的底色(改一个字后量)、字色 ≠ 能点时的字色
//   desc      任务详情 → 描述 ⤢:桌面全屏 阅读/编辑 · 退出全屏 同一中线、同高;触屏推入整页 ‹ · 标题 · 编辑/预览 同一中线
//   schedule  定时任务 → 任务内容 ⤢:桌面全屏 阅读/编辑 · 保存 · 退出全屏 同一中线、同高;触屏整页 编辑/预览 · 保存 同一中线、
//             同高;两处保存禁用都按上面的判据
// Each surface runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWPORTS = {
  ipad: { w: 1366, h: 1024, ua: IPAD_UA },
  // Vincent 截图的窗口(2048×1449 @2x):这个宽度下状态句挤不进一行,旧顶栏变两行、退出全屏掉下去。
  'ipad-window': { w: 1024, h: 724, ua: IPAD_UA },
  desktop: { w: 1440, h: 900 },
  phone: { w: 390, h: 844, ua: ANDROID_UA, narrow: true },
};

const RULES = '# 示例规则文件\n\n这是一份合成的规则文件,只用于布局测量。\n\n## 第一节\n\n- 条目甲\n- 条目乙\n';
const fixture = ({ rules }) => {
  window.__rulesFixture = rules;
  const at = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.__tasksFixture = {
    meId: 'u_tester',
    requirements: [{ id: 'r1', seq: 101, name: '示例任务', priority: 'normal', assignee: '', column: 'pool', owner: null, participants: [], agent_owner: null, project_id: null, due: '', createdAt: at(3000), updatedAt: at(5), description: '## 示例描述\n\n占位内容。', checklist: [], tags: [], parent_id: null }],
    projects: [],
    people: [{ kind: 'user', id: 'u_tester', networkId: 'net-sweep', name: 'tester' }],
    capabilities: ['agent_owner', 'description', 'checklist', 'requirement_seq'],
  };
};

const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};

// 一个控件的框 + 样式(独立量,不借被测代码):effOpacity = 自身到根的 opacity 连乘。
const measure = (loc) => loc.first().evaluate((el) => {
  const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
  const textEl = [...el.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.trim()) || el;
  return { y: b.y, h: b.height, cy: b.y + b.height / 2, radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor, fg: getComputedStyle(textEl).color, effOpacity: o, ariaDisabled: el.getAttribute('aria-disabled') };
}, null, { timeout: 4000 }).catch(() => null);
const spread = (ms) => ms.every(Boolean) ? r1(Math.max(...ms.map(m => m.cy)) - Math.min(...ms.map(m => m.cy))) : Infinity;
const hSpread = (ms) => ms.every(Boolean) ? r1(Math.max(...ms.map(m => m.h)) - Math.min(...ms.map(m => m.h))) : Infinity;
// 保存禁用的样子:不靠调淡(自身到根 opacity 都是 1),底色 / 字色都和能点时不一样。
const disabledLooksDisabled = (off, on) => !!off && !!on && (off.ariaDisabled === 'true') && off.effOpacity === 1 && off.bg !== on.bg && off.fg !== on.fg;

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name} ${V.w}x${V.h} ${theme}`;
    const newPage = async () => {
      const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
      const page = await ctx.newPage();
      // 固定数据先于 initScript:它在初始化时就读 window.__rulesFixture。
      await page.addInitScript(fixture, { rules: RULES });
      await page.addInitScript(initScript, { theme });
      await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
      await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
      await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
      return { ctx, page };
    };
    const press = (l) => (V.ua ? l.tap() : l.click());
    const surface = async (what, fn) => {
      const { ctx, page } = await newPage();
      try { await fn(page); } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${what}.png` }).catch(() => {});
      }
      await ctx.close();
    };

    await surface('rules', async (page) => {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'nodeDetail', alias: '示例-A' }));
      await press(page.getByText('规则文件', { exact: true }).first());
      await page.getByText('示例规则文件').first().waitFor({ timeout: 15000 });
      await press(page.getByLabel('全屏阅读规则文件').first());
      const modal = page.locator('[aria-modal="true"]').last();
      const header = modal.locator(tid('screen-header'));
      await header.getByLabel('退出全屏(Esc)').first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      const tablist = header.locator('[role="tablist"]').filter({ hasText: /^阅读编辑/ });
      const save = header.getByRole('button', { name: '保存', exact: true });
      const [mode, reload, saveOff, exit] = [await measure(tablist), await measure(header.getByRole('button', { name: '重新读取', exact: true })), await measure(save), await measure(header.getByLabel('退出全屏(Esc)'))];
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-rules.png` });
      // 改一个字 ⇒ 保存能点,量能点时的样子。
      await press(tablist.getByRole('tab', { name: '编辑' }).first());
      const ta = modal.locator('textarea').first();
      await ta.click(); await page.keyboard.press('End'); await page.keyboard.type('。');
      await page.waitForTimeout(300);
      const saveOn = await measure(save);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-rules-dirty.png` });
      // 保存 ⇒ 状态句「… 已保存到节点工作目录」出现。Vincent 的截图就是这个状态:状态句把工具条撑成两行,
      // 退出全屏按两行居中,低了一截。
      await press(save.first());
      await modal.getByText(/已保存/).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(300);
      const after = [await measure(tablist), await measure(header.getByRole('button', { name: '重新读取', exact: true })), await measure(save), await measure(header.getByLabel('退出全屏(Esc)'))];
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-rules-saved.png` });
      const all = [mode, reload, saveOff, exit];
      const lineOf = (ms) => V.narrow ? { row1: spread([ms[0], ms[3]]), row2: spread([ms[1], ms[2]]) } : { row: spread(ms) };
      const lines = { opened: lineOf(all), saved: lineOf(after) };
      record(where, 'rules', {
        found: all.every(Boolean) && after.every(Boolean),
        centre: [...Object.values(lines.opened), ...Object.values(lines.saved)].every(s => s <= 1),
        height: hSpread(all) <= 0.5 && hSpread(after) <= 0.5,
        radius: !!(reload && saveOff && exit) && reload.radius === saveOff.radius && saveOff.radius === exit.radius,
        saveDisabled: disabledLooksDisabled(saveOff, saveOn),
      }, { centre: lines, heights: all.map(m => m && r1(m.h)), heightsSaved: after.map(m => m && r1(m.h)), radii: [reload, saveOff, exit].map(m => m && m.radius), saveOff: saveOff && { bg: saveOff.bg, fg: saveOff.fg, opacity: r1(saveOff.effOpacity) }, saveOn: saveOn && { bg: saveOn.bg, fg: saveOn.fg } });
    });

    await surface('desc', async (page) => {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
      await page.waitForTimeout(500);
      const seg = page.locator(tid('tasks-view-board')).first();
      if (await seg.count() && await seg.isVisible()) { await press(seg); await page.waitForTimeout(300); }
      await press(page.locator(tid('req-card-r1')).first());
      const open = page.locator(`[role="button"]${tid('req-description-fullscreen')}`).first();
      await open.waitFor({ timeout: 8000 });
      await open.scrollIntoViewIfNeeded();
      await press(open);
      await page.waitForTimeout(600);
      let items, labels;
      if (await page.locator(tid('req-description-page-header')).count()) {
        labels = ['back', 'title', 'mode'];
        items = [await measure(page.locator(tid('req-description-page-back'))), await measure(page.locator(tid('req-description-page-title'))), await measure(page.locator(tid('req-description-page-mode')))];
        record(where, 'desc(page)', { found: items.every(Boolean), centre: spread(items) <= 1 }, { centre: spread(items), heights: items.map(m => m && r1(m.h)), labels });
      } else {
        labels = ['mode', 'exit'];
        items = [await measure(page.locator(tid('req-description-full-mode'))), await measure(page.locator(tid('req-description-full-close')))];
        record(where, 'desc(full)', { found: items.every(Boolean), centre: spread(items) <= 1, height: hSpread(items) <= 0.5 }, { centre: spread(items), heights: items.map(m => m && r1(m.h)), labels });
      }
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-desc.png` });
    });

    await surface('schedule', async (page) => {
      await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'scheduled' }));
      const detail = page.locator(tid('schedule-detail'));
      if (!(await detail.first().waitFor({ timeout: 6000 }).then(() => true, () => false))) await press(page.getByText('示例定时任务', { exact: true }).first());
      await detail.first().waitFor({ timeout: 10000 });
      const btn = page.locator(`[role="button"]${tid('schedule-content-fullscreen')}`).first();
      if (await btn.count() && await btn.isVisible()) await press(btn); else await press(page.locator(tid('schedule-content-card')).first());
      await page.waitForTimeout(600);
      const pageVariant = (await page.locator(tid('req-description-page-header')).count()) > 0;
      const pfx = pageVariant ? 'req-description-page' : 'req-description-full';
      const save = page.locator(tid(`${pfx}-save`));
      const mode = await measure(page.locator(tid(`${pfx}-mode`)));
      const saveOff = await measure(save);
      const exit = pageVariant ? null : await measure(page.locator(tid('req-description-full-close')));
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-schedule.png` });
      // 改一个字 ⇒ 保存能点。
      await press(page.locator(tid(pageVariant ? 'req-description-page-mode-edit' : 'req-description-full-mode-edit')).first());
      const ta = page.locator(pageVariant ? `textarea${tid('req-description-page-input')}` : '[aria-modal="true"] textarea').last();
      await ta.waitFor({ timeout: 5000 }); await ta.click(); await page.keyboard.press('End'); await page.keyboard.type('。');
      await page.waitForTimeout(300);
      const saveOn = await measure(save);
      const items = pageVariant ? [mode, saveOff] : [mode, saveOff, exit];
      record(where, pageVariant ? 'schedule(page)' : 'schedule(full)', {
        found: items.every(Boolean),
        centre: spread(items) <= 1,
        height: hSpread(items) <= 0.5,
        saveDisabled: disabledLooksDisabled(saveOff, saveOn),
      }, { centre: spread(items), heights: items.map(m => m && r1(m.h)), saveOff: saveOff && { bg: saveOff.bg, fg: saveOff.fg, opacity: r1(saveOff.effOpacity) }, saveOn: saveOn && { bg: saveOn.bg, fg: saveOn.fg } });
    });
  }
}
await browser.close();
web.close?.();
console.log(`\n${rows - failures}/${rows} rows passed`);
process.exit(failures ? 1 : 0);
