// 分离聊天窗:页头兼当标题栏(Vincent 2026-09-30「上面那个还是挺多余的」)—— 真应用(expo web 导出 +
// Tauri 桥桩)里按窗口 label / 系统渲染,量几何、按真实鼠标事件看拖动 / 双击最大化 / 按钮是否可点。
// 不进 CI:要 Playwright + Chromium。Hub 数据是 tests/test-layout-sweep/harness.mjs 的页内假数据,
// 不起 hub、不占端口、不碰 HOME。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//   node tests/test-popout-titlebar/drive.mjs
//
// 700×800(分离窗的常见尺寸),情形:
//   win-chat   Windows 壳 + label=chat-*:页面里恰好一套 – □ ×(46×32,贴右上角),页头顶边 = 0(上面没有
//              别的条),⋯ 不和控件重叠;页头空白处按下 = start_dragging,双击 = internal_toggle_maximize,
//              按 ⋯ / 按控件都不触发拖动
//   mac-chat   macOS 壳 + label=chat-*:0 个自绘控件,没有 28px 空带,红黄绿灯的位置不压头像 / 名字
//   win-node   Windows 壳 + label=chat-*,切到「节点信息」:控件仍在(没有聊天页头也能关窗),返回键不被压
//   win-main   Windows 壳 + label=main(对照):主窗照旧一条 WinTitleBar,没有页头控件,页头不是拖动区
//   android    安卓 UA + label=chat-*(桌面专用守卫):0 个控件
//
// 拖动判定用的是 Tauri 2.11.5 的 drag.js(src/window/scripts/drag.js)原样逻辑,注入到页里 —— 桩里没有
// 真的 Tauri,这一段替它把 mousedown 翻译成 invoke,好让「按下哪里会拖」由真规则而不是我们自己的猜测来判。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const W = 700, H = 800;
// src/window-shell.ts POPOUT_TRAFFIC_LIGHT_X/Y;三颗灯 12px 直径、间距 8 ⇒ 横向约 52px
const LIGHTS = { x: 16, y: 22, w: 52, h: 14 };
const CHAT_LABEL = 'chat-5a5a5a5a';

let pass = 0; const failures = [];
const ck = (name, ok, extra = '') => { if (ok) pass++; else failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

const setLabel = (label) => {
  const inner = window.__TAURI_INTERNALS__;
  if (inner) inner.metadata = { currentWindow: { label }, currentWebview: { windowLabel: label, label } };
};

// 记下窗口相关的 invoke,并装上 Tauri drag.js 的判定(osName = windows / macos)。
const recordAndDrag = (osName) => {
  const inner = window.__TAURI_INTERNALS__;
  // 真 Tauri 里有;harness 桩没有 —— 页面切走时 unlisten 会读它(同 test-desktop-phone-leak)。
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ ??= { unregisterListener: () => {} };
  window.__invoked = [];
  if (inner) {
    const orig = inner.invoke;
    inner.invoke = (cmd, args) => { if (String(cmd).startsWith('plugin:window|')) window.__invoked.push(cmd); return orig(cmd, args); };
  }
  const ATTR = 'data-tauri-drag-region';
  const CLICKABLE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
  const ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);
  const clickable = (el) => CLICKABLE.has(el.tagName)
    || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
    || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
    || ROLES.has(el.getAttribute('role'));
  const isDragRegion = (path) => {
    for (const el of path) {
      if (!(el instanceof HTMLElement)) continue;
      const attr = el.getAttribute(ATTR);
      if (clickable(el) && attr === null) return false;
      if (attr === null) continue;
      if (attr === 'false') return false;
      if (attr === 'deep') return true;
      if (attr === '' || attr === 'true') return el === path[0];
    }
    return false;
  };
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && (e.detail === 1 || e.detail === 2) && isDragRegion(e.composedPath())) {
      if (osName === 'macos' && e.detail === 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__TAURI_INTERNALS__.invoke('plugin:window|' + (e.detail === 2 ? 'internal_toggle_maximize' : 'start_dragging'));
    }
  }, true);
};

