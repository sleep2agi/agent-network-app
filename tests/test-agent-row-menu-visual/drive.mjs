// 会话行菜单(长按 / 右键)—— 真应用(expo web 导出 + Tauri 桥桩)截图 + boundingBox 量对齐。不进 CI:
// 要 Playwright + Chromium + 一个一次性 hub(非 9200 端口、自己的 HOME)。
//
//   HUB_URL=http://127.0.0.1:<非 9200> HUB_TOKEN=utok_… WEB_DIR=<expo export 目录> OUT=<截图目录> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-agent-row-menu-visual/drive.mjs
//
// 布局:390×844 安卓 UA = 手机单栏;1200×850 安卓 UA = 双栏;1440×900 无安卓 UA = 桌面壳(右键)。
// 四角:在一行上派发 contextmenu,clientX/Y 取视口四角 —— 这是真实右键路径,菜单的定位 / 夹紧与长按是同一个函数。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const HUB_URL = process.env.HUB_URL, TOKEN = process.env.HUB_TOKEN, WEB = process.env.WEB_DIR, OUT = process.env.OUT;
if (!HUB_URL || !TOKEN || !WEB || !OUT) throw new Error('need HUB_URL HUB_TOKEN WEB_DIR OUT');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing the production hub port 9200');
mkdirSync(OUT, { recursive: true });
const ROW = process.env.ROW_ALIAS || '示例助手';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

const initScript = ({ hubUrl, token, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-visual', displayName: 'tester' };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url, headers: Array.from(r.headers.entries()), rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        default: return null;
      }
    },
  };
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1217', 'chromium-1234', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });

const TWO_PANE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const LAYOUTS = [
  { name: 'phone', w: 390, h: 844, ua: PHONE_UA },
  { name: 'twopane', w: 1200, h: 850, ua: TWO_PANE_UA },
  { name: 'desktop', w: 1440, h: 900, ua: undefined },
];

