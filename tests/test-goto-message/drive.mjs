// 「去会话」落到那一条消息上(board #463,Vincent 截图:定时任务 → 执行记录 → 去会话 › 只打开了会话、停在最新,
// 那次执行的回复不在第一页里就找不到)。量真框。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process,
// no port, no HOME touched); the chat answers like the hub (window.__chatTasksPaged: newest first, at most `limit`).
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-goto-message/drive.mjs
//
// 会话里 160 条任务;目标那次执行是第 131 新的一条(第一页 20 条里没有),回复很长(比手机屏还高)。
// desktop 1440×900 和 phone 390×844(安卓 UA),浅色 + 深色:
//   deep      定时任务 → 执行记录 → 展开 → 去会话 › ⇒ 会话打开;那次执行的回复第一行在会话列表的可视区里;
//             它所在的消息被高亮,3 秒后高亮消失(短暂);为了找它往前多拉过(请求的 limit > 20)
//   missing   另一次执行的任务已经不在(删了 / 太早)⇒ 提示「没找到那条消息…」,停在最新(最新一条在可视区里)
// Each step runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const ALIAS = '示例-A';
const TARGET_FIRST_LINE = '示例执行结果第一行:过去一小时的示例进展';
const fixture = ({ alias, firstLine }) => {
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const tasks = [];
  for (let i = 0; i < 160; i++) {
    const id = i === 130 ? 't_run_target' : `t_hist_${i}`;
    const reply = i === 130
      ? [firstLine, '', ...Array.from({ length: 30 }, (_, k) => `· 示例条目 ${k + 1}:这一行只是占位文字,用来把回复撑得比手机屏幕还高。`)].join('\n')
      : `示例回复 ${i}`;
    tasks.push({ task_id: id, from_name: i % 3 ? 'tester' : '示例-B', to_name: alias, content: i === 130 ? '示例定时任务:汇报过去一小时的进展' : `示例任务 ${i}`, result: reply, status: 'replied', priority: 'normal', created_at: iso(i * 2 + 1), updated_at: iso(i * 2), completed_at: iso(i * 2) });
  }
  window.__chatTasksFixture = tasks;
  window.__chatTasksPaged = true;
  const runs = [
    { run_id: 'run_target', schedule_id: 's_sweep_1', scheduled_for: iso(261), task_id: 't_run_target', status: 'replied', created_at: iso(261), completed_at: iso(260) },
    { run_id: 'run_gone', schedule_id: 's_sweep_1', scheduled_for: iso(900), task_id: 't_deleted_long_ago', status: 'replied', created_at: iso(900), completed_at: iso(899) },
  ];
  window.__routeOverride = (u) => {
    if (/\/api\/scheduled-tasks\/[^/]+\/runs$/.test(u.pathname)) return { ok: true, runs };
    // The deleted run's task is still shown in the run (its detail was fetched earlier); the chat no longer has it.
    if (u.pathname === '/api/tasks' && u.searchParams.get('task_id') === 't_deleted_long_ago') return { ok: true, tasks: [{ task_id: 't_deleted_long_ago', from_name: 'scheduler', to_name: alias, content: '示例定时任务', result: '很早以前的一次回复', status: 'replied', created_at: iso(900), completed_at: iso(899) }] };
    return undefined;
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

// A text's box against the chat list's visible box (its nearest scrolling ancestor), plus the background of every
// ancestor up to that list (to see a highlight come and go without knowing how the app draws it).
const probe = (page, text) => page.evaluate((t) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.includes(t) && n.parentElement.getClientRects().length) { node = n.parentElement; break; }
  if (!node) return null;
  let list = node.parentElement;
  while (list && !(/(auto|scroll)/.test(getComputedStyle(list).overflowY) && list.scrollHeight > list.clientHeight)) list = list.parentElement;
  const b = node.getBoundingClientRect();
  const l = list ? list.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  const bgs = [];
  for (let e = node; e && e !== list; e = e.parentElement) bgs.push(getComputedStyle(e).backgroundColor);
  return { top: b.top, bottom: b.bottom, listTop: l.top, listBottom: l.bottom, inView: b.top >= l.top - 1 && b.top + 16 <= l.bottom + 1, bgs };
}, text);

const VIEWPORTS = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name} ${V.w}x${V.h} ${theme}`;
    const press = (page, l) => (V.ua ? l.tap() : l.click());
    const step = async (what, fn) => {
      const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(fixture, { alias: ALIAS, firstLine: TARGET_FIRST_LINE });
        await page.addInitScript(initScript, { theme });
        await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
        await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
        await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
        await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'scheduled' }));
        const detail = page.locator(tid('schedule-detail'));
        if (!(await detail.first().waitFor({ timeout: 6000 }).then(() => true, () => false))) await press(page, page.getByText('示例定时任务', { exact: true }).first());
        await detail.first().waitFor({ timeout: 10000 });
        await fn(page);
      } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${what}.png` }).catch(() => {});
      }
      await ctx.close();
    };
    const openRunChat = async (page, runId) => {
      const toggle = page.locator(tid(`schedule-run-toggle-${runId}`)).first();
      await toggle.scrollIntoViewIfNeeded();
      await press(page, toggle);
      const go = page.locator(`${tid(`schedule-run-result-${runId}`)} ${tid('schedule-run-open-chat')}`).first();
      await go.waitFor({ timeout: 8000 });
      await go.scrollIntoViewIfNeeded();
      await press(page, go);
    };

    await step('deep', async (page) => {
      await openRunChat(page, 'run_target');
      let first = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const p = await probe(page, TARGET_FIRST_LINE);
        if (p?.inView) { first = p; break; }
        await page.waitForTimeout(150);
      }
      const landedMs = Date.now() - t0;
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-deep.png` });
      await page.waitForTimeout(3000);
      const later = await probe(page, TARGET_FIRST_LINE);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-deep-later.png` });
      const limits = await page.evaluate(() => window.__tasksLimits || []);
      const highlighted = !!first && !!later && first.bgs.some((bg, i) => bg !== later.bgs[i]);
      record(where, 'deep', {
        landed: !!first,
        highlighted,
        pagedBack: Math.max(0, ...limits) > 20,
      }, { landedMs: first ? landedMs : null, top: first && r1(first.top), list: first && [r1(first.listTop), r1(first.listBottom)], maxLimit: Math.max(0, ...limits) });
    });

    await step('missing', async (page) => {
      await openRunChat(page, 'run_gone');
      const notice = page.getByText(/没找到那条消息/).first();
      const noticed = await notice.waitFor({ timeout: 12000 }).then(() => true, () => false);
      const latest = await probe(page, '示例回复 0');
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-missing.png` });
      record(where, 'missing', { notice: noticed, latestInView: !!latest?.inView }, { latest: latest && r1(latest.top) });
    });
  }
}
await browser.close();
web.close();
console.log(`\n${rows - failures}/${rows} rows passed`);
process.exit(failures ? 1 : 0);