const measure = () => {
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, r: Math.round(b.right * 10) / 10, b: Math.round(b.bottom * 10) / 10 }; };
  const controls = [...document.querySelectorAll('[role="button"],button')].filter(vis)
    .filter(el => ['最小化', '最大化', '向下还原', '关闭'].includes(el.getAttribute('aria-label') || ''))
    .map(el => ({ label: el.getAttribute('aria-label'), ...box(el) }));
  const header = [...document.querySelectorAll('[data-testid="chat-header"],[data-testid="screen-header"]')].filter(vis)[0] ?? null;
  const more = document.querySelector('[data-testid="chat-header-more"]');
  const avatar = header ? header.firstElementChild : null;
  const title = document.querySelector('[data-testid="chat-header-title"]');
  const back = header ? [...header.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-label') === '返回') : null;
  return {
    controls,
    winTitleBars: [...document.querySelectorAll('[data-testid="win-title-bar"]')].filter(vis).length,
    popout: !!document.querySelector('[data-testid="popout-window-controls"]'),
    strip: [...document.querySelectorAll('[aria-label="窗口拖动区"]')].filter(vis).length,
    header: box(header),
    headerTestId: header?.getAttribute('data-testid') ?? null,
    headerDrag: header?.getAttribute('data-tauri-drag-region') ?? null,
    more: box(more), avatar: box(avatar), title: box(title), back: box(back),
  };
};

const overlap = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

const web = await serveExport(WEB);
const browser = await chromium.launch({ executablePath: findChromium() });

const open = async ({ ua, label, osName, query = `?chat=${encodeURIComponent('示例-A')}&profile=p-sweep` }) => {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, userAgent: ua, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(setLabel, label);
  await page.addInitScript(recordAndDrag, osName);
  await page.goto(`${web.url}${query}`);
  return { ctx, page, errors };
};
const invoked = (page) => page.evaluate(() => window.__invoked.splice(0));

