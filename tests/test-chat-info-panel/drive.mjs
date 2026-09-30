// 聊天信息 panel (chat header ⋯) in the real app: expo web export + the layout sweep's Tauri stub,
// which answers every hub request in-page from placeholder data (no hub process, no port, no HOME).
// Not in CI (needs Playwright + Chromium).
//
//   WEB_DIR=<expo web export> OUT=<png dir> [PLAYWRIGHT_MODULE=<…/playwright/index.mjs>] \
//     node tests/test-chat-info-panel/drive.mjs
//
// Layouts: desktop 1200×800 (Tauri shell, drawer) and phone 390×844 (Android UA, pushed page),
// light and dark. Per run: header screenshot + geometry, panel screenshot + geometry, every row
// clicked (navigates or toggles), Esc / outside click (drawer), history back / ‹ (page), Ctrl+F.
// Exit 1 when any check fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, paintedText } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!WEB || !OUT) throw new Error('need WEB_DIR and OUT');
mkdirSync(OUT, { recursive: true });
const ALIAS = '示例-A';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const LAYOUTS = [
  { name: 'desktop', w: 1200, h: 800, ua: undefined, presentation: 'drawer' },
  { name: 'phone', w: 390, h: 844, ua: PHONE_UA, presentation: 'page' },
];

const results = [];
let failed = 0;
const check = (tag, name, ok, detail = '') => {
  results.push({ tag, name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
// The glyph itself must be painted: range box of the text node holding `glyph`, clipped by its own element and every
// overflow ancestor (numberOfLines ellipsis / 0-wide flex item would hide it while textContent still has it).
const paintedGlyph = (page, rootSel, glyph) => page.evaluate(([s, g]) => {
  const root = document.querySelector(s); if (!root) return null;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode()) && !n.textContent.includes(g));
  if (!n) return null;
  const r = document.createRange(); const i = n.textContent.indexOf(g); r.setStart(n, i); r.setEnd(n, i + g.length);
  const b = r.getBoundingClientRect(); let w = b.width, h = b.height;
  for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a); if (a !== n.parentElement && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const c = a.getBoundingClientRect();
    w = Math.min(w, Math.max(0, Math.min(b.right, c.right) - Math.max(b.left, c.left))); h = Math.min(h, Math.max(0, Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top)));
  }
  return { w, h, painted: w >= 1 && h >= 1 };
}, [rootSel, glyph]);
const fmtP = (p) => p ? `painted ${r1(p.w)}×${r1(p.h)}` : 'painted null';

/** Header geometry: right-side actions, ⋯ vs name block centre, left / right padding. */
const measureHeader = () => {
  const h = document.querySelector('[data-testid="chat-header"]');
  const box = (el) => el.getBoundingClientRect();
  const hb = box(h);
  const title = document.querySelector('[data-testid="chat-header-title"]');
  const tb = box(title);
  const buttons = [...h.querySelectorAll('[role="button"]')].filter(b => b.getBoundingClientRect().left >= tb.right - 0.5);
  const more = document.querySelector('[data-testid="chat-header-more"]');
  const icon = document.querySelector('[data-testid="chat-header-more-icon"]');
  const mb = box(more), ib = box(icon);
  const first = h.firstElementChild;
  const fb = box(first);
  const cs = getComputedStyle(h);
  return {
    header: { x: hb.x, y: hb.y, w: hb.width, h: hb.height },
    rightActions: buttons.map(b => b.getAttribute('aria-label')),
    titleCy: tb.top + tb.height / 2,
    moreCy: mb.top + mb.height / 2,
    iconCy: ib.top + ib.height / 2,
    padLeft: fb.left - hb.left,
    // Icon buttons are measured by their touch box, as in tests/test-layout-sweep (the box is the
    // symmetric thing; the glyph is centred in it).
    padRight: hb.right - mb.right,
    cssPad: [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)],
    firstChild: first.getAttribute('data-testid') || first.getAttribute('aria-label') || first.tagName,
    floatingWindowPin: document.querySelectorAll('[data-testid="window-pin-floating"]').length,
  };
};

