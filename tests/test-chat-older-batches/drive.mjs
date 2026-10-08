// board #745 —— 长会话分批加载:首屏最新一页,往上滑按游标拉更早的一页,加载时列表不空、可视区不跳。量真框。
// Placeholder data only, served in-page by the Tauri stub in tests/test-layout-sweep/harness.mjs (no hub process,
// no port, no HOME touched). The stub answers /api/tasks like the hub (window.__chatTasksPaged: newest first,
// before / before_task_id cursor, at most `limit`); window.__olderDelayMs holds every older-page read back.
// Not in CI: needs Playwright + Chromium and a web export.
//
//   WEB_DIR=<expo export dir> [OUT=<png dir>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-chat-older-batches/drive.mjs
//
// 会话里 100 条任务。desktop 1440×900 和 phone 390×844(安卓 UA),浅色 + 深色:
//   skeleton 首次读还没回来 ⇒ 画气泡轮廓(不是一块空白),回来后换成消息
//   first   首个 /api/tasks 读 limit ≤ 30、不带游标;最新一条在可视区里;画出来的条数 ≤ 一页
//   older   往上滑 ⇒ 下一次读带 before = 已加载最老一条;等它回来的这段时间里列表不空、顶部有加载指示(水平居中);
//           回来后之前看着的那条消息位置不动(±2px),条数变多
//   start   一路滑到顶 ⇒ 「聊天记录起点」,最老那条在可视区里(列表是虚拟化的,DOM 里不会 100 条都在);没有重复;每次读都 ≤ 30 条
// Each step runs on its own, so a pre-change export shows every red. Exit 1 on any failure.
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const ALIAS = '示例-A';
const TOTAL = 100;
const fixture = ({ alias, total }) => {
  const sql = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const tasks = [];
  for (let i = 0; i < total; i++) {
    tasks.push({ task_id: `t_hist_${String(i).padStart(3, '0')}`, from_name: 'tester', to_name: alias, content: `示例任务 ${i}`, result: `示例回复 ${i}`, status: 'replied', priority: 'normal', created_at: sql(i * 2 + 1), updated_at: sql(i * 2), completed_at: sql(i * 2) });
  }
  window.__chatTasksFixture = tasks;
  window.__chatTasksPaged = true;
  window.__olderDelayMs = 1500;
};

const tid = (id) => `[data-testid="${id}"]`;
let failures = 0, rows = 0;
const record = (where, what, checks, extra = {}) => {
  const ok = Object.values(checks).every(Boolean);
  rows++; if (!ok) failures++;
  console.log(JSON.stringify({ where, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...extra }));
};

// Painted box of the first element whose own text is exactly `text`, against its scrolling list.
const box = (page, text) => page.evaluate((t) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent.trim() !== t || !n.parentElement.getClientRects().length) continue;
    let list = n.parentElement.parentElement;
    while (list && !(/(auto|scroll)/.test(getComputedStyle(list).overflowY) && list.scrollHeight > list.clientHeight)) list = list.parentElement;
    const b = n.parentElement.getBoundingClientRect();
    const l = list ? list.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    return { top: b.top, inView: b.bottom > l.top && b.top < l.bottom, list: { top: l.top, bottom: l.bottom, left: l.left, right: l.right } };
  }
  return null;
}, text);
const items = (page) => page.locator('[data-testid^="chat-item-"]').count();
// The chat's reads only: the agents list also reads each alias's latest row (limit 1) for its time column.
const reads = (page) => page.evaluate(() => (window.__tasksReads || []).filter(r => r.limit > 1));

