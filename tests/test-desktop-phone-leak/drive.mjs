// 手机交互漏进桌面(Owner 2026-09-27「Windows / Mac 跟安卓版肯定是不一样的」)—— 真应用里逐项验。
// expo web 导出 + layout sweep 的 Tauri 桥桩(所有 hub 请求在页内用占位数据回答:无 hub 进程、无端口、
// 不碰 HOME;别名是 示例-A 之类的占位)。不进 CI:要 Playwright + Chromium。
//
//   WEB_DIR=<expo web export> OUT=<png dir> [BASELINE=1] [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-desktop-phone-leak/drive.mjs
//
// 桌面 1200×800(Tauri 壳,无安卓 UA):
//   msg-hold       鼠标按住回复气泡 800ms:不出任何菜单(以前是手机底部 action sheet)
//   msg-right      右键气泡:锚定菜单落在光标处,没有「选择文本」
//   msg-hover      悬停气泡:复制 + ⋯ 两个钮,指针移上去不消失(以前一移上去就卸掉),同高同顶、间距 4;
//                  点 ⋯ = 同一份锚定菜单,落在 ⋯ 正下方
//   msg-key        焦点在气泡上按 Shift+F10:菜单落在气泡里(Chromium / WebView2 把它派成 contextmenu,回归项)
//   row-right/key  会话行右键 / Shift+F10:行菜单落在这一行上(回归项)
//   schedule       新建定时任务:居中对话框(四边留白对称),标题 + ✕,底部 取消 / 保存 同高同中线;Esc 关
//   picker         「选服务器」(daemon 建不了节点):文案不说「下拉」,标题栏右侧「刷新」与标题同中线,点了真的重拉
//   copy           每个桌面页的可见文字 + aria-label 里没有 上滑/下滑/左滑/右滑/滑动/下拉刷新/长按/按住
//   cursor         每个桌面页上可聚焦的可点元素都是手形指针(会话行按系统列表惯例是箭头,单列)
//   select         任务详情里的回复正文可以鼠标选中(三击后 getSelection 非空)
// 手机 390×844(安卓 UA):同样的入口仍是手机的 —— 长按气泡 = 底部 sheet(含「选择文本」)、表单整屏、
//   「下拉刷新」文案、返回键、没有「刷新」钮、没有悬停按钮。
// 退出码 1 = 有断言失败(BASELINE=1 只记录不判,给「修之前」那一列)。
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
const BASELINE = process.env.BASELINE === '1';
if (!WEB || !OUT) throw new Error('need WEB_DIR and OUT');
mkdirSync(OUT, { recursive: true });
const ALIAS = '示例-A';
const REPLY = '示例回复:构建通过。';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const GESTURE = /上滑|下滑|左滑|右滑|滑动|下拉刷新|长按|按住/;
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;

