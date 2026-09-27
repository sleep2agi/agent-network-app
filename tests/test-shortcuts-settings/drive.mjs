// 设置 → 快捷键 + 外链出口(src/open-external.ts)—— 真应用(expo web 导出 + Tauri 桥桩)里按真键、量真框。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据
// (示例-A / 示例-B …),不起 hub 进程、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-shortcuts-settings/drive.mjs
//
// 1200×800,桌面 UA(非安卓)+ Tauri 桩 = 桌面工作区(wide-layout.ts)。Linux 上键帽显示 Ctrl。
// 检查:
//   links   语音输入页「火山引擎控制台」点下去 → 走 plugin:opener|open_url(url 正确),且**没有**走
//           window.open(Tauri WebView 里那条路什么都不发生 —— 0.2.123 的 bug);「高级 / 旧版控制台 ›」能展开
//   layout  快捷键页:所有行的标签左边缘相等(±1px);键帽 / 分段控件的垂直中心与行中心差 ≤ 1px
//   capture 点行 → 「按下新组合…」→ Ctrl+Shift+P 保存;冲突 / 保留 / 无修饰键 有提示;Esc 取消;恢复默认
//   run     Ctrl+2 切到 Tasks、Ctrl+, 回设置、Ctrl+K 聚焦 agent 搜索框;改绑后旧组合失效、新组合生效
//   send    发送键改成 Ctrl+Enter:Enter 换行不发送,Ctrl+Enter 发送;提示文案跟着变
// 任何一条没跑到 = FAIL(不是 skip)。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

// 在 harness 的桩外面再包一层:记录 opener 调用和 window.open 调用。
const spyScript = () => {
  window.__openerCalls = []; window.__windowOpenCalls = [];
  const origOpen = window.open;
  window.open = (...args) => { window.__windowOpenCalls.push(args.map(String)); return null; };
  void origOpen;
  const inner = window.__TAURI_INTERNALS__;
  if (inner) {
    const invoke = inner.invoke;
    inner.invoke = async (cmd, args) => {
      if (String(cmd).startsWith('plugin:opener|')) { window.__openerCalls.push({ cmd, args }); return null; }
      return invoke(cmd, args);
    };
  }
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(initScript, { theme: 'light' });
await page.addInitScript(spyScript);
await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
await page.locator('[data-testid="desktop-rail"]').waitFor({ timeout: 20000 });

const bbox = async (sel) => page.locator(sel).first().boundingBox();
const seen = (loc) => loc.waitFor({ timeout: 8000 }).then(() => true, () => false);
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
const openSettings = async (label) => {
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: `设置分类 ${label}` }).click();
};

