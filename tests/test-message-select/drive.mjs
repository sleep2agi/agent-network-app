// #537(Vincent 2026-10-04 10:48,微信安卓截图):「这个需求比较高的优先级，要能支持这样的一个复制方式。」
// 长按消息 → 就地选区(默认整条选中、手柄拖动、绿色高亮)+ 气泡上方的深色浮动菜单(复制 / 全选 / 转发 / 引用 …)。
//
// 真应用(expo web 导出 + 页内 Tauri 桩,没有 hub 进程、没有端口、不碰 HOME;占位别名 示例-A),剪贴板换成桩
// (navigator.clipboard.writeText 记进 window.__clip)。
//
//   WEB_DIR=<expo export 目录> [OUT=<截图目录>] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] node tests/test-message-select/drive.mjs
//
// 手机(390×844,安卓 UA ⇒ 触摸端):
//   P1 长按底部气泡 → 选区层 + 菜单;textarea 整条选中(0..len);菜单有 复制 / 全选 / 转发 / 引用
//   P2 菜单在气泡上方(side=above),整块在视口内,与选区卡片不重叠,间隙 ≥ 4
//   P3 「复制」整条 → 剪贴板 = 整条消息
//   P4 拖成一段(setSelectionRange,等价于拖手柄)→「复制」→ 剪贴板 = 那段子串
//   P5 「全选」→ 选区回到整条,菜单不关
//   P6 点空白 → 退出(选区层消失)
//   P7 长按贴顶的气泡 → 菜单翻到下方(side=below),整块在视口内、不盖卡片
//   P8 「引用」一段 → 输入框上方的引用条是那段
// 手机 · 比屏还高的消息(#551,Vincent iPhone 截图:菜单盖住起点手柄,拖不动):
//   H1 长按 → 整条选中;菜单矩形与「起点手柄」「终点手柄」矩形都不相交(看得见的手柄才算)
//   H2 把终点拖到屏幕中段(setSelectionRange)→ 停稳后菜单重新出现,仍与两只手柄都不相交
//   H3 手指按在选区上 → 菜单隐藏(data-hidden=1、opacity 0、不接点击);松手 → 停稳后重新出现、不压手柄
//   手柄矩形由本脚本自己量(镜像 div 取起点 / 终点字符的矩形,上伸 16、下挂 28、左右各 14),不读应用算出来的值。
// 桌面(1200×850,无安卓 UA ⇒ 鼠标):
//   D1 按住鼠标 600ms 不出选区层(手机的长按 UI 不上桌面)
//   D2 鼠标在气泡里拖选 → 浏览器原生选区有字
//   D3 右键 → 菜单有「复制选中内容」和「复制」;点前者 → 剪贴板 = 拖选的那段
// 打印一张 boundingBox 测量表。退出码 1 = 任何一条失败。
import { mkdirSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR;
if (!WEB) throw new Error('need WEB_DIR (expo web export)');
const OUT = process.env.OUT || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
// 截图里那句(合成占位文本,不是任何人的消息)
const BOTTOM = '创造型人才和哲学家，本质上就无法经营婚姻。这是一句用来测长按选区的示例文字。';
const TOP = '置顶测量用的示例气泡:它会被滚到屏幕最上沿,菜单放不下上方就要翻到下方。';
const FILLER = (i) => `第 ${i} 条示例消息,用来把列表撑满一屏。`;
// #551:比屏还高的一条(合成占位文本)
const TALL = Array.from({ length: 34 }, (_, i) => `第 ${i + 1} 行:这是一条很长的示例回复,用来复现菜单压住起点手柄。`).join('\n');

const chatInit = ({ bottom, top, fillers }) => {
  const now = Date.now();
  const iso = (m) => new Date(now - m * 60000).toISOString();
  // newest first
  window.__chatTasksFixture = [
    { task_id: 't_sel_bottom', from_name: 'tester', to_name: '示例-A', content: '请复述一下', result: bottom, status: 'replied', priority: 'normal', created_at: iso(2), updated_at: iso(1), completed_at: iso(1) },
    ...fillers.map((f, i) => ({ task_id: `t_sel_f${i}`, from_name: 'tester', to_name: '示例-A', content: f, status: 'delivered', priority: 'normal', created_at: iso(10 + i), updated_at: iso(10 + i) })),
    { task_id: 't_sel_top', from_name: 'tester', to_name: '示例-A', content: top, status: 'delivered', priority: 'normal', created_at: iso(60), updated_at: iso(60) },
  ];
  window.__clip = [];
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (v) => { window.__clip.push(String(v)); }, readText: async () => window.__clip.at(-1) ?? '' } });
  } catch {}
};