const results = [];
const measures = [];
let failed = 0;
const check = (tag, name, ok, detail = '') => {
  results.push({ tag, name, ok, detail });
  if (!ok && !BASELINE) failed++;
  console.log(`${ok ? 'PASS' : BASELINE ? 'BASE' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const measure = (surface, what, value, want) => { measures.push({ surface, what, value, want }); };

// Runs after the harness stub: the 选服务器 daemon reports it cannot create nodes (so the
// 「建不了节点 … 刷新」 line shows), and every host-supervisors fetch is counted (refresh must re-fetch).
const overrides = () => {
  // The harness answers plugin:event|listen but has no event-plugin internals, so unlisten throws.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ ??= { unregisterListener: () => {} };
  const inner = window.__TAURI_INTERNALS__.invoke;
  const mine = new Map(); const bodies = new Map(); let rid = 5_000_000;
  window.__hostSupervisorFetches = 0;
  const iso = new Date().toISOString();
  const daemons = [{ daemon_node_id: 'd_leak_1', alias: '示例-守护', hostname: 'host-d', online: true, last_seen_at: iso, runtimes_supported: ['claude-code'], can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_unknown', create_capability_observed_ms_ago: 1000 }];
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd === 'plugin:http|fetch' && /\/api\/host-supervisors/.test(args?.clientConfig?.url ?? '')) {
      const id = ++rid; mine.set(id, args.clientConfig); return id;
    }
    if (cmd === 'plugin:http|fetch_send' && mine.has(args.rid)) {
      window.__hostSupervisorFetches++;
      const id = ++rid; bodies.set(id, { buf: new TextEncoder().encode(JSON.stringify({ ok: true, count: 1, daemons })), sent: false });
      return { status: 200, statusText: 'OK', url: mine.get(args.rid).url, headers: [['content-type', 'application/json']], rid: id };
    }
    if (cmd === 'plugin:http|fetch_read_body' && bodies.has(args.rid)) {
      const b = bodies.get(args.rid);
      if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
      return [1];
    }
    return inner(cmd, args);
  };
};

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

async function open(L) {
  const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, colorScheme: 'light', deviceScaleFactor: 1, ...(L.ua ? { userAgent: L.ua, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  await page.addInitScript(initScript, { theme: 'light' });
  await page.addInitScript(overrides);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
const go = async (page, screen) => { await page.evaluate((s) => window.__anetLayoutSweep.setScreen(s), screen); await page.waitForTimeout(700); };
const box = async (page, sel) => ((await page.locator(sel).count()) ? page.locator(sel).first().boundingBox() : null);
const modalOpen = (page) => page.evaluate(() => [...document.querySelectorAll('[aria-modal="true"]')].some(el => el.getBoundingClientRect().height > 0));
const menuPanel = (page) => page.evaluate(() => {
  // The message menu's panel: the outermost ancestor of its 复制消息 item that is still smaller than the
  // window (the next one up is the full-window backdrop) — the anchored card on desktop, the sheet on touch.
  const item = [...document.querySelectorAll('[aria-modal="true"] [aria-label="复制消息"]')].pop();
  if (!item) return null;
  let el = item;
  while (el.parentElement) {
    const r = el.parentElement.getBoundingClientRect();
    if (r.height >= innerHeight - 1 && r.width >= innerWidth - 1) break;
    el = el.parentElement;
  }
  const r = el.getBoundingClientRect();
  const labels = [...el.querySelectorAll('[role="button"], [tabindex]')].map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean);
  return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, right: r.right, labels };
});
const closeModal = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); if (await modalOpen(page)) { await page.mouse.click(5, 5); await page.waitForTimeout(300); } };
const openChat = async (page) => {
  await go(page, { name: 'chat', alias: ALIAS });
  await page.getByText(REPLY, { exact: true }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
};

// ── 桌面 ─────────────────────────────────────────────────────────────────────────────────────
{
  const L = { name: 'desktop', w: 1200, h: 800 };
  const tag = 'desktop-1200x800';
  const { ctx, page, errors } = await open(L);
  await openChat(page);
  const bubble = page.locator('[data-message-part="reply"]').first();
  const bubbleVisible = await bubble.count() > 0;
  const replyText = page.getByText(REPLY, { exact: true }).first();
  const tb = await replyText.boundingBox();

  // msg-hold
  await page.mouse.move(tb.x + 20, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  const heldOpen = await modalOpen(page);
  const heldPanel = heldOpen ? await menuPanel(page) : null;
  await page.screenshot({ path: `${OUT}/${tag}-msg-hold.png` });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check(tag, 'msg-hold: mouse press-and-hold on a bubble opens no menu (no phone action sheet)', !heldOpen, heldOpen ? `menu opened: bottom=${r1(heldPanel?.bottom ?? -1)} of ${L.h}` : 'nothing opened');
  if (await modalOpen(page)) await closeModal(page);

  // msg-right
  const rx = tb.x + 30, ry = tb.y + tb.height / 2;
  await replyText.click({ button: 'right', position: { x: 30, y: tb.height / 2 } });
  await page.waitForTimeout(400);
  const rp = await menuPanel(page);
  await page.screenshot({ path: `${OUT}/${tag}-msg-right.png` });
  check(tag, 'msg-right: right-click opens the anchored menu at the cursor (±2px)', !!rp && Math.abs(rp.x - rx) <= 2 && Math.abs(rp.y - ry) <= 2, rp ? `menu at (${r1(rp.x)},${r1(rp.y)}) cursor (${r1(rx)},${r1(ry)})` : 'no menu');
  check(tag, 'msg-right: no 「选择文本」 (mouse selects in place)', !!rp && !rp.labels.includes('选择文本'), rp ? rp.labels.join('/') : '');
  await closeModal(page);

  // msg-hover — first: can the pointer reach the hover buttons at all? (RN-web Pressable hover has
  // `contain`: entering a nested Pressable fires the bubble's onHoverOut, which unmounted them.)
  await replyText.hover();
  await page.waitForTimeout(300);
  const copySel = '[data-message-part="reply"] [aria-label="复制消息"]';
  const cb0 = await box(page, copySel);
  if (cb0) { await page.mouse.move(cb0.x + cb0.width / 2, cb0.y + cb0.height / 2); await page.waitForTimeout(300); }
  check(tag, 'msg-hover: the hover 复制 button is still there when the pointer reaches it', !!cb0 && (await page.locator(copySel).count()) > 0, cb0 ? `${await page.locator(copySel).count()} after moving onto it` : 'no hover button');
  await replyText.hover();
  await page.waitForTimeout(300);
  const copyB = await box(page, '[data-testid="message-hover-actions"] [aria-label="复制消息"]');
  const moreB = await box(page, tid('message-hover-more'));
  // The visual bubble is the hover row's parent (the Pressable around it also holds the quote chip).
  const bubB = await page.evaluate(() => { const r = document.querySelector('[data-testid="message-hover-actions"]')?.parentElement?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; })
    ?? (bubbleVisible ? await bubble.boundingBox() : null);
  await page.screenshot({ path: `${OUT}/${tag}-msg-hover.png`, clip: bubB ? { x: Math.max(0, bubB.x - 40), y: Math.max(0, bubB.y - 30), width: Math.min(L.w, bubB.width + 80), height: bubB.height + 60 } : undefined });
  check(tag, 'msg-hover: hovering a bubble shows 复制 + ⋯', !!copyB && !!moreB);
  if (copyB && moreB) {
    measure('气泡悬停按钮', '复制 与 ⋯ 顶边差', r1(moreB.y - copyB.y), '0');
    measure('气泡悬停按钮', '复制 与 ⋯ 高度', `${r1(copyB.height)} / ${r1(moreB.height)}`, '24 / 24');
    measure('气泡悬停按钮', '复制 → ⋯ 水平间距', r1(moreB.x - (copyB.x + copyB.width)), '4');
    measure('气泡悬停按钮', '⋯ 右缘伸出气泡右缘', r1(moreB.x + moreB.width - (bubB.x + bubB.width)), '12');
    measure('气泡悬停按钮', '按钮顶边 − 气泡顶边', r1(copyB.y - bubB.y), '-10');
    check(tag, 'msg-hover: 复制 and ⋯ share a top edge and a 24px size, 4px apart', Math.abs(moreB.y - copyB.y) <= 0.5 && Math.abs(copyB.height - 24) <= 0.5 && Math.abs(moreB.height - 24) <= 0.5 && Math.abs(moreB.x - copyB.x - copyB.width - 4) <= 0.5);
    await page.locator(tid('message-hover-more')).click();
    await page.waitForTimeout(400);
    const mp = await menuPanel(page);
    await page.screenshot({ path: `${OUT}/${tag}-msg-more.png` });
    check(tag, 'msg-hover: ⋯ opens the same anchored menu right under the button (left ±1, top = bottom + 4 ±1)', !!mp && Math.abs(mp.x - moreB.x) <= 1 && Math.abs(mp.y - (moreB.y + moreB.height + 4)) <= 1, mp ? `menu (${r1(mp.x)},${r1(mp.y)}) ⋯ (${r1(moreB.x)},${r1(moreB.y + moreB.height)})` : 'no menu');
    if (mp) { measure('⋯ 打开的菜单', '菜单左缘 − ⋯ 左缘', r1(mp.x - moreB.x), '0'); measure('⋯ 打开的菜单', '菜单顶边 − ⋯ 底边', r1(mp.y - moreB.y - moreB.height), '4'); }
    await closeModal(page);
  } else check(tag, 'msg-hover: ⋯ opens the anchored menu', false, 'no hover buttons');

  // msg-key
  const bb = await bubble.boundingBox().catch(() => null);
  const focused = await page.evaluate(() => { const el = document.querySelector('[data-message-part="reply"]'); el?.focus?.(); return document.activeElement === el; });
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(400);
  const kp = await menuPanel(page);
  await page.screenshot({ path: `${OUT}/${tag}-msg-key.png` });
  check(tag, 'msg-key: Shift+F10 on a focused bubble opens the menu inside that bubble', focused && !!kp && !!bb && kp.x >= bb.x && kp.x <= bb.x + bb.width && kp.y >= bb.y && kp.y <= bb.y + bb.height, kp && bb ? `menu (${r1(kp.x)},${r1(kp.y)}) bubble [${r1(bb.x)},${r1(bb.y)} ${r1(bb.width)}×${r1(bb.height)}] focused=${focused}` : `focused=${focused} menu=${!!kp}`);
  await closeModal(page);

  // row-right / row-key
  await go(page, { name: 'agents' });
  const row = page.locator(`[data-agent-alias="${ALIAS}"]`).first();
  await row.waitFor({ timeout: 10000 });
  await row.click({ button: 'right' });
  await page.waitForTimeout(400);
  const rowMenuOpen = await page.locator(tid('agent-row-menu')).count().then(n => n > 0).catch(() => false) || await modalOpen(page);
  await page.screenshot({ path: `${OUT}/${tag}-row-right.png` });
  check(tag, 'row-right: right-click on a conversation row opens the row menu', rowMenuOpen);
  await closeModal(page);
  const rb = await row.boundingBox();
  const rowFocused = await page.evaluate((a) => { const el = document.querySelector(`[data-agent-alias="${a}"]`); el?.focus?.(); return document.activeElement === el; }, ALIAS);
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(400);
  const rowMenuBox = await page.evaluate(() => {
    const m = document.querySelector('[aria-modal="true"]');
    if (!m) return null;
    // the menu card: the first descendant narrower than the window
    const cands = [...m.querySelectorAll('div')].filter(d => { const r = d.getBoundingClientRect(); return r.width > 80 && r.width < 400 && r.height > 40; });
    const r = cands[0]?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  });
  await page.screenshot({ path: `${OUT}/${tag}-row-key.png` });
  check(tag, 'row-key: Shift+F10 on a focused row opens its menu on that row', rowFocused && !!rowMenuBox && !!rb && rowMenuBox.x >= rb.x && rowMenuBox.x <= rb.x + rb.width && rowMenuBox.y >= rb.y && rowMenuBox.y <= rb.y + rb.height, rowMenuBox && rb ? `menu (${r1(rowMenuBox.x)},${r1(rowMenuBox.y)}) row [${r1(rb.x)},${r1(rb.y)} ${r1(rb.width)}×${r1(rb.height)}]` : `focused=${rowFocused} menu=${!!rowMenuBox}`);
  await closeModal(page);

  // schedule
  await go(page, { name: 'scheduled', open: { kind: 'create', nodeId: 'n_sweep_a', seq: 1 } });
  await page.locator(tid('schedule-form')).waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const sf = await box(page, tid('schedule-form'));
  await page.screenshot({ path: `${OUT}/${tag}-schedule.png` });
  const isDialog = !!sf && sf.width < L.w - 100;
  check(tag, 'schedule: 新建定时任务 is a centred dialog, not a full-window sheet', isDialog && Math.abs(sf.x - (L.w - sf.x - sf.width)) <= 1 && Math.abs(sf.y - (L.h - sf.y - sf.height)) <= 1, sf ? `panel ${r1(sf.width)}×${r1(sf.height)} at (${r1(sf.x)},${r1(sf.y)})` : 'no form');
  if (isDialog) {
    const [title, close, cancel, save, footer, header] = await Promise.all(['schedule-form-title', 'schedule-form-close', 'schedule-form-cancel', 'schedule-form-save', 'schedule-form-footer', 'schedule-form-header'].map(id => box(page, tid(id))));
    const cy = (b) => b.y + b.height / 2;
    measure('定时任务对话框', '左右留白', `${r1(sf.x)} / ${r1(L.w - sf.x - sf.width)}`, '相等');
    measure('定时任务对话框', '上下留白', `${r1(sf.y)} / ${r1(L.h - sf.y - sf.height)}`, '相等');
    measure('定时任务对话框', '标题中线 − ✕ 中线', r1(cy(title) - cy(close)), '0');
    measure('定时任务对话框', '取消 / 保存 高度', `${r1(cancel.height)} / ${r1(save.height)}`, '32 / 32');
    measure('定时任务对话框', '取消 中线 − 保存 中线', r1(cy(cancel) - cy(save)), '0');
    measure('定时任务对话框', '保存 右缘到面板右缘', r1(sf.x + sf.width - save.x - save.width), '16 + 1 发丝边框');
    measure('定时任务对话框', '标题左缘到面板左缘', r1(title.x - sf.x), '16 + 1 发丝边框');
    measure('定时任务对话框', '取消 → 保存 间距', r1(save.x - cancel.x - cancel.width), '8');
    check(tag, 'schedule: title and ✕ share a centre line; 取消 / 保存 are 32px, same centre, 8px apart; 16px insets',
      Math.abs(cy(title) - cy(close)) <= 1 && Math.abs(cancel.height - 32) <= 0.5 && Math.abs(save.height - 32) <= 0.5 && Math.abs(cy(cancel) - cy(save)) <= 0.5
      && Math.abs(sf.x + sf.width - save.x - save.width - 16) <= 1 && Math.abs(title.x - sf.x - 16) <= 1 && Math.abs(save.x - cancel.x - cancel.width - 8) <= 0.5 && footer.y + footer.height <= sf.y + sf.height + 0.5 && header.y >= sf.y - 0.5);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check(tag, 'schedule: Esc closes the dialog', (await page.locator(tid('schedule-form')).count()) === 0);
  }
  if (await page.locator(tid('schedule-form')).count()) await page.locator(tid('schedule-form-cancel')).click().catch(() => {});

  // picker
  await go(page, { name: 'picker' });
  await page.getByText('建不了节点', { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const pickerText = await page.evaluate(() => document.body.innerText);
  const refresh = await box(page, tid('picker-refresh'));
  await page.screenshot({ path: `${OUT}/${tag}-picker.png` });
  check(tag, 'picker: the blocked-daemon line does not tell a mouse user to pull down', /建不了节点/.test(pickerText) && !/下拉刷新/.test(pickerText), (pickerText.match(/⚠[^\n]*/) || [''])[0]);
  check(tag, 'picker: a 刷新 button in the header', !!refresh);
  if (refresh) {
    const hdr = await box(page, tid('screen-header'));
    const title = await page.evaluate(() => { const h = document.querySelector('[data-testid="screen-header"]'); const t = [...h.querySelectorAll('div')].find(d => d.textContent === '选服务器' && !d.children.length); const r = t.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    const cyT = title.y + title.height / 2, cyR = refresh.y + refresh.height / 2;
    measure('选服务器 刷新', '刷新 中线 − 标题中线', r1(cyR - cyT), '0');
    measure('选服务器 刷新', '左内边距(标题) / 右内边距(刷新)', `${r1(title.x - hdr.x)} / ${r1(hdr.x + hdr.width - refresh.x - refresh.width)}`, '相等');
    measure('选服务器 刷新', '刷新 高度', r1(refresh.height), '32');
    check(tag, 'picker: 刷新 centred with the title (±1) and inset like the title (±1)', Math.abs(cyR - cyT) <= 1 && Math.abs((title.x - hdr.x) - (hdr.x + hdr.width - refresh.x - refresh.width)) <= 1);
    const before = await page.evaluate(() => window.__hostSupervisorFetches);
    await page.locator(tid('picker-refresh')).click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.__hostSupervisorFetches);
    check(tag, 'picker: 刷新 re-fetches the daemon list', after > before, `fetches ${before} → ${after}`);
  }

  // copy + cursor on every desktop page
  const pages = [
    ['agents', { name: 'agents' }], ['chat', { name: 'chat', alias: ALIAS }], ['tasks', { name: 'tasks' }], ['scheduled', { name: 'scheduled' }],
    ['server', { name: 'server' }], ['serverNodes', { name: 'serverNodes' }], ['nodeDetail', { name: 'nodeDetail', alias: ALIAS }],
    ['settings', { name: 'settings' }], ['picker', { name: 'picker' }], ['logs', { name: 'logs' }], ['taskDetail', { name: 'taskDetail', taskId: 't_sweep_1' }],
  ];
  const cursorRows = [];
  for (const [name, screen] of pages) {
    await go(page, screen);
    await page.waitForTimeout(500);
    const scan = await page.evaluate((src) => {
      const re = new RegExp(src);
      const text = document.body.innerText;
      const labels = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'));
      const hits = [...text.split('\n'), ...labels].filter(s => s && re.test(s));
      const clickables = [...document.querySelectorAll('[tabindex="0"]')].filter(el => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.getAttribute('contenteditable') !== 'true';
      });
      const notPointer = clickables.filter(el => getComputedStyle(el).cursor !== 'pointer');
      const rowDefault = notPointer.filter(el => el.hasAttribute('data-agent-alias'));
      const other = notPointer.filter(el => !el.hasAttribute('data-agent-alias')).map(el => `${el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.textContent.trim().slice(0, 16)}:${getComputedStyle(el).cursor}`);
      return { hits, clickables: clickables.length, rowDefault: rowDefault.length, other };
    }, GESTURE.source);
    check(tag, `copy[${name}]: no gesture words in visible text / aria-labels`, scan.hits.length === 0, scan.hits.slice(0, 3).join(' | '));
    check(tag, `cursor[${name}]: every focusable clickable shows the pointer cursor (${scan.clickables} checked; ${scan.rowDefault} list rows use the arrow by design)`, scan.other.length === 0, scan.other.slice(0, 4).join(' | '));
    cursorRows.push({ page: name, clickables: scan.clickables, arrowRows: scan.rowDefault, otherNonPointer: scan.other.length });
  }
  writeFileSync(`${OUT}/${tag}-cursor.json`, JSON.stringify(cursorRows, null, 2));

  // select
  await go(page, { name: 'taskDetail', taskId: 't_sweep_1' });
  const sel = page.getByText(REPLY, { exact: false }).first();
  let selected = '';
  if (await sel.count()) { await sel.click({ clickCount: 3 }); selected = await page.evaluate(() => String(getSelection())); }
  check(tag, 'select: the reply text in 任务详情 can be selected with the mouse', selected.includes('构建通过'), JSON.stringify(selected.slice(0, 30)));
  await openChat(page);
  const chatSel = page.getByText(REPLY, { exact: true }).first();
  await chatSel.click({ clickCount: 3 });
  const chatSelected = await page.evaluate(() => String(getSelection()));
  check(tag, 'select: the reply text in a chat bubble can be selected with the mouse', chatSelected.includes('构建通过'), JSON.stringify(chatSelected.slice(0, 30)));

  check(tag, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 手机 ─────────────────────────────────────────────────────────────────────────────────────
{
  const L = { name: 'phone', w: 390, h: 844, ua: PHONE_UA };
  const tag = 'phone-390x844';
  const { ctx, page, errors } = await open(L);
  await openChat(page);
  const replyText = page.getByText(REPLY, { exact: true }).first();
  await replyText.click({ delay: 700 });
  await page.waitForTimeout(500);
  const sp = await menuPanel(page);
  await page.screenshot({ path: `${OUT}/${tag}-msg-hold.png` });
  check(tag, 'msg-hold: long-press still opens the bottom action sheet (panel bottom = window bottom ±1)', !!sp && Math.abs(sp.bottom - L.h) <= 1, sp ? `bottom=${r1(sp.bottom)}` : 'no sheet');
  check(tag, 'msg-hold: the sheet offers 「选择文本」', !!sp && sp.labels.includes('选择文本'), sp ? sp.labels.join('/') : '');
  await closeModal(page);
  await replyText.hover().catch(() => {});
  check(tag, 'msg-hover: no hover buttons on touch', (await page.locator(tid('message-hover-actions')).count()) === 0);

  await go(page, { name: 'agents' });
  const row = page.locator(`[data-agent-alias="${ALIAS}"]`).first();
  await row.waitFor({ timeout: 10000 });
  await row.click({ delay: 700 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${tag}-row-hold.png` });
  check(tag, 'row-hold: long-press on a row still opens the row menu', await modalOpen(page));
  await closeModal(page);

  await go(page, { name: 'scheduled', open: { kind: 'create', nodeId: 'n_sweep_a', seq: 1 } });
  await page.locator(tid('schedule-form')).waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const sf = await box(page, tid('schedule-form'));
  await page.screenshot({ path: `${OUT}/${tag}-schedule.png` });
  check(tag, 'schedule: form is still the full-screen sheet with 取消 · 标题 · 保存 on top', !!sf && Math.abs(sf.width - L.w) <= 1 && (await page.locator(tid('schedule-form-footer')).count()) === 0, sf ? `${r1(sf.width)}×${r1(sf.height)}` : 'no form');
  if (await page.locator(tid('schedule-form')).count()) await page.locator(tid('schedule-form-cancel')).click().catch(() => {});

  await go(page, { name: 'picker' });
  await page.getByText('建不了节点', { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/${tag}-picker.png` });
  // text right ≠ text visible (title-blank: flex 0 1 0% + overflow:hidden painted it 0px wide): the deepest element
  // carrying 下拉刷新, its box intersected with every overflow-clipping ancestor, must be ≥ 8px wide.
  const pull = await page.evaluate(() => {
    const el = [...document.body.querySelectorAll('*')].reverse().find(e => e.getClientRects().length && /下拉刷新/.test(e.textContent));
    if (!el) return null;
    const b = el.getBoundingClientRect(); let w = b.width, h = b.height;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)));
      h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)));
    }
    return { w, h };
  });
  check(tag, 'picker: phone keeps 「下拉刷新」, the back button, and no 刷新 button', /下拉刷新/.test(text) && !!pull && pull.w >= 8 && pull.h >= 1 && (await page.locator(tid('pane-back')).count()) > 0 && (await page.locator(tid('picker-refresh')).count()) === 0, pull ? `下拉刷新 painted ${r1(pull.w)}×${r1(pull.h)}` : '下拉刷新 not rendered');
  check(tag, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
web.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, measures }, null, 2));
console.log('\n| surface | measurement | value | want |\n|---|---|---|---|');
for (const m of measures) console.log(`| ${m.surface} | ${m.what} | ${m.value} | ${m.want} |`);
const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} checks passed${BASELINE ? ' (BASELINE: not gating)' : ''}`);
process.exit(failed ? 1 : 0);