/** Panel geometry: row heights, label left edges, chevron / switch right edges. */
const measurePanel = () => {
  const panel = document.querySelector('[data-testid="chat-info-panel"]');
  if (!panel) return null;
  const b = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right }; };
  const rows = [...panel.querySelectorAll('[data-testid^="chat-info-row-"]')].filter(el => /^chat-info-row-[A-Za-z-]+$/.test(el.getAttribute('data-testid')) && !/-(label|chevron|switch)$/.test(el.getAttribute('data-testid')));
  return {
    panel: b(panel),
    rows: rows.map(el => {
      const id = el.getAttribute('data-testid');
      const label = panel.querySelector(`[data-testid="${id}-label"]`);
      const chevron = panel.querySelector(`[data-testid="${id}-chevron"]`);
      const sw = panel.querySelector(`[data-testid="${id}-switch"]`);
      return { id, box: b(el), label: label ? b(label) : null, chevron: chevron ? b(chevron) : null, switch: sw ? b(sw) : null };
    }),
  };
};

const switchChecked = (page, id) => page.evaluate((id) => {
  const root = document.querySelector(`[data-testid="${id}-switch"]`);
  const input = root?.querySelector('input') ?? root;
  return input ? (input.checked ?? input.getAttribute('aria-checked') === 'true') : null;
}, id);

const web = await serveExport(WEB);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const tables = { header: [], rows: [] };