try {
  // ── links ──────────────────────────────────────────────────────────────────
  await openSettings('语音输入');
  const link = page.locator('[data-testid="voice-console-link"]');
  await link.waitFor({ timeout: 10000 });
  await shot('voice-settings');
  const cursor = await link.evaluate(el => getComputedStyle(el).cursor);
  ck('links: 控制台链接在网页/桌面上是手型光标', cursor === 'pointer', cursor);
  await link.click();
  await page.waitForTimeout(300);
  const opener = await page.evaluate(() => window.__openerCalls);
  const winOpen = await page.evaluate(() => window.__windowOpenCalls);
  ck('links: 点击 → plugin:opener|open_url 一次,url 正确', opener.length === 1 && opener[0].cmd === 'plugin:opener|open_url' && opener[0].args?.url === 'https://console.volcengine.com/speech/app', JSON.stringify(opener));
  ck('links: 桌面上不走 window.open(WebView 里那条路是空操作)', winOpen.length === 0, JSON.stringify(winOpen));
  await page.locator('[data-testid="voice-advanced-toggle"]').click();
  ck('links: 「高级 / 旧版控制台 ›」点得开', await page.locator('[data-testid="voice-advanced"]').isVisible());
  await shot('voice-settings-advanced');

  // ── layout ─────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: '设置分类 快捷键' }).click();
  await page.locator('[data-testid="shortcuts-settings"]').waitFor({ timeout: 10000 });
  const sideOrder = await page.locator('[aria-label^="设置分类 "]').evaluateAll(els => els.map(e => e.getAttribute('aria-label').replace('设置分类 ', '')));
  ck('layout: 左栏「快捷键」紧挨在「关于」上面', sideOrder.indexOf('快捷键') >= 0 && sideOrder.indexOf('快捷键') + 1 === sideOrder.indexOf('关于'), sideOrder.join(','));
  await shot('shortcuts-settings');
  const rowIds = await page.locator('[data-testid^="shortcut-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('shortcut-row-', '')));
  const rows = [];
  for (const id of rowIds) {
    const row = await bbox(`[data-testid="shortcut-row-${id}"]`);
    const label = await bbox(`[data-testid="shortcut-label-${id}"]`);
    const right = id === 'send' ? await bbox('[role="radiogroup"][aria-label="发送消息"]') : await bbox(`[data-testid="shortcut-chips-${id}"]`);
    rows.push({ id, rowTop: row.y, rowH: row.height, labelX: label.x, labelMid: label.y + label.height / 2, rightMid: right.y + right.height / 2, rightEnd: right.x + right.width, rowMid: row.y + row.height / 2 });
  }
  console.log('\nid                    rowTop  rowH  labelX  rowMid  labelMid  chipsMid  Δchips  chipsRight');
  for (const r of rows) console.log(`${r.id.padEnd(20)} ${r.rowTop.toFixed(1).padStart(7)} ${r.rowH.toFixed(1).padStart(5)} ${r.labelX.toFixed(1).padStart(7)} ${r.rowMid.toFixed(1).padStart(7)} ${r.labelMid.toFixed(1).padStart(9)} ${r.rightMid.toFixed(1).padStart(9)} ${(r.rightMid - r.rowMid).toFixed(2).padStart(7)} ${r.rightEnd.toFixed(1).padStart(10)}`);
  ck(`layout: ${rows.length} 行(导航 7 + 会话 3 + 输入 2)`, rows.length === 12, String(rows.length));
  const xs = rows.map(r => r.labelX);
  ck('layout: 所有标签左边缘相等 ±1px', Math.max(...xs) - Math.min(...xs) <= 1, `${Math.min(...xs)}..${Math.max(...xs)}`);
  const worst = rows.reduce((m, r) => Math.max(m, Math.abs(r.rightMid - r.rowMid)), 0);
  ck('layout: 键帽 / 分段控件垂直居中于行 ≤1px', worst <= 1, `worst Δ=${worst.toFixed(2)}`);
  const worstLabel = rows.reduce((m, r) => Math.max(m, Math.abs(r.labelMid - r.rowMid)), 0);
  ck('layout: 标签垂直居中于行 ≤1px', worstLabel <= 1, `worst Δ=${worstLabel.toFixed(2)}`);
  const ends = rows.map(r => r.rightEnd);
  ck('layout: 右侧键帽列右边缘对齐 ±1px', Math.max(...ends) - Math.min(...ends) <= 1, `${Math.min(...ends)}..${Math.max(...ends)}`);
  const chipText = await page.locator('[data-testid="shortcut-chips-nav.search"]').innerText();
  ck('layout: 非 mac 显示 Ctrl 键帽', chipText.replace(/\s+/g, ' ').trim() === 'Ctrl K', JSON.stringify(chipText));

  // ── capture ────────────────────────────────────────────────────────────────
  await page.locator('[data-testid="shortcut-row-nav.search"]').click();
  ck('capture: 点行进入「按下新组合…」', await page.locator('[data-testid="shortcut-capturing-nav.search"]').isVisible());
  await shot('shortcuts-capturing');
  await page.keyboard.press('KeyP');
  ck('capture: 不带修饰键 → 提示需要 Ctrl,仍在录入', (await page.locator('[data-testid="shortcut-warning-nav.search"]').innerText()).includes('Ctrl') && await page.locator('[data-testid="shortcut-capturing-nav.search"]').isVisible());
  await page.keyboard.press('Control+KeyC');
  ck('capture: Ctrl+C → 保留组合提示', (await page.locator('[data-testid="shortcut-warning-nav.search"]').innerText()).includes('复制'));
  await page.keyboard.press('Control+Comma');
  const conflictText = await page.locator('[data-testid="shortcut-warning-nav.search"]').innerText();
  ck('capture: Ctrl+, → 与「打开设置」冲突', conflictText.includes('打开设置'), conflictText);
  await shot('shortcuts-conflict');
  ck('capture: 录入中按 Ctrl+, 没有跳走(全局快捷键暂停)', await page.locator('[data-testid="shortcuts-settings"]').isVisible());
  await page.keyboard.press('Control+Shift+KeyP');
  const saved = (await page.locator('[data-testid="shortcut-chips-nav.search"]').innerText()).replace(/\s+/g, ' ').trim();
  ck('capture: Ctrl+Shift+P 保存并显示', saved === 'Ctrl Shift P', saved);
  ck('capture: 改过的行出现「恢复默认」', await page.locator('[data-testid="shortcut-reset-nav.search"]').isVisible());
  const stored = await page.evaluate(() => localStorage.getItem('keyboard_shortcuts_v1'));
  ck('capture: 落 localStorage', (stored ?? '').includes('Mod+Shift+P'), stored ?? 'null');
  await shot('shortcuts-customized');
  await page.locator('[data-testid="shortcut-row-nav.settings"]').click();
  await page.keyboard.press('Escape');
  ck('capture: Esc 取消,原组合不变', !(await page.locator('[data-testid="shortcut-capturing-nav.settings"]').count()) && (await page.locator('[data-testid="shortcut-chips-nav.settings"]').innerText()).replace(/\s+/g, ' ').trim() === 'Ctrl ,');

  // ── run ────────────────────────────────────────────────────────────────────
  await page.locator('body').click({ position: { x: 700, y: 760 } });
  await page.keyboard.press('Control+KeyK');
  await page.waitForTimeout(200);
  ck('run: 改绑后旧的 Ctrl+K 不再触发', await page.locator('[data-testid="shortcuts-settings"]').isVisible() && await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) !== 'agents-search');
  await page.keyboard.press('Control+Shift+KeyP');
  await page.waitForTimeout(300);
  ck('run: 新组合 Ctrl+Shift+P 聚焦 agent 搜索框', await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'agents-search');
  await page.keyboard.press('Control+Digit2');
  await page.waitForTimeout(300);
  ck('run: Ctrl+2 → Tasks(任务列表出现)', await seen(page.getByText('示例任务二', { exact: true }).first()));
  await page.keyboard.press('Control+Digit5');
  await page.waitForTimeout(300);
  ck('run: Ctrl+5 → 服务器设置', await seen(page.locator('[data-testid="server-overview"]')));
  await page.keyboard.press('Control+Shift+KeyP');
  await page.waitForTimeout(400);
  {
    const back = await seen(page.getByText('选择一个 agent 开始聊天'));
    const serverGone = !(await page.locator('[data-testid="server-overview"]').count());
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);
    ck('run: 在服务器页按搜索 → 先切回 Agents 再聚焦搜索框', back && serverGone && focused === 'agents-search', `back=${back} serverGone=${serverGone} focused=${focused}`);
  }
  await page.keyboard.press('Control+Comma');
  await page.waitForTimeout(300);
  ck('run: Ctrl+, → 设置', await seen(page.locator('[data-testid="settings-sidebar"]')));
  await page.getByRole('button', { name: '设置分类 快捷键' }).click();
  await page.locator('[data-testid="shortcut-reset-nav.search"]').click();
  ck('run: 单行恢复默认 → Ctrl K', (await page.locator('[data-testid="shortcut-chips-nav.search"]').innerText()).replace(/\s+/g, ' ').trim() === 'Ctrl K');
  await page.locator('body').click({ position: { x: 700, y: 760 } });
  await page.keyboard.press('Control+KeyK');
  await page.waitForTimeout(300);
  ck('run: 默认 Ctrl+K 聚焦 agent 搜索框', await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'agents-search');

  // ── send ───────────────────────────────────────────────────────────────────
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: '设置分类 快捷键' }).click();
  await page.locator('[data-testid="shortcut-send-modEnter"]').click();
  const newline = (await page.locator('[data-testid="shortcut-chips-newline"]').innerText()).replace(/\s+/g, ' ').trim();
  ck('send: 改成 Ctrl+Enter 后「换行」行显示 Enter', newline === 'Enter', newline);
  await shot('shortcuts-send-mod-enter');
  await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'chat', alias: '示例-A' }));
  const hint = page.locator('[data-testid="composer-shortcut-hint"]');
  await hint.waitFor({ timeout: 10000 });
  ck('send: 输入框提示跟着变', (await hint.innerText()) === 'Ctrl+Enter 发送 · Enter 换行', await hint.innerText());
  const box = page.locator('textarea[placeholder^="Message 示例-A"]').first();
  await box.click();
  await box.type('第一行');
  await page.keyboard.press('Enter');
  await box.type('第二行');
  const v1 = await box.inputValue();
  ck('send: Enter 换行、不发送', v1 === '第一行\n第二行', JSON.stringify(v1));
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(500);
  const v2 = await box.inputValue();
  ck('send: Ctrl+Enter 发送(输入框清空)', v2 === '', JSON.stringify(v2));
  await shot('chat-after-mod-enter-send');
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: '设置分类 快捷键' }).click();
  await page.locator('[data-testid="shortcuts-reset-all"]').click();
  {
    const stored = await page.evaluate(() => localStorage.getItem('keyboard_shortcuts_v1'));
    const newlineAfter = (await page.locator('[data-testid="shortcut-chips-newline"]').innerText()).replace(/\s+/g, ' ').trim();
    ck('send: 全部恢复默认 → 发送键回到 Enter(换行回到 Shift+Enter)', stored === '{"overrides":{},"sendKey":"enter"}' && newlineAfter === 'Shift Enter', `${stored} / ${newlineAfter}`);
  }
} catch (e) {
  ck(`driver threw: ${String(e?.message ?? e).split('\n')[0]}`, false);
}
ck('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
web.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
