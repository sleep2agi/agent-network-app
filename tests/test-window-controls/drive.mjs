// 每个窗口只能有一套窗口控件(Vincent 2026-09-29「怎么有两个×」)—— 真应用(expo web 导出 + Tauri 桥桩)里
// 按窗口 label 渲染,数页面里画出来的窗口控件。不进 CI:要 Playwright + Chromium。Hub 数据是
// tests/test-layout-sweep/harness.mjs 的页内假数据,不起 hub、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-window-controls/drive.mjs
//
// 1000×560,三种情形:
//   win  settings  Windows 壳 + label=settings(?settings=1):原生标题栏 decorations:true ⇒ 页面里 0 个
//                  自绘控件、0 个关闭键,侧栏左上角没有 ✕(整窗唯一的 × 是系统那个)
//   win  main      Windows 壳 + label=main:decorations=false ⇒ 恰好 1 条 WinTitleBar、1 个关闭键
//                  (正控:证明这个数法数得到自绘控件)
//   mac  settings  macOS 壳 + label=settings:Overlay 红黄绿灯 ⇒ 0 个自绘控件,有 28px 拖动空带,
//                  内容不压在红绿灯下面
//   win  task      Windows 壳 + label=task-*(?taskWindow=1,「在新窗口打开」):decorations:true ⇒ 页面里
//                  0 个自绘控件、0 个关闭键
//   win  task/main 同一页面但 label=main(正控:证明任务窗页面里的 WinTitleBar 数得到)
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// harness 的桩把窗口 label 写死成 main;这里换成要测的那个窗口。
const setLabel = (label) => {
  const inner = window.__TAURI_INTERNALS__;
  if (inner) inner.metadata = { currentWindow: { label }, currentWebview: { windowLabel: label, label } };
};

// 在页内数:自绘标题栏、可见的「关闭」类按钮(含侧栏 ✕)、Mac 拖动空带、侧栏顶边。
const measure = () => {
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const bars = [...document.querySelectorAll('[data-testid="win-title-bar"]')].filter(vis);
  const closes = [...document.querySelectorAll('[role="button"],button')].filter(vis)
    .filter(el => /关闭|close/i.test(el.getAttribute('aria-label') || ''))
    .map(el => { const b = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label'), x: Math.round(b.left), y: Math.round(b.top) }; });
  const winControls = [...document.querySelectorAll('[role="button"],button')].filter(vis)
    .filter(el => ['最小化', '最大化', '向下还原', '关闭'].includes(el.getAttribute('aria-label') || '')).length;
  const strip = [...document.querySelectorAll('[aria-label="窗口拖动区"]')].filter(vis).map(el => el.getBoundingClientRect().height);
  const sidebar = document.querySelector('[data-testid="settings-sidebar"]');
  const sidebarTop = sidebar ? sidebar.getBoundingClientRect().top : null;
  const sidebarCloses = sidebar ? [...sidebar.querySelectorAll('[role="button"],button')].filter(vis)
    .filter(el => /关闭|close/i.test(el.getAttribute('aria-label') || '')).length : null;
  return { bars: bars.length, closes, winControls, strip, sidebarTop, sidebarCloses };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

const open = async ({ os, label, query, ready }) => {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 560 }, userAgent: os === 'mac' ? MAC_UA : WIN_UA, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(setLabel, label);
  await page.goto(`${web.url}${query}`);
  await page.locator(ready).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
};

const cases = [
  { name: 'win-settings', os: 'win', label: 'settings', query: '?settings=1', ready: '[data-testid="dedicated-settings-window"]' },
  { name: 'win-main', os: 'win', label: 'main', query: '', ready: 'text=示例-A' },
  { name: 'mac-settings', os: 'mac', label: 'settings', query: '?settings=1', ready: '[data-testid="dedicated-settings-window"]' },
  { name: 'win-task', os: 'win', label: 'task-0a1b2c3d', query: '?taskWindow=1', ready: '[data-testid="task-window"]' },
  { name: 'win-task-as-main', os: 'win', label: 'main', query: '?taskWindow=1', ready: '[data-testid="task-window"]' },
];
const table = [];
for (const c of cases) {
  try {
    const { ctx, page, errors } = await open(c);
    if (OUT) await page.screenshot({ path: `${OUT}/${c.name}.png` });
    const m = await page.evaluate(measure);
    table.push({ case: c.name, ...m, closes: JSON.stringify(m.closes) });
    if (c.name === 'win-settings') {
      ck('win settings 窗:页面里 0 条自绘标题栏(原生标题栏已经有 – □ ×)', m.bars === 0, String(m.bars));
      ck('win settings 窗:页面里 0 个 最小化/最大化/关闭 自绘控件', m.winControls === 0, String(m.winControls));
      ck('win settings 窗:页面里 0 个关闭键 ⇒ 整窗恰好 1 个 ×(系统的)', m.closes.length === 0, JSON.stringify(m.closes));
      ck('win settings 窗:侧栏左上角没有 ✕', m.sidebarCloses === 0, String(m.sidebarCloses));
    } else if (c.name === 'win-main') {
      ck('win 主窗(正控):恰好 1 条自绘标题栏', m.bars === 1, String(m.bars));
      ck('win 主窗(正控):恰好 1 个关闭键', m.closes.length === 1, JSON.stringify(m.closes));
      ck('win 主窗(正控):3 个自绘窗口控件', m.winControls === 3, String(m.winControls));
    } else if (c.name === 'win-task') {
      ck('win 任务窗:页面里 0 条自绘标题栏(原生标题栏已经有 – □ ×)', m.bars === 0, String(m.bars));
      ck('win 任务窗:页面里 0 个 最小化/最大化/关闭 自绘控件', m.winControls === 0, String(m.winControls));
      ck('win 任务窗:页面里 0 个关闭键 ⇒ 整窗恰好 1 个 ×(系统的)', m.closes.length === 0, JSON.stringify(m.closes));
    } else if (c.name === 'win-task-as-main') {
      ck('win 任务窗页面 label=main(正控):恰好 1 条自绘标题栏', m.bars === 1, String(m.bars));
    } else {
      ck('mac settings 窗:0 个自绘窗口控件(红黄绿灯是系统的)', m.bars === 0 && m.winControls === 0, `${m.bars}/${m.winControls}`);
      ck('mac settings 窗:0 个关闭键,侧栏左上角没有 ✕', m.closes.length === 0 && m.sidebarCloses === 0, JSON.stringify(m.closes));
      ck('mac settings 窗:有 28px 拖动空带给红黄绿灯', m.strip.length === 1 && Math.abs(m.strip[0] - 28) <= 0.5, JSON.stringify(m.strip));
      ck('mac settings 窗:侧栏不压在红黄绿灯下(top ≥ 28)', m.sidebarTop !== null && m.sidebarTop >= 28 - 0.5, String(m.sidebarTop));
    }
    ck(`${c.name}: 没有页面错误`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  } catch (e) {
    ck(`${c.name}: 打开`, false, String(e.message || e).split('\n')[0]);
  }
}
console.table(table);
await browser.close();
web.close();
console.log(`\nwindow-controls: ${pass}/${pass + failures.length} passed`);
if (failures.length) process.exit(1);