for (const L of LAYOUTS) {
  for (const scheme of ['light', 'dark']) {
    const tag = `${L.name}-${L.w}x${L.h}-${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, userAgent: L.ua, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    await page.addInitScript(initScript, { theme: scheme });
    await page.goto(web.url);
    const row = page.locator(`[data-agent-alias="${ALIAS}"]`).first();
    await row.waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const openChat = async () => {
      if (await page.locator(tid('chat-header')).count()) return;
      await page.locator(`[data-agent-alias="${ALIAS}"]`).first().click();
      await page.locator(tid('chat-header')).waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
    };
    await openChat();
    await page.waitForTimeout(800);

    // 1. header
    const hm = await page.evaluate(measureHeader);
    const hb = hm.header;
    await page.screenshot({ path: `${OUT}/${tag}-1-header.png`, clip: { x: Math.max(0, hb.x), y: Math.max(0, hb.y), width: Math.min(hb.w, L.w), height: hb.h } });
    await page.screenshot({ path: `${OUT}/${tag}-1-chat.png` });
    check(tag, 'header has exactly one right-side action (⋯)', hm.rightActions.length === 1 && hm.rightActions[0] === '聊天信息', JSON.stringify(hm.rightActions));
    check(tag, '⋯ vertically centred with the name block (±1px)', Math.abs(hm.moreCy - hm.titleCy) <= 1 && Math.abs(hm.iconCy - hm.titleCy) <= 1, `button Δ=${r1(hm.moreCy - hm.titleCy)} icon Δ=${r1(hm.iconCy - hm.titleCy)}`);
    check(tag, 'right padding (to the ⋯ button) equals left padding (±1px)', Math.abs(hm.padLeft - hm.padRight) <= 1, `L=${r1(hm.padLeft)} R=${r1(hm.padRight)} first=${hm.firstChild}`);
    if (L.name === 'desktop') check(tag, 'floating window 📌 is not on the chat screen', hm.floatingWindowPin === 0, `${hm.floatingWindowPin}`);
    tables.header.push({ tag, moreDy: r1(hm.moreCy - hm.titleCy), iconDy: r1(hm.iconCy - hm.titleCy), padL: r1(hm.padLeft), padR: r1(hm.padRight), headerH: r1(hb.h), actions: hm.rightActions.length });

    const openPanel = async () => {
      await openChat();
      await page.locator(tid('chat-header-more')).click();
      await page.locator(tid('chat-info-panel')).waitFor({ timeout: 5000 });
      await page.waitForTimeout(L.presentation === 'page' ? 500 : 250);
    };
    const panelOpen = async () => (await page.locator(tid('chat-info-panel')).count()) > 0 && await page.locator(tid('chat-info-panel')).first().isVisible();

    // 2. panel
    await openPanel();
    await page.screenshot({ path: `${OUT}/${tag}-2-panel.png` });
    const pm = await page.evaluate(measurePanel);
    check(tag, `panel is a ${L.presentation}`, (await page.locator(tid(L.presentation === 'drawer' ? 'chat-info-drawer' : 'chat-info-back')).count()) === 1);
    if (L.presentation === 'drawer') {
      check(tag, 'drawer hugs the right edge of the chat pane', Math.abs(pm.panel.r - L.w) <= 1, `panel right=${r1(pm.panel.r)} w=${r1(pm.panel.w)}`);
      const bottoms = await page.evaluate(() => ['chat-header', 'chat-info-header'].map(id => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().bottom));
      check(tag, 'drawer title bar ends on the chat header line (±1px)', Math.abs(bottoms[0] - bottoms[1]) <= 1, bottoms.map(r1).join(' / '));
    }
    const ids = pm.rows.map(r => r.id);
    const expected = ['chat-info-row-node', 'chat-info-row-search', 'chat-info-row-pin', 'chat-info-row-mute', ...(L.name === 'desktop' ? ['chat-info-row-windowPin'] : []),
      'chat-info-row-section-model', 'chat-info-row-section-rules', 'chat-info-row-section-skills', 'chat-info-row-section-files', 'chat-info-row-section-tasks', 'chat-info-row-section-schedules',
      'chat-info-row-section-logs'];  // 运行日志 (#493)
    check(tag, 'rows in order', JSON.stringify(ids) === JSON.stringify(expected), ids.join(','));
    const heights = pm.rows.map(r => r.box.h);
    check(tag, 'every row ≥ 48px', heights.every(h => h >= 48), heights.map(r1).join(','));
    const labelLefts = pm.rows.filter(r => r.label).map(r => r1(r.label.x));
    check(tag, 'row label left edges equal', Math.max(...labelLefts) - Math.min(...labelLefts) <= 0.5, [...new Set(labelLefts)].join(','));
    const chevronRights = pm.rows.filter(r => r.chevron).map(r => r1(r.chevron.r));
    check(tag, 'chevron right edges equal', Math.max(...chevronRights) - Math.min(...chevronRights) <= 0.5, [...new Set(chevronRights)].join(','));
    const switchRights = pm.rows.filter(r => r.switch).map(r => r1(r.switch.r));
    check(tag, 'switch right edges equal each other and the chevrons', Math.max(...switchRights, ...chevronRights) - Math.min(...switchRights, ...chevronRights) <= 0.5, `switch ${[...new Set(switchRights)].join(',')} chevron ${[...new Set(chevronRights)].join(',')}`);
    tables.rows.push({ tag, rows: pm.rows.length, minH: r1(Math.min(...heights)), labelLeft: [...new Set(labelLefts)].join('/'), chevronRight: [...new Set(chevronRights)].join('/'), switchRight: [...new Set(switchRights)].join('/'), panelW: r1(pm.panel.w) });

    // 3. close paths
    if (L.presentation === 'drawer') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(tag, 'Esc closes the drawer', !(await panelOpen()));
      await openPanel();
      const pb = (await page.evaluate(measurePanel)).panel;
      await page.mouse.click(pb.x - 40, L.h / 2);
      await page.waitForTimeout(300);
      check(tag, 'click on the chat pane outside the drawer closes it', !(await panelOpen()) && (await page.locator(tid('chat-header')).count()) === 1);
      await openPanel();
      const head = await page.locator(tid('agents-list-head')).boundingBox();
      await page.mouse.click(head.x + head.width - 4, head.y + head.height - 2);
      await page.waitForTimeout(300);
      check(tag, 'click on the agent list (outside the chat pane) closes it too', !(await panelOpen()) && (await page.locator(tid('chat-header')).count()) === 1);
    } else {
      await page.goBack();
      await page.waitForTimeout(600);
      check(tag, 'history back closes the page and stays in the chat', !(await panelOpen()) && (await page.locator(tid('chat-header')).count()) === 1);
      await openPanel();
      await page.locator(tid('chat-info-back')).click();
      await page.waitForTimeout(600);
      check(tag, '‹ closes the page and stays in the chat', !(await panelOpen()) && (await page.locator(tid('chat-header')).count()) === 1);
      // ‹ popped its own history entry: one more back leaves the chat as before (no dead entry).
    }

    // 4. toggles (flip, verify, flip back)
    const toggles = ['pin', 'mute', ...(L.name === 'desktop' ? ['windowPin'] : [])];
    for (const key of toggles) {
      const id = `chat-info-row-${key}`;
      await openPanel();
      const before = await switchChecked(page, id);
      await page.locator(tid(`${id}-switch`)).click();
      await page.waitForTimeout(400);
      const after = await switchChecked(page, id);
      let listSide = '';
      // Desktop: the agent list is on screen next to the chat — its row shows the same state (📌 / 🔕).
      const rowText = L.name === 'desktop' ? await page.locator(`[data-agent-alias="${ALIAS}"]`).first().textContent() : '';
      const icon = { pin: '📌', mute: '🔕' }[key];
      const iconP = L.name === 'desktop' && icon ? await paintedGlyph(page, `[data-agent-alias="${ALIAS}"]`, icon) : null;
      if (L.name === 'desktop' && icon) listSide = `list ${key} icon=${rowText.includes(icon) && !!iconP?.painted && iconP.w >= 8 ? 1 : 0} (${fmtP(iconP)})`;
      if (key === 'pin' && scheme === 'light') await page.screenshot({ path: `${OUT}/${tag}-4-toggled-pin.png` });
      check(tag, `toggle ${key}: ${before} → ${after}`, before === false && after === true, listSide);
      if (L.name === 'desktop' && key !== 'windowPin') check(tag, `toggle ${key} is the same state the agent list shows`, /icon=1 /.test(listSide), listSide);
      await page.locator(tid(`${id}-switch`)).click();
      await page.waitForTimeout(400);
      check(tag, `toggle ${key} back off`, (await switchChecked(page, id)) === false);
      if (L.presentation === 'drawer') await page.keyboard.press('Escape'); else await page.locator(tid('chat-info-back')).click();
      await page.waitForTimeout(500);
    }

    // 5. 查找聊天内容
    await openPanel();
    await page.locator(tid('chat-info-row-search')).click();
    await page.waitForTimeout(500);
    check(tag, '查找聊天内容 closes the panel and opens the in-chat search', !(await panelOpen()) && (await page.locator('[aria-label="关闭搜索"]').count()) === 1);
    await page.locator('[aria-label="关闭搜索"]').click();
    await page.waitForTimeout(300);

    // 6. node rows → node info page on the matching section, ‹ back to the chat
    const sectionLabel = { node: '概览', 'section-model': '模型与运行时', 'section-rules': '规则文件', 'section-skills': '技能', 'section-files': '项目文件夹', 'section-tasks': '任务', 'section-schedules': '定时任务' };
    for (const [key, label] of Object.entries(sectionLabel)) {
      await openPanel();
      await page.locator(tid(`chat-info-row-${key}`)).click();
      await page.locator(tid('screen-header')).waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      // RN-web drops aria-selected on role=tab; the active tab is the one painted with rowActive.
      const active = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('[data-testid="node-section-nav"] [role="tab"]')];
        const on = tabs.filter(t => /background-color/.test(t.getAttribute('style') || ''));
        return on.length === 1 ? on[0].getAttribute('aria-label') : `ambiguous(${on.length})`;
      });
      const onInfo = (await page.getByText('节点信息', { exact: true }).count()) > 0;
      const titleP = await paintedText(page, ':not(:has(*))', '节点信息'); // the title is painted, not only in textContent
      if (key === 'section-rules' && scheme === 'light') await page.screenshot({ path: `${OUT}/${tag}-6-rules.png` });
      check(tag, `row ${key} → 节点信息 on 「${label}」`, onInfo && !!titleP?.painted && titleP.w >= 8 && active === label, `active=${active} title ${fmtP(titleP)}`);
      // Back to the chat: phone uses the page's ‹; desktop panes have no ‹ since #447 (pane-header.ts),
      // there the agent's row in the list is the way back.
      if (L.name === 'desktop') await page.locator(`[data-agent-alias="${ALIAS}"]`).first().click();
      else await page.locator(`${tid('screen-header')} [aria-label="返回"]`).click();
      await page.locator(tid('chat-header')).waitFor({ timeout: 8000 }).catch(() => {});
      check(tag, `back from 节点信息 (${key}) lands in the chat`, (await page.locator(tid('chat-header')).count()) === 1);
      await page.waitForTimeout(400);
    }

    // 7. Ctrl/⌘+F (desktop)
    if (L.name === 'desktop') {
      await page.locator(tid('chat-header-title')).click();
      await page.keyboard.press('Control+f');
      await page.waitForTimeout(400);
      check(tag, 'Ctrl+F opens the chat search directly', (await page.locator('[aria-label="关闭搜索"]').count()) === 1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await openPanel();
      await page.keyboard.press('Control+f');
      await page.waitForTimeout(400);
      check(tag, 'Ctrl+F with the drawer open: drawer closes, search opens', !(await panelOpen()) && (await page.locator('[aria-label="关闭搜索"]').count()) === 1);
    }
    check(tag, 'no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}
await browser.close();
web.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, tables }, null, 2));
console.log('\nHEADER', JSON.stringify(tables.header, null, 1));
console.log('ROWS', JSON.stringify(tables.rows, null, 1));
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