const table = [];
// ── win-chat ────────────────────────────────────────────────────────────────
try {
  const { ctx, page, errors } = await open({ ua: WIN_UA, label: CHAT_LABEL, osName: 'windows' });
  await page.locator('[data-testid="dedicated-chat-window"] [data-testid="chat-header"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  if (OUT) await page.screenshot({ path: `${OUT}/win-chat.png` });
  const m = await page.evaluate(measure);
  table.push({ case: 'win-chat', header: JSON.stringify(m.header), more: JSON.stringify(m.more), controls: JSON.stringify(m.controls.map(c => [c.label, c.x, c.y, c.w, c.h])) });
  ck('win-chat: 没有 WinTitleBar、没有 28px 空带(上面不再有第二条)', m.winTitleBars === 0 && m.strip === 0, `${m.winTitleBars}/${m.strip}`);
  ck('win-chat: 页头顶边贴窗口顶(页头就是标题栏)', m.header && m.header.y === 0, JSON.stringify(m.header));
  ck('win-chat: 恰好一套 – □ ×', m.controls.length === 3 && m.controls.filter(c => c.label === '关闭').length === 1, JSON.stringify(m.controls.map(c => c.label)));
  ck('win-chat: 每颗 46×32,贴顶', m.controls.every(c => c.w === 46 && c.h === 32 && c.y === 0), JSON.stringify(m.controls));
  const right = Math.max(...m.controls.map(c => c.r));
  ck('win-chat: 控件贴右边(关闭键右沿 = 窗口右沿)', right === W, String(right));
  ck('win-chat: 控件在页头这一行里(不压到消息区)', m.controls.every(c => c.b <= m.header.b), `${m.controls[0]?.b} ≤ ${m.header?.b}`);
  const ctrlLeft = Math.min(...m.controls.map(c => c.x));
  ck('win-chat: ⋯ 不和控件重叠(右沿 ≤ 控件左沿 − 4)', !!m.more && m.more.r <= ctrlLeft - 4 && !m.controls.some(c => overlap(c, m.more)), `⋯.r=${m.more?.r} ctrl.x=${ctrlLeft}`);
  ck('win-chat: 名字列不压到控件', !!m.title && m.title.r <= ctrlLeft, `${m.title?.r} ≤ ${ctrlLeft}`);
  ck('win-chat: 页头是 deep 拖动区', m.headerDrag === 'deep', String(m.headerDrag));

  // 真实鼠标:页头空白(名字列右边、⋯ 左边,页头垂直中线)按下 = 拖动
  const blankX = Math.round((m.title.r + m.more.x) / 2) - 40, midY = Math.round(m.header.y + m.header.h / 2);
  await invoked(page);
  await page.mouse.move(blankX, midY); await page.mouse.down(); await page.mouse.up();
  ck('win-chat: 页头空白处按下 → start_dragging', (await invoked(page)).includes('plugin:window|start_dragging'));
  await page.mouse.move(Math.round(m.title.x + 8), Math.round(m.title.y + 8)); await page.mouse.down(); await page.mouse.up();
  ck('win-chat: 按在名字上也能拖(deep)', (await invoked(page)).includes('plugin:window|start_dragging'));
  await page.mouse.dblclick(blankX, midY);
  ck('win-chat: 页头空白处双击 → internal_toggle_maximize', (await invoked(page)).includes('plugin:window|internal_toggle_maximize'));
  await page.mouse.click(Math.round(m.more.x + m.more.w / 2), Math.round(m.more.y + m.more.h / 2));
  const afterMore = await invoked(page);
  ck('win-chat: 按 ⋯ 不拖动', !afterMore.includes('plugin:window|start_dragging'), afterMore.join(','));
  const drawer = await page.locator('[data-testid="chat-info-drawer"]').count();
  ck('win-chat: ⋯ 照常可点(聊天信息抽屉打开)', drawer === 1, String(drawer));
  if (OUT) await page.screenshot({ path: `${OUT}/win-chat-info.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  for (const [label, cmd] of [['最小化', 'minimize'], ['最大化', 'toggle_maximize'], ['关闭', 'close']]) {
    const c = m.controls.find(x => x.label === label);
    await page.mouse.click(Math.round(c.x + c.w / 2), Math.round(c.y + c.h / 2));
    await page.waitForTimeout(150);
    const got = await invoked(page);
    ck(`win-chat: 「${label}」可点 → plugin:window|${cmd},且不触发拖动`, got.includes(`plugin:window|${cmd}`) && !got.includes('plugin:window|start_dragging'), got.join(','));
  }
  // 关闭悬停红底
  const close = m.controls.find(x => x.label === '关闭');
  await page.mouse.move(Math.round(close.x + 20), Math.round(close.y + 16));
  await page.waitForTimeout(150);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[aria-label="关闭"]')).backgroundColor);
  ck('win-chat: 关闭键悬停红底(#c42b1c)', bg === 'rgb(196, 43, 28)', bg);
  ck('win-chat: 没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} catch (e) { ck('win-chat: 打开', false, String(e.message || e).split('\n')[0]); }

// ── mac-chat ────────────────────────────────────────────────────────────────
try {
  const { ctx, page, errors } = await open({ ua: MAC_UA, label: CHAT_LABEL, osName: 'macos' });
  await page.locator('[data-testid="dedicated-chat-window"] [data-testid="chat-header"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(measure);
  // 截图上把红黄绿灯的位置画出来,便于人眼看
  if (OUT) {
    await page.evaluate((L) => { const d = document.createElement('div'); Object.assign(d.style, { position: 'fixed', left: `${L.x}px`, top: `${L.y}px`, width: `${L.w}px`, height: `${L.h}px`, outline: '1px dashed red', pointerEvents: 'none', zIndex: 99999 }); document.body.appendChild(d); }, LIGHTS);
    await page.screenshot({ path: `${OUT}/mac-chat.png` });
  }
  const lights = { x: LIGHTS.x, y: LIGHTS.y, r: LIGHTS.x + LIGHTS.w, b: LIGHTS.y + LIGHTS.h };
  table.push({ case: 'mac-chat', header: JSON.stringify(m.header), avatar: JSON.stringify(m.avatar), lights: JSON.stringify(lights) });
  ck('mac-chat: 0 个自绘控件、没有 28px 空带', m.controls.length === 0 && !m.popout && m.strip === 0, `${m.controls.length}/${m.strip}`);
  ck('mac-chat: 页头顶边贴窗口顶', m.header && m.header.y === 0, JSON.stringify(m.header));
  ck('mac-chat: 红黄绿灯在页头这一行里', lights.b <= m.header.b, `${lights.b} ≤ ${m.header?.b}`);
  ck('mac-chat: 头像 / 名字不压在红黄绿灯下(左沿 ≥ 灯右沿 + 8)', !!m.avatar && m.avatar.x >= lights.r + 8 && !overlap(m.avatar, lights) && !overlap(m.title, lights), `avatar.x=${m.avatar?.x} lights.r=${lights.r}`);
  const lightsMid = (lights.y + lights.b) / 2, avatarMid = m.avatar ? m.avatar.y + m.avatar.h / 2 : -99;
  ck('mac-chat: 红黄绿灯和头像行垂直居中对齐(差 ≤ 2px)', Math.abs(lightsMid - avatarMid) <= 2, `lights=${lightsMid} avatar=${avatarMid}`);
  ck('mac-chat: 页头是 deep 拖动区', m.headerDrag === 'deep', String(m.headerDrag));
  await invoked(page);
  const blankX = Math.round((m.title.r + m.more.x) / 2) - 40, midY = Math.round(m.header.y + m.header.h / 2);
  await page.mouse.move(blankX, midY); await page.mouse.down(); await page.mouse.up();
  ck('mac-chat: 页头空白处按下 → start_dragging', (await invoked(page)).includes('plugin:window|start_dragging'));
  ck('mac-chat: 没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} catch (e) { ck('mac-chat: 打开', false, String(e.message || e).split('\n')[0]); }

// ── win-node:分离窗里的「节点信息」页 ───────────────────────────────────────────
try {
  const { ctx, page, errors } = await open({ ua: WIN_UA, label: CHAT_LABEL, osName: 'windows' });
  await page.locator('[data-testid="chat-header-more"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="chat-header-more"]').first().click();
  // 聊天信息第一行是 agent 的资料行(label = alias,chat-info-model.ts 'node'),点它进「节点信息」
  await page.locator('[data-testid="chat-info-panel"]').getByText('示例-A').first().click({ timeout: 5000 });
  await page.locator('[data-testid="screen-header"]').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  if (OUT) await page.screenshot({ path: `${OUT}/win-node.png` });
  const m = await page.evaluate(measure);
  ck('win-node: 节点信息页仍有一套 – □ ×(没有聊天页头也能关窗)', m.controls.length === 3, String(m.controls.length));
  ck('win-node: 页头是 deep 拖动区', m.headerTestId === 'screen-header' && m.headerDrag === 'deep', `${m.headerTestId}/${m.headerDrag}`);
  ck('win-node: 返回键不和控件重叠', !!m.back && !m.controls.some(c => overlap(c, m.back)), JSON.stringify(m.back));
  const pin = await page.evaluate(() => { const el = document.querySelector('[aria-label*="置顶"]'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, r: b.right, y: b.top, b: b.bottom }; });
  ck('win-node: 浮动图钉(若有)不和控件重叠', !pin || !m.controls.some(c => overlap(c, pin)), JSON.stringify(pin));
  ck('win-node: 没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} catch (e) { ck('win-node: 打开节点信息', false, String(e.message || e).split('\n')[0]); }

// ── win-main(对照):主窗不变 ───────────────────────────────────────────────────
try {
  const { ctx, page, errors } = await open({ ua: WIN_UA, label: 'main', osName: 'windows', query: '' });
  await page.locator('text=示例-A').first().waitFor({ timeout: 20000 });
  await page.locator('text=示例-A').first().click();
  await page.locator('[data-testid="chat-header"]').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  if (OUT) await page.screenshot({ path: `${OUT}/win-main.png` });
  const m = await page.evaluate(measure);
  ck('win-main(对照): 主窗照旧一条 WinTitleBar、恰好 3 个控件', m.winTitleBars === 1 && m.controls.length === 3, `${m.winTitleBars}/${m.controls.length}`);
  ck('win-main(对照): 没有页头控件', !m.popout);
  ck('win-main(对照): 主窗的聊天页头不是拖动区', m.headerDrag === null, String(m.headerDrag));
  ck('win-main: 没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} catch (e) { ck('win-main: 打开', false, String(e.message || e).split('\n')[0]); }

// ── android:桌面专用守卫 ─────────────────────────────────────────────────────────
try {
  const { ctx, page } = await open({ ua: ANDROID_UA, label: CHAT_LABEL, osName: 'android' });
  await page.locator('[data-testid="chat-header"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  ck('android: 0 个窗口控件、页头不是拖动区', m.controls.length === 0 && !m.popout && m.headerDrag === null, `${m.controls.length}/${m.headerDrag}`);
  await ctx.close();
} catch (e) { ck('android: 打开', false, String(e.message || e).split('\n')[0]); }

console.table(table);
await browser.close();
web.close();
console.log(`\npopout-titlebar: ${pass}/${pass + failures.length} passed`);
if (failures.length) process.exit(1);