const VIEWPORTS = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844, ua: ANDROID_UA } };
const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
for (const [name, V] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const where = `${name} ${V.w}x${V.h} ${theme}`;
    const step = async (what, fn, opts = {}) => {
      const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, ...(V.ua ? { userAgent: V.ua, hasTouch: true } : {}), colorScheme: theme, deviceScaleFactor: 1, locale: 'zh-CN' });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(fixture, { alias: ALIAS, total: TOTAL });
        await page.addInitScript(initScript, { theme });
        await page.addInitScript(() => { try { localStorage.setItem('anet.language.v1', 'zh'); } catch {} });
        await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
        await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 20000 });
        if (opts.beforeOpen) await opts.beforeOpen(page);
        await page.evaluate((a) => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: a }), ALIAS);
        if (!opts.beforeOpen) {
          await page.getByText('示例任务 0', { exact: true }).first().waitFor({ timeout: 15000 });
          await page.waitForTimeout(400);
        }
        await fn(page);
      } catch (e) {
        record(where, what, { ran: false }, { error: String(e).split('\n')[0] });
        if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-FAIL-${what}.png` }).catch(() => {});
      }
      await ctx.close();
    };
    // Wheel up over the message list (visual up = toward older history) until `until(page)` holds.
    const wheelUp = async (page, until, max = 60) => {
      const l = (await box(page, '示例任务 0')).list;
      await page.mouse.move((l.left + l.right) / 2, (l.top + l.bottom) / 2);
      for (let i = 0; i < max; i++) { if (await until(page)) return true; await page.mouse.wheel(0, -500); await page.waitForTimeout(60); }
      return until(page);
    };

    await step('skeleton', async (page) => {
      // The first read is held back: the pane shows bubble placeholders, not an empty area.
      const skel = page.locator(tid('chat-history-skeleton'));
      const shown = await skel.first().waitFor({ timeout: 3000 }).then(() => true, () => false);
      const bars = shown ? await page.evaluate((sel) => [...document.querySelector(sel).children].filter(c => c.getBoundingClientRect().height > 0).length, tid('chat-history-skeleton')) : 0;
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-skeleton.png` });
      await page.evaluate(() => { window.__stubDelayMs = 0; });
      const replaced = await page.getByText('示例任务 0', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      record(where, 'skeleton', { skeletonShown: shown && bars > 0, replacedByMessages: replaced && (await skel.count()) === 0 }, { bars });
    }, { beforeOpen: (page) => page.evaluate(() => { window.__stubDelayMs = 2500; }) });

    await step('first', async (page) => {
      const r = await reads(page);
      const newest = await box(page, '示例任务 0');
      const n = await items(page);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-first.png` });
      record(where, 'first', { firstReadIsOnePage: r[0]?.limit <= 30 && !r[0]?.before, newestInView: !!newest?.inView, paintedOnePage: n > 0 && n <= 30 }, { firstRead: r[0], items: n });
    });

    await step('older', async (page) => {
      const before = await items(page);
      const loading = page.locator(tid('chat-loading-older'));
      const sawLoading = await wheelUp(page, async (p) => (await loading.count()) > 0);
      // Anchor: the oldest loaded message (it sits at the visual top when the next page is asked for).
      const anchorText = `示例任务 ${before - 1}`;
      const a0 = await box(page, anchorText);
      const whileLoading = await items(page);
      const spinner = sawLoading ? await loading.first().boundingBox() : null;
      const list = a0?.list;
      const centred = !!spinner && !!list && Math.abs((spinner.x + spinner.width / 2) - (list.left + list.right) / 2) <= 2;
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-older-loading.png` });
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="chat-item-"]').length > n, before, { timeout: 8000 });
      await page.waitForTimeout(300);
      const a1 = await box(page, anchorText);
      const r = await reads(page);
      const olderRead = r.find(x => x.before);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-older-loaded.png` });
      record(where, 'older', {
        loadingShown: sawLoading,
        spinnerCentred: centred,
        listNotEmptyWhileLoading: whileLoading >= before && whileLoading > 0,
        cursorRead: !!olderRead && olderRead.limit <= 30 && !!olderRead.before_task_id,
        anchorStays: !!a0 && !!a1 && Math.abs(a1.top - a0.top) <= 2,
        grew: (await items(page)) > before,
      }, { itemsBefore: before, anchorTop: a0 && [Math.round(a0.top), a1 && Math.round(a1.top)], olderRead });
    });

    await step('start', async (page) => {
      await page.evaluate(() => { window.__olderDelayMs = 0; });
      const reached = await wheelUp(page, async (p) => (await p.getByText('— 聊天记录起点 —').count()) > 0, 200);
      // The footer can mount before it scrolls into view: wheel on to the very top before measuring.
      for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, -800); await page.waitForTimeout(60); }
      await page.waitForTimeout(300);
      const keys = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="chat-item-"]')].map(e => e.getAttribute('data-testid')));
      const r = await reads(page);
      if (OUT) await page.screenshot({ path: `${OUT}/${name}-${theme}-start.png` });
      const oldest = await box(page, `示例任务 ${TOTAL - 1}`);
      record(where, 'start', { reachedStart: reached, oldestInView: !!oldest?.inView, noDuplicates: new Set(keys).size === keys.length, everyOlderReadOnePage: r.every(x => x.limit <= 30 || !x.before), olderReads: r.filter(x => x.before).length === Math.ceil(TOTAL / 30) - 1 }, { items: keys.length, reads: r.length });
    });
  }
}
await browser.close();
web.close();
console.log(`\n${rows - failures}/${rows} rows passed`);
process.exit(failures ? 1 : 0);