let failures = 0, total = 0;
const ck = (tag, name, cond, detail = '') => { total++; if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`); };
const rows = [];
const r1 = (n) => Math.round(n * 10) / 10;
const shots = [];

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

/** 气泡 = 文字最近的、有底色且有圆角的祖先。 */
const bubbleBox = (page, text) => page.evaluate((t) => {
  const bg = (el) => { const c = getComputedStyle(el).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; };
  const hit = [...document.querySelectorAll('div[dir="auto"], span')].find(e => e.textContent.trim() === t && e.getClientRects().length);
  if (!hit) return null;
  let b = hit.parentElement;
  while (b && !(bg(b) && parseFloat(getComputedStyle(b).borderTopLeftRadius) > 0)) b = b.parentElement;
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, text);

const layerState = (page) => page.evaluate(() => {
  const box = (sel) => { const el = document.querySelector(sel); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
  const ta = document.querySelector('[data-testid="msg-select-text"]');
  const menu = document.querySelector('[data-testid="msg-select-menu"]');
  return {
    open: !!document.querySelector('[data-testid="msg-select-layer"]'),
    menu: box('[data-testid="msg-select-menu"]'),
    card: box('[data-testid="msg-select-card"]'),
    side: menu?.getAttribute('data-side') ?? null,
    opacity: menu ? Number(getComputedStyle(menu).opacity) : null,
    labels: menu ? [...menu.querySelectorAll('[role="menuitem"]')].map(e => e.getAttribute('aria-label')) : [],
    sel: ta ? { start: ta.selectionStart, end: ta.selectionEnd, len: ta.value.length, value: ta.value } : null,
    vw: window.innerWidth, vh: window.innerHeight,
  };
});

const longPress = async (page, box) => {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForFunction(() => { const m = document.querySelector('[data-testid="msg-select-menu"]'); return m && m.getAttribute('data-side') !== 'measuring' && getComputedStyle(m).opacity === '1'; }, null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(250);
};

/** 菜单几何断言 + 一行测量表。 */
const geometry = (tag, label, s, expectSide) => {
  const m = s.menu, c = s.card;
  const inside = !!m && m.x >= 0 && m.y >= 0 && m.right <= s.vw && m.bottom <= s.vh;
  const gap = !m || !c ? NaN : s.side === 'above' ? c.y - m.bottom : s.side === 'below' ? m.y - c.bottom : NaN;
  const overlap = !m || !c ? true : !(m.bottom <= c.y || m.y >= c.bottom || m.right <= c.x || m.x >= c.right);
  ck(tag, `${label}: 菜单 side=${expectSide}`, s.side === expectSide, `side=${s.side}`);
  ck(tag, `${label}: 菜单整块在视口内`, inside, m ? `menu x=${r1(m.x)} y=${r1(m.y)} right=${r1(m.right)} bottom=${r1(m.bottom)} vw=${s.vw} vh=${s.vh}` : 'no menu');
  ck(tag, `${label}: 菜单不盖选区卡片,间隙 ≥ 4`, !overlap && gap >= 4, `gap=${r1(gap)}`);
  rows.push({ tag, label, side: s.side, menu: m ? `${r1(m.x)},${r1(m.y)} ${r1(m.width)}×${r1(m.height)}` : '-', card: c ? `${r1(c.x)},${r1(c.y)} ${r1(c.width)}×${r1(c.height)}` : '-', gap: r1(gap), inside: inside ? 'yes' : 'NO', overlap: overlap ? 'YES' : 'no', vp: `${s.vw}×${s.vh}` });
};

const setPartial = (page, a, b) => page.evaluate(([a, b]) => {
  const ta = document.querySelector('[data-testid="msg-select-text"]');
  ta.focus(); ta.setSelectionRange(a, b); ta.dispatchEvent(new Event('select', { bubbles: true }));
}, [a, b]);
const clip = (page) => page.evaluate(() => window.__clip.slice());
const click = (page, testId) => page.locator(`[data-testid="${testId}"]`).click();

// ── 手机 ───────────────────────────────────────────────────────────────────
{
  const tag = 'phone';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PHONE_UA, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  try {
    await page.addInitScript(chatInit, { bottom: BOTTOM, top: TOP, fillers: Array.from({ length: 6 }, (_, i) => FILLER(i + 1)) });
    await page.addInitScript(initScript, { theme: 'light' });
    await page.goto(`${web.url}?safeAreaSim=32,0,24,0`);
    await page.getByText('示例-A', { exact: true }).first().click({ timeout: 20000 });
    await page.getByText(BOTTOM, { exact: true }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);

    // P1 / P2
    let bb = await bubbleBox(page, BOTTOM);
    ck(tag, '找到底部气泡', !!bb, JSON.stringify(bb));
    await longPress(page, bb);
    let s = await layerState(page);
    ck(tag, 'P1 长按 → 选区层打开', s.open && !!s.card && !!s.menu);
    ck(tag, 'P1 默认整条选中', !!s.sel && s.sel.start === 0 && s.sel.end === s.sel.len && s.sel.len === BOTTOM.length, JSON.stringify(s.sel && { start: s.sel.start, end: s.sel.end, len: s.sel.len }));
    ck(tag, 'P1 菜单有 复制 / 全选 / 转发 / 引用', ['复制', '全选', '转发', '引用'].every(l => s.labels.includes(l)), s.labels.join(' '));
    ck(tag, 'P1 原长按菜单的动作仍在(多选 / 放大阅读 / 删除)', ['多选', '放大阅读', '删除'].every(l => s.labels.includes(l)), s.labels.join(' '));
    ck(tag, 'P1 卡片盖在气泡上(同左、同宽、同顶)', !!s.card && Math.abs(s.card.x - bb.x) <= 1 && Math.abs(s.card.width - bb.width) <= 1 && Math.abs(s.card.y - bb.y) <= 1, `card=${JSON.stringify(s.card && { x: r1(s.card.x), y: r1(s.card.y), w: r1(s.card.width) })} bubble=${JSON.stringify({ x: r1(bb.x), y: r1(bb.y), w: r1(bb.width) })}`);
    geometry(tag, 'P2 底部气泡', s, 'above');
    if (OUT) { const f = `${OUT}/select-phone-bottom-above.png`; await page.screenshot({ path: f }); shots.push(f); }

    // P3 复制整条
    await page.evaluate(() => { window.__clip = []; });
    await click(page, 'msg-select-copy');
    await page.waitForTimeout(300);
    let c = await clip(page);
    ck(tag, 'P3 复制整条 → 剪贴板 = 整条消息', c.length === 1 && c[0] === BOTTOM, JSON.stringify(c));
    s = await layerState(page);
    ck(tag, 'P3 复制后退出选区', !s.open);

    // P4 一段
    bb = await bubbleBox(page, BOTTOM);
    await longPress(page, bb);
    const A = 2, B = 18; // 「型人才和哲学家，本质上就无法经营」
    await setPartial(page, A, B);
    await page.waitForTimeout(250);
    s = await layerState(page);
    ck(tag, 'P4 选区变成一段', !!s.sel && s.sel.start === A && s.sel.end === B, JSON.stringify(s.sel && { start: s.sel.start, end: s.sel.end }));
    if (OUT) { const f = `${OUT}/select-phone-partial.png`; await page.screenshot({ path: f }); shots.push(f); }
    // P5 全选(先于复制测,菜单不关)
    await click(page, 'msg-select-selectAll');
    await page.waitForTimeout(250);
    s = await layerState(page);
    ck(tag, 'P5 全选 → 回到整条,菜单仍在', s.open && !!s.sel && s.sel.start === 0 && s.sel.end === s.sel.len, JSON.stringify(s.sel && { start: s.sel.start, end: s.sel.end }));
    await setPartial(page, A, B);
    await page.waitForTimeout(250);
    await page.evaluate(() => { window.__clip = []; });
    await click(page, 'msg-select-copy');
    await page.waitForTimeout(300);
    c = await clip(page);
    ck(tag, 'P4 复制一段 → 剪贴板 = 那段子串', c.length === 1 && c[0] === BOTTOM.slice(A, B), JSON.stringify(c));

    // P6 点空白退出
    bb = await bubbleBox(page, BOTTOM);
    await longPress(page, bb);
    s = await layerState(page);
    // 空白点:菜单和卡片都不在的地方(屏幕左边缘中部)
    const blank = { x: 6, y: Math.round(s.vh * 0.45) };
    const onSomething = [s.menu, s.card].some(r => r && blank.x >= r.x && blank.x <= r.right && blank.y >= r.y && blank.y <= r.bottom);
    ck(tag, 'P6 选的空白点不在菜单 / 卡片上', !onSomething);
    await page.mouse.click(blank.x, blank.y);
    await page.waitForTimeout(300);
    s = await layerState(page);
    ck(tag, 'P6 点空白 → 退出选区', !s.open);

    // P7 贴顶的气泡:把最老那条滚到页头下面
    // 列表是倒置的:用滚轮一步步把它挪到页头下面(目标顶边 ≈ 120,上方放不下 147 高的菜单)
    await page.mouse.move(200, 400);
    for (let i = 0; i < 40; i++) {
      const b = await bubbleBox(page, TOP);
      const y = b ? b.y : -9999;
      if (y > 100 && y < 170) break;
      await page.mouse.wheel(0, y < 100 ? -40 : 40);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(500);
    const tb = await bubbleBox(page, TOP);
    ck(tag, 'P7 顶部气泡在屏幕上沿附近(上方放不下菜单)', !!tb && tb.y < 200, JSON.stringify(tb && { y: r1(tb.y) }));
    await longPress(page, tb);
    s = await layerState(page);
    geometry(tag, 'P7 顶部气泡', s, 'below');
    if (OUT) { const f = `${OUT}/select-phone-top-below.png`; await page.screenshot({ path: f }); shots.push(f); }

    // P8 引用一段
    await setPartial(page, 0, 6);
    await page.waitForTimeout(200);
    const quotePart = TOP.slice(0, 6);
    await click(page, 'msg-select-quote');
    await page.waitForTimeout(400);
    const hasQuote = await page.evaluate((q) => [...document.querySelectorAll('div[dir="auto"], span')].some(e => e.getClientRects().length && e.textContent.includes(q) && !e.textContent.includes('滚到屏幕最上沿')), quotePart);
    s = await layerState(page);
    ck(tag, 'P8 引用一段 → 引用条是那段,选区层关闭', hasQuote && !s.open, `quote=${quotePart}`);
  } catch (err) {
    failures++; total++;
    console.log(`FAIL [${tag}] NOT RUN: ${String(err.message || err).split('\n')[0]}`);
  }
  await ctx.close();
}

/** 本脚本独立量的两只手柄矩形(窗口坐标;行不在卡片可视区里 = 手柄不可见 = null)。 */
const handleRects = (page) => page.evaluate(() => {
  const ta = document.querySelector('[data-testid="msg-select-text"]');
  const card = document.querySelector('[data-testid="msg-select-card"]');
  if (!ta || !card) return null;
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const k of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth', 'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'wordBreak', 'overflowWrap']) div.style[k] = cs[k];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0px', whiteSpace: 'pre-wrap', height: 'auto' });
  const node = document.createTextNode(ta.value); div.appendChild(node); document.body.appendChild(div);
  const d = div.getBoundingClientRect(), t = ta.getBoundingClientRect(), c = card.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight);
  const at = (i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getClientRects()[0] || r.getBoundingClientRect(); const mid = (q.top + q.bottom) / 2 - d.top + t.top - ta.scrollTop; return { x: q.left - d.left + t.left, lineTop: mid - lh / 2, lineBottom: mid + lh / 2 }; };
  let a = ta.selectionStart, b = Math.max(a, ta.selectionEnd - 1);
  while (a < b && ta.value[a] === '\n') a++;
  while (b > a && ta.value[b] === '\n') b--;
  const A = at(a), B = at(b);
  div.remove();
  const vis = (p) => p.lineBottom > c.top && p.lineTop < c.bottom;
  const rect = (p) => ({ x: p.x - 14, y: p.lineTop - 16, right: p.x + 14, bottom: p.lineBottom + 28 });
  return { start: vis(A) ? rect(A) : null, end: vis(B) ? rect(B) : null, sel: [ta.selectionStart, ta.selectionEnd] };
});
/** 多行消息的气泡:同时含首行和末行文字的最小元素,往上找有底色有圆角的祖先。 */
const tallBubbleBox = (page) => page.evaluate(() => {
  const bg = (el) => { const c = getComputedStyle(el).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; };
  const all = [...document.querySelectorAll('div, span')].filter(e => e.textContent.includes('第 1 行:') && e.textContent.includes('第 34 行:') && e.getClientRects().length && !e.closest('[data-testid="msg-select-layer"]'));
  const hit = all.find(e => ![...e.children].some(ch => all.includes(ch)));  // 最深的那个
  if (!hit) return null;
  let b = hit;
  while (b && !(bg(b) && parseFloat(getComputedStyle(b).borderTopLeftRadius) > 0)) b = b.parentElement;
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const hits = (m, h) => !!m && !!h && !(m.bottom <= h.y || m.y >= h.bottom || m.right <= h.x || m.x >= h.right);
const menuShown = (page) => page.waitForFunction(() => { const m = document.querySelector('[data-testid="msg-select-menu"]'); return m && m.getAttribute('data-hidden') === '0' && getComputedStyle(m).opacity === '1'; }, null, { timeout: 4000 }).then(() => true, () => false);
const handleGeometry = (tag, label, s, h) => {
  const m = s.menu;
  const inside = !!m && m.x >= 0 && m.y >= 0 && m.right <= s.vw && m.bottom <= s.vh;
  ck(tag, `${label}: 菜单整块在视口内`, inside, m ? `menu y=${r1(m.y)}..${r1(m.bottom)} vh=${s.vh}` : 'no menu');
  ck(tag, `${label}: 至少一只手柄看得见(否则这条断言是空的)`, !!h && !!(h.start || h.end), JSON.stringify(h));
  ck(tag, `${label}: 菜单不压起点手柄`, !hits(m, h?.start), h?.start ? `start y=${r1(h.start.y)}..${r1(h.start.bottom)}` : 'start 不可见');
  ck(tag, `${label}: 菜单不压终点手柄`, !hits(m, h?.end), h?.end ? `end y=${r1(h.end.y)}..${r1(h.end.bottom)}` : 'end 不可见');
  rows.push({ tag, label, side: s.side, menu: m ? `${r1(m.x)},${r1(m.y)} ${r1(m.width)}×${r1(m.height)}` : '-', card: s.card ? `${r1(s.card.x)},${r1(s.card.y)} ${r1(s.card.width)}×${r1(s.card.height)}` : '-', gap: `start ${h?.start ? `${r1(h.start.y)}..${r1(h.start.bottom)}` : '—'} / end ${h?.end ? `${r1(h.end.y)}..${r1(h.end.bottom)}` : '—'}`, inside: inside ? 'yes' : 'NO', overlap: hits(m, h?.start) || hits(m, h?.end) ? 'YES' : 'no', vp: `${s.vw}×${s.vh}` });
};

// ── 手机 · 比屏还高的消息(#551)─────────────────────────────────────────────
{
  const tag = 'phone-tall';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PHONE_UA, colorScheme: 'dark', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  try {
    await page.addInitScript(chatInit, { bottom: TALL, top: TOP, fillers: Array.from({ length: 2 }, (_, i) => FILLER(i + 1)) });
    await page.addInitScript(initScript, { theme: 'dark' });
    await page.goto(`${web.url}?safeAreaSim=47,0,34,0`);
    await page.getByText('示例-A', { exact: true }).first().click({ timeout: 20000 });
    await page.getByText('第 1 行:', { exact: false }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    // 把气泡顶滚到页头下面一点(≈ 截图:气泡顶在 y≈210,底在屏外)
    await page.mouse.move(200, 400);
    for (let i = 0; i < 60; i++) {
      const b = await tallBubbleBox(page);
      const y = b ? b.y : 9999;
      if (y > 180 && y < 260) break;
      await page.mouse.wheel(0, y > 260 ? 40 : -40);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(400);
    const tb = await tallBubbleBox(page);
    ck(tag, '气泡比可见区高、顶在屏幕上部(截图同款)', !!tb && tb.y > 120 && tb.y < 320 && tb.y + tb.height > 844, JSON.stringify(tb && { y: r1(tb.y), h: r1(tb.height) }));
    // 长按看得见的那块的中间
    await longPress(page, { x: tb.x, y: tb.y, width: tb.width, height: Math.min(tb.height, 844 - tb.y - 120) });
    let s = await layerState(page);
    ck(tag, 'H1 长按 → 选区层,整条选中', s.open && !!s.sel && s.sel.start === 0 && s.sel.end === s.sel.len, JSON.stringify(s.sel && { start: s.sel.start, end: s.sel.end, len: s.sel.len }));
    ck(tag, 'H1 菜单可见', await menuShown(page));
    s = await layerState(page);
    let h = await handleRects(page);
    handleGeometry(tag, 'H1 整条选中', s, h);
    if (OUT) { const f = `${OUT}/select-phone-tall-whole.png`; await page.screenshot({ path: f }); shots.push(f); }

    // H2 终点拖到屏幕中段:取可见区中部那一行的行尾
    const endAt = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="msg-select-text"]');
      const lines = ta.value.split('\n');
      return lines.slice(0, 12).join('\n').length;
    });
    await setPartial(page, 0, endAt);
    ck(tag, 'H2 拖完手柄停稳后菜单重新出现', await menuShown(page));
    s = await layerState(page);
    h = await handleRects(page);
    ck(tag, 'H2 选区 = 0..第 12 行行尾', !!s.sel && s.sel.start === 0 && s.sel.end === endAt, JSON.stringify(s.sel && { start: s.sel.start, end: s.sel.end }));
    handleGeometry(tag, 'H2 终点在中段', s, h);
    if (OUT) { const f = `${OUT}/select-phone-tall-partial.png`; await page.screenshot({ path: f }); shots.push(f); }

    // H3 手指按在选区上 → 菜单藏;松手 → 再出
    const card = s.card;
    const px = card.x + card.width / 2, py = Math.min(card.bottom - 30, (h?.end?.bottom ?? card.y + 200) + 60);
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const during = await page.evaluate(() => { const m = document.querySelector('[data-testid="msg-select-menu"]'); return m && { hidden: m.getAttribute('data-hidden'), opacity: getComputedStyle(m).opacity, pe: getComputedStyle(m).pointerEvents }; });
    ck(tag, 'H3 按住选区 → 菜单隐藏且不接点击', !!during && during.hidden === '1' && during.opacity === '0' && during.pe === 'none', JSON.stringify(during));
    await page.mouse.up();
    // web 上点一下会把 textarea 选区收成光标(真手机上拖手柄不会);把选区恢复成拖完的样子再看重新出现的位置
    await setPartial(page, 0, endAt);
    ck(tag, 'H3 松手停稳后菜单重新出现', await menuShown(page));
    s = await layerState(page);
    h = await handleRects(page);
    handleGeometry(tag, 'H3 松手后', s, h);
  } catch (err) {
    failures++; total++;
    console.log(`FAIL [${tag}] NOT RUN: ${String(err.message || err).split('\n')[0]}`);
  }
  await ctx.close();
}

// ── 桌面 ───────────────────────────────────────────────────────────────────
{
  const tag = 'desktop';
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  try {
    await page.addInitScript(chatInit, { bottom: BOTTOM, top: TOP, fillers: Array.from({ length: 6 }, (_, i) => FILLER(i + 1)) });
    await page.addInitScript(initScript, { theme: 'light' });
    await page.goto(web.url);
    await page.getByText('示例-A', { exact: true }).first().click({ timeout: 20000 });
    await page.getByText(BOTTOM, { exact: true }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const bb = await bubbleBox(page, BOTTOM);
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await page.waitForTimeout(300);
    let s = await layerState(page);
    ck(tag, 'D1 按住鼠标不出手机选区层', !s.open);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    // D2 拖选:从文字第 2 个字符拖到第 10 个(按字符的 client rect 定位)
    const pts = await page.evaluate((t) => {
      const hit = [...document.querySelectorAll('div[dir="auto"], span')].find(e => e.textContent.trim() === t && e.getClientRects().length);
      const node = [...hit.childNodes].find(n => n.nodeType === 3) || hit.firstChild;
      const at = (i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.left + 1, y: q.top + q.height / 2 }; };
      return { a: at(2), b: at(10) };
    }, BOTTOM);
    await page.mouse.move(pts.a.x, pts.a.y);
    await page.mouse.down();
    await page.mouse.move(pts.b.x, pts.b.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const selected = await page.evaluate(() => String(window.getSelection() || ''));
    ck(tag, 'D2 鼠标拖选在气泡里得到原生选区', selected.length >= 4 && BOTTOM.includes(selected), JSON.stringify(selected));
    s = await layerState(page);
    ck(tag, 'D2 拖选不触发手机选区层', !s.open);

    // D3 右键菜单
    await page.mouse.click(pts.b.x - 4, pts.b.y, { button: 'right' });
    await page.waitForTimeout(400);
    const menuLabels = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].filter(e => e.getClientRects().length).map(e => e.getAttribute('aria-label')));
    ck(tag, 'D3 右键菜单有「复制选中内容」和「复制」', menuLabels.includes('复制选中内容') && menuLabels.includes('复制'), menuLabels.filter(l => /复制/.test(l)).join(' / '));
    if (OUT) { const f = `${OUT}/select-desktop-rightclick.png`; await page.screenshot({ path: f }); shots.push(f); }
    await page.evaluate(() => { window.__clip = []; });
    await page.getByLabel('复制选中内容', { exact: true }).click();
    await page.waitForTimeout(300);
    const c = await clip(page);
    ck(tag, 'D3 复制选中内容 → 剪贴板 = 拖选的那段', c.length === 1 && c[0] === selected, JSON.stringify(c));
  } catch (err) {
    failures++; total++;
    console.log(`FAIL [${tag}] NOT RUN: ${String(err.message || err).split('\n')[0]}`);
  }
  await ctx.close();
}

await browser.close(); web.close();
console.log('\n| viewport | case | menu side | menu x,y w×h | card x,y w×h | gap | in viewport | overlap |\n|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.vp} | ${r.label} | ${r.side} | ${r.menu} | ${r.card} | ${r.gap} | ${r.inside} | ${r.overlap} |`);
if (shots.length) console.log(`\nscreenshots:\n${shots.join('\n')}`);
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);