/** 菜单与每一项(及项内文字)的几何。 */
async function measureMenu(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('[data-testid="agent-row-menu"]');
    if (!menu) return null;
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map(it => {
      const text = it.querySelector('[dir]') || it.firstElementChild;
      return { label: it.getAttribute('aria-label'), key: it.getAttribute('data-testid'), box: r(it), text: r(text) };
    });
    return { menu: r(menu), vertical: menu.getAttribute('data-menu-vertical'), horizontal: menu.getAttribute('data-menu-horizontal'), items, vw: innerWidth, vh: innerHeight };
  });
}
const round = (n) => Math.round(n * 10) / 10;
function alignment(m) {
  const lefts = m.items.map(i => round(i.text.x));
  const heights = m.items.map(i => round(i.box.h));
  const centreOff = m.items.map(i => round((i.text.y + i.text.h / 2) - (i.box.y + i.box.h / 2)));
  const inside = m.menu.x >= 0 && m.menu.y >= 0 && m.menu.x + m.menu.w <= m.vw && m.menu.y + m.menu.h <= m.vh;
  return {
    labels: m.items.map(i => i.label),
    textLeft: [...new Set(lefts)],
    leftAligned: Math.max(...lefts) - Math.min(...lefts) <= 0.5,
    itemHeights: [...new Set(heights)],
    equalHeights: Math.max(...heights) - Math.min(...heights) <= 0.5,
    maxCentreOffset: Math.max(...centreOff.map(Math.abs)),
    centred: centreOff.every(o => Math.abs(o) <= 1),
    menu: { x: round(m.menu.x), y: round(m.menu.y), w: round(m.menu.w), h: round(m.menu.h) },
    inside,
    placement: `${m.vertical}/${m.horizontal}`,
  };
}
async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  if (await page.locator('[data-testid="agent-row-menu"]').count()) {
    await page.mouse.click(2, 2);
    await page.waitForTimeout(450);
  }
}
async function rightClickAt(page, x, y) {
  await page.evaluate(({ alias, x, y }) => {
    const row = document.querySelector(`[data-agent-alias="${alias}"]`);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  }, { alias: ROW, x, y });
  await page.locator('[data-testid="agent-row-menu"]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(450);
}

const report = [];
for (const L of LAYOUTS) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: L.w, height: L.h }, colorScheme: scheme, userAgent: L.ua, hasTouch: false });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await page.addInitScript(initScript, { hubUrl: HUB_URL, token: TOKEN, theme: scheme });
    await page.goto(WEB_URL);
    const row = page.locator(`[data-agent-alias="${ROW}"]`).first();
    await row.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const tag = `rowmenu-${L.name}-${L.w}x${L.h}-${scheme}`;
    const rec = { tag };
    if (L.name === 'twopane') {
      rec.emptyHint = await page.getByText('长按列表里的 agent 可以置顶、免打扰、查看节点详情').count();
      await page.screenshot({ path: `${OUT}/${tag}-0-empty-pane.png` });
    }
    // 1. 打开菜单:触屏布局 = 真长按(鼠标按住 700ms);桌面 = 真右键。
    const b = await row.boundingBox();
    const px = Math.round(b.x + b.width * 0.35), py = Math.round(b.y + b.height / 2);
    if (L.name === 'desktop') {
      await page.mouse.click(px, py, { button: 'right' });
    } else {
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
    }
    await page.locator('[data-testid="agent-row-menu"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(450);
    rec.stillOnList = (await page.locator('[data-testid="agent-row-menu"]').count()) === 1; // long-press did not navigate to node detail
    const m0 = await measureMenu(page);
    rec.open = { press: { x: px, y: py }, ...alignment(m0), cornerAtPress: { dx: round(m0.menu.x - px), dy: round(m0.menu.y - py) } };
    await page.screenshot({ path: `${OUT}/${tag}-1-menu.png` });
    await closeMenu(page);
    rec.closedByEsc = (await page.locator('[data-testid="agent-row-menu"]').count()) === 0;
    // 2. 四角
    rec.corners = {};
    for (const [name, x, y] of [['TL', 1, 1], ['TR', L.w - 1, 1], ['BL', 1, L.h - 1], ['BR', L.w - 1, L.h - 1]]) {
      await rightClickAt(page, x, y);
      const a = alignment(await measureMenu(page));
      rec.corners[name] = { inside: a.inside, menu: a.menu, placement: a.placement };
      if (name === 'BR') await page.screenshot({ path: `${OUT}/${tag}-2-corner-BR.png` });
      await closeMenu(page);
    }
    // 3. 点遮罩关闭
    await rightClickAt(page, px, py);
    const mb = (await measureMenu(page)).menu;
    const outside = mb.x > 60 ? { x: 20, y: Math.min(L.h - 20, mb.y + mb.h + 40) } : { x: L.w - 20, y: L.h - 20 };
    await page.mouse.click(outside.x, outside.y);
    await page.waitForTimeout(450);
    rec.closedByOutsideTap = (await page.locator('[data-testid="agent-row-menu"]').count()) === 0;
    report.push(rec);
    console.log(JSON.stringify(rec));
    // 4. 动作(只在浅色跑一遍,省得重复改 hub 状态):标为未读 → 红点;置顶;不显示 → 底部入口;恢复。
    if (scheme === 'light') {
      const act = {};
      const choose = async (key) => { await rightClickAt(page, px, py); await page.locator(`[data-testid="agent-row-menu-${key}"]`).click(); await page.waitForTimeout(600); };
      // 构建机器人 / 示例助手 有真实未读;挑一个没有未读的行演示「标为未读」。
      const plainAlias = '测试节点';
      await page.evaluate(({ alias }) => {
        const r = document.querySelector(`[data-agent-alias="${alias}"]`);
        r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 300, button: 2 }));
      }, { alias: plainAlias });
      await page.locator('[data-testid="agent-row-menu"]').waitFor({ timeout: 5000 });
      act.plainFirstItem = await page.locator('[data-testid="agent-row-menu-read"]').getAttribute('aria-label');
      await page.locator('[data-testid="agent-row-menu-read"]').click();
      await page.waitForTimeout(600);
      act.manualDotShown = await page.locator(`[data-testid="unread-badge-${plainAlias}"][aria-label="标为未读"]`).count();
      await choose('pin');
      act.pinnedLabelAfter = await (async () => { await rightClickAt(page, px, py); const l = await page.locator('[data-testid="agent-row-menu-pin"]').getAttribute('aria-label'); await closeMenu(page); return l; })();
      await page.screenshot({ path: `${OUT}/${tag}-3-pinned-and-marked-unread.png` });
      await choose('pin'); // unpin again
      await choose('hide');
      act.rowGoneAfterHide = (await page.locator(`[data-agent-alias="${ROW}"]`).count()) === 0;
      act.footer = await page.locator('[data-testid="agent-hidden-toggle"]').getAttribute('aria-label');
      await page.locator('[data-testid="agent-hidden-toggle"]').click();
      await page.waitForTimeout(400);
      act.rowInFooterAfterExpand = (await page.locator(`[data-testid="agent-hidden-footer"] [data-agent-alias="${ROW}"]`).count()) === 1;
      await page.locator(`[data-testid="agent-hidden-footer"] [data-agent-alias="${ROW}"]`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${tag}-4-hidden-footer.png` });
      act.persistedHidden = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('agent_conversation_flags_v1')).map(k => JSON.parse(localStorage.getItem(k))));
      await page.reload();
      await page.locator(`[data-agent-alias="${plainAlias}"]`).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1200);
      act.stillHiddenAfterReload = (await page.locator(`[data-agent-alias="${ROW}"]`).count()) === 0 && (await page.locator('[data-testid="agent-hidden-toggle"]').count()) === 1;
      await page.locator('[data-testid="agent-hidden-toggle"]').click();
      await page.waitForTimeout(300);
      await page.evaluate(({ alias }) => {
        const r = document.querySelector(`[data-agent-alias="${alias}"]`);
        r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 300, button: 2 }));
      }, { alias: ROW });
      await page.locator('[data-testid="agent-row-menu"]').waitFor({ timeout: 5000 });
      act.hiddenRowLastItem = await page.locator('[data-testid="agent-row-menu-hide"]').getAttribute('aria-label');
      await page.locator('[data-testid="agent-row-menu-hide"]').click();
      await page.waitForTimeout(600);
      act.restored = (await page.locator('[data-testid="agent-hidden-toggle"]').count()) === 0 && (await page.locator(`[data-agent-alias="${ROW}"]`).count()) === 1;
      // 标为未读的红点:打开会话即清
      await page.locator(`[data-agent-alias="${plainAlias}"]`).first().click();
      await page.waitForTimeout(1500);
      act.flagsAfterOpen = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('agent_conversation_flags_v1')).map(k => JSON.parse(localStorage.getItem(k)).manualUnread));
      rec.actions = act;
      console.log(JSON.stringify({ tag, actions: act }));
    }
    await ctx.close();
  }
}
writeFileSync(`${OUT}/rowmenu-report.json`, JSON.stringify(report, null, 2));
await browser.close(); web.close();
