// 任务短号 #N:列表「ID」列(字段配置可隐藏、可排序)、看板卡片上的弱化 #N、详情头的 ID(点复制 #N / 复制完整 ID)、
// 旧 Hub 上什么都不加(只有详情头显示 uuid 前 8 位)—— 对着一个真 Hub 点真按钮、量真框、读真剪贴板。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub built from a branch with requirement_seq
// (never 127.0.0.1:9200) holding tasks #1…#N with at least one deleted in the middle (the gap proves numbers are
// not re-used). Read-only: the flows never write to the hub.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:<port> HUB_TOKEN=<utok_…> HUB_NETWORK=<net_…> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-task-short-id/drive.mjs
//
// desktop 1320×754 and 1000×700 (Tauri stub ⇒ mouse), light + dark:
//   list     「ID」 header + every row's #N (= the hub's seq); the #N text shares the title's centre line ±1px and the
//            header label's left edge ±1px; 点表头 → rows ascending by seq, again → descending
//   fields   字段配置 has an 「ID」 row; hide → the column is gone, show → back
//   board    every card has #N, on the priority badge's centre line ±1px, its right edge at the card's inner right
//            (= left padding ±1px); a due chip sits right before it (gap ≤ 12px), not pushed to the middle
//   detail   ID chip on the header title's centre line ±1px, 28px tall; click → clipboard "#N" + 「已复制」;
//            「复制完整 ID」 button (same centre line) → clipboard = req_… id
//   old hub  (responses stripped of seq + requirement_seq) no ID column, no 字段配置 row, no card #N; the detail shows
//            the 8-char uuid prefix and a click copies the full id
// phone 390×844 (Android UA ⇒ touch):
//   board    card #N as above; detail chip on the header centre line, no 「复制完整 ID」 button;
//            tap → "#N"; long-press → the full id
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

const hubRows = (await (await fetch(`${HUB_URL}/api/requirements?network_id=${HUB_NETWORK}`, { headers: { authorization: `Bearer ${HUB_TOKEN}` } })).json()).requirements;
if (!hubRows.length || !hubRows.every(r => Number.isInteger(r.seq))) throw new Error('hub has no seq — start it from a branch with requirement_seq');
const seqs = hubRows.map(r => r.seq).sort((a, b) => a - b);
if (seqs.every((s, i) => s === i + 1)) throw new Error('seed needs a gap (delete one task in the middle)');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (same as tests/test-task-board/measure.mjs): plugin:http is forwarded to the real hub.
const initScript = ({ hubUrl, token, networkId, theme }) => {
  const profile = { serverUrl: hubUrl, token, username: 'tester', profileId: 'p-task-board', displayName: 'tester', networkId };
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
          return { status: r.status, statusText: r.statusText, url: r.url || c.url, headers: Array.from(r.headers.entries()), rid: id };
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
  try { localStorage.setItem('theme_mode_v1', theme); } catch {}
  // 这些流程要点「更多」里的字段(优先级 / 检查项 / 母任务 …):按「上次展开过」起步。渐进展开本身在 test-task-organize 量。
  try { if (localStorage.getItem('task_detail_more_open_v1') === null) localStorage.setItem('task_detail_more_open_v1', '1'); } catch {}
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' }));
}
const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2, text: el.textContent };
}, sel);
// 文字本身的框(不是格子):量对齐要量字,不量容器。
const textRect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const range = document.createRange(); range.selectNodeContents(el);
  const b = range.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, cy: b.y + b.height / 2, text: el.textContent };
}, sel);
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());

// 旧 Hub:把 seq 和 requirement_seq 从响应里拿掉(其余原样)。
async function asOldHub(page) {
  await page.route(/\/api\/requirements(\/|\?|$)/, async route => {
    const res = await route.fetch();
    if (res.status() !== 200) return route.fulfill({ response: res });
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    const strip = (r) => { if (r && typeof r === 'object') delete r.seq; return r; };
    if (Array.isArray(body.requirements)) body.requirements.forEach(strip);
    if (body.requirement) strip(body.requirement);
    if (Array.isArray(body.capabilities)) body.capabilities = body.capabilities.filter(c => c !== 'requirement_seq');
    const headers = { ...res.headers() }; delete headers.etag; delete headers['content-length']; delete headers['content-encoding'];
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}

async function open(page, kind, theme, view) {
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme });
  if (kind === 'desktop') {
    await page.goto(WEB_URL);
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"], [data-testid="desktop-rail"] [aria-label="Tasks"]').first().click({ timeout: 30000 });
  } else {
    await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  }
  await page.locator(tid(view === 'board' ? 'tasks-view-board' : 'tasks-view-list')).first().click({ timeout: 20000 });
  await page.locator(view === 'board' ? '[data-testid^="req-card-"]' : '[data-testid^="req-row-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
}
const bySeq = new Map(hubRows.map(r => [r.id, r.seq]));

async function context(v, theme) {
  const touch = v.kind !== 'desktop';
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_URL });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  return { ctx, page };
}

async function detailChecks(page, vp, kind, name, old = false) {
  const head = await rect(page, `${tid('req-detail')} ${tid('req-detail-id')}`);
  const chip = await rect(page, tid('req-detail-id-copy'));
  const idText = await textRect(page, tid('req-detail-id-text'));
  // 头部标题「任务详情」:和 ID 同一行
  const title = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="req-detail"] div')].find(e => e.textContent === '任务详情' && e.children.length === 0);
    if (!el) return null; const b = el.getBoundingClientRect(); return { cy: b.y + b.height / 2, r: b.right };
  });
  const full = await rect(page, tid('req-detail-id-copy-full'));
  const card = hubRows.find(r => r.id === name);
  const expectText = old ? card.id.replace(/^req_/, '').replace(/-/g, '').slice(0, 8) : `#${card.seq}`;
  record(vp, `${old ? 'old hub ' : ''}detail header ID`, {
    present: !!head && !!chip, text: idText?.text === expectText,
    sameLine: !!title && Math.abs(chip.cy - title.cy) <= 1, height28: !!chip && Math.abs(chip.h - 28) <= 0.5,
    afterTitle: !!title && chip.x >= title.r,
    fullButton: kind === 'desktop' && !old ? !!full && Math.abs(full.cy - chip.cy) <= 1 && Math.abs(full.h - 28) <= 0.5 : !full,
  }, { text: idText?.text, chipCy: chip && r1(chip.cy), titleCy: title && r1(title.cy), chipH: chip && r1(chip.h) });
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.locator(tid('req-detail-id-copy')).click();
  await page.waitForTimeout(150);
  const tapped = await clip(page);
  const feedback = (await rect(page, tid('req-detail-id-text')))?.text;
  record(vp, `${old ? 'old hub ' : ''}detail tap copies`, { clipboard: tapped === (old ? card.id : `#${card.seq}`), feedback: feedback === '已复制' || (old && feedback === '已复制完整 ID') }, { clipboard: tapped, feedback });
  if (old) return;
  await page.evaluate(() => navigator.clipboard.writeText(''));
  if (kind === 'desktop') {
    await page.locator(tid('req-detail-id-copy-full')).click();
  } else {
    const b = await rect(page, tid('req-detail-id-copy'));
    await page.mouse.move(b.x + b.w / 2, b.cy); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
  }
  await page.waitForTimeout(150);
  const fullClip = await clip(page);
  record(vp, kind === 'desktop' ? 'detail 复制完整 ID button' : 'detail long-press copies full id', { clipboard: fullClip === card.id, feedback: (await rect(page, tid('req-detail-id-text')))?.text === '已复制完整 ID' }, { clipboard: fullClip });
}

async function boardChecks(page, vp, old = false) {
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-card-"]')].filter(c => /^req-card-req_/.test(c.dataset.testid)).map(card => {
    const id = card.dataset.testid.slice('req-card-'.length);
    const seq = card.querySelector(`[data-testid="req-card-seq-${id}"]`);
    const prio = card.querySelector('[data-testid="task-prio-badge"]');
    const cb = card.getBoundingClientRect();
    const kids = [...card.children].map(k => k.getBoundingClientRect());
    const left = Math.min(...kids.map(k => k.left)) - cb.left;
    const due = card.querySelector('[data-testid="task-due"]');
    const sb = seq?.getBoundingClientRect(), pb = prio?.getBoundingClientRect(), db = due?.getBoundingClientRect();
    // 期限和 #N 都在右侧:期限紧挨着 #N(间距 = 行内 gap),不是被挤到卡片中间
    const dueGap = sb && db ? sb.left - db.right : null;
    return { id, text: seq?.textContent ?? null, right: sb ? cb.right - sb.right : null, left, dy: sb && pb ? (sb.y + sb.height / 2) - (pb.y + pb.height / 2) : null, dueGap };
  }));
  if (old) { record(vp, 'old hub board: no #N on any card', { cards: cards.length > 0, none: cards.every(c => c.text === null) }, { cards: cards.length }); return; }
  record(vp, 'board: every card shows its #N', {
    cards: cards.length > 0,
    text: cards.every(c => c.text === `#${bySeq.get(c.id)}`),
    centreLine: cards.every(c => c.dy !== null && Math.abs(c.dy) <= 1),
    rightPad: cards.every(c => c.right !== null && Math.abs(c.right - c.left) <= 1),
    dueHugsId: cards.some(c => c.dueGap !== null) && cards.every(c => c.dueGap === null || (c.dueGap >= 0 && c.dueGap <= 12)),
  }, { cards: cards.length, dueGaps: [...new Set(cards.filter(c => c.dueGap !== null).map(c => r1(c.dueGap)))].join('/'), maxDy: r1(Math.max(...cards.map(c => Math.abs(c.dy ?? 99)))), pads: [...new Set(cards.map(c => `${r1(c.left)}/${r1(c.right)}`))].join(' ') });
}

async function listChecks(page, vp, old = false) {
  const head = await rect(page, tid('task-column-seq'));
  if (old) {
    await page.locator(tid('task-fields-button')).click();
    await page.locator(tid('task-fields-popover')).waitFor();
    const row = await rect(page, tid('task-field-seq'));
    await page.keyboard.press('Escape'); await page.locator(tid('task-fields-backdrop')).click({ force: true }).catch(() => {});
    record(vp, 'old hub list: no ID column, no 字段配置 row', { noColumn: !head, noRow: !row, noCells: !(await rect(page, '[data-testid^="task-seq-"]')) });
    return;
  }
  const order = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="task-seq-"]')].map(e => e.textContent));
  const first = hubRows[0];
  const cell = await textRect(page, tid(`task-seq-${first.id}`));
  const label = await textRect(page, `${tid('task-column-seq')} [data-testid="req-sort-seq"] div`);
  // 行里其他单行文字格(负责人)的中线 = 这一行的基准;标题格是「标题 + ↳母任务 + 标签」的一列,本身比它高 2px(存量,与本改动无关,单独报告)。
  const ownerText = await page.evaluate((s) => {
    const cell = document.querySelector(s); if (!cell) return null;
    const leaf = [...cell.querySelectorAll('div')].find(e => e.children.length === 0 && e.textContent.trim());
    if (!leaf) return null; const r = document.createRange(); r.selectNodeContents(leaf); const b = r.getBoundingClientRect(); return { cy: b.y + b.height / 2 };
  }, tid(`task-cell-${first.id}-owner`));
  const titleCell = await textRect(page, `${tid(`task-cell-${first.id}-title`)} div div`);
  record(vp, 'list: ID column', {
    header: !!head && (await rect(page, tid('req-sort-seq')))?.text.startsWith('ID'),
    cells: (await order()).length === hubRows.length, text: cell?.text === `#${first.seq}`,
    leftEdge: !!label && !!cell && Math.abs(label.x - cell.x) <= 1,
    centreLine: !!ownerText && !!cell && Math.abs(ownerText.cy - cell.cy) <= 1,
  }, { cellX: cell && r1(cell.x), labelX: label && r1(label.x), cellCy: cell && r1(cell.cy), ownerCy: ownerText && r1(ownerText.cy), titleCy: titleCell && r1(titleCell.cy) });
  await page.locator(tid('req-sort-seq')).click(); await page.waitForTimeout(200);
  const asc = await order();
  await page.locator(tid('req-sort-seq')).click(); await page.waitForTimeout(200);
  const desc = await order();
  const n = (s) => Number(s.slice(1));
  record(vp, 'list: sort by ID', { asc: asc.join() === seqs.map(s => `#${s}`).join(), desc: desc.join() === [...seqs].reverse().map(s => `#${s}`).join(), numeric: asc.every((s, i) => i === 0 || n(asc[i - 1]) < n(s)) }, { asc: asc.join(' '), desc: desc.join(' ') });
  return async (name) => {
    await page.locator(tid('task-fields-button')).click();
    await page.locator(tid('task-field-seq')).waitFor();
    // 行里的图标是私用区字形(拖动柄 / 眼睛),去掉后只剩列名。
    const rowText = (await rect(page, tid('task-field-seq')))?.text.replace(/[\uE000-\uF8FF]/g, '');
    await page.screenshot({ path: join(OUT, `${name}-fields.png`) });
    await page.locator(tid('task-field-toggle-seq')).click(); await page.waitForTimeout(150);
    const hidden = !(await rect(page, tid('task-column-seq')));
    await page.locator(tid('task-field-toggle-seq')).click(); await page.waitForTimeout(150);
    const back = !!(await rect(page, tid('task-column-seq')));
    record(vp, '字段配置: ID row hides / shows the column', { row: rowText === 'ID', hidden, back }, { rowText });
    await page.locator(tid('task-fields-backdrop')).click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
  };
}

const VIEWPORTS = [
  { w: 1320, h: 754, kind: 'desktop' },
  { w: 1000, h: 700, kind: 'desktop' },
  { w: 390, h: 844, kind: 'phone' },
];
const target = [...hubRows].sort((a, b) => b.seq - a.seq)[0];
for (const theme of ['light', 'dark']) {
  for (const v of VIEWPORTS) {
    const vp = `${v.kind} ${v.w}x${v.h} ${theme}`;
    const name = `${v.kind}-${v.w}x${v.h}-${theme}`;
    // 新 Hub
    {
      const { ctx, page } = await context(v, theme);
      if (v.kind === 'desktop') {
        await open(page, v.kind, theme, 'list');
        const fields = await listChecks(page, vp);
        await page.screenshot({ path: join(OUT, `${name}-list.png`) });
        if (theme === 'light') await fields(name);
      }
      await open(page, v.kind, theme, 'board');
      await boardChecks(page, vp);
      await page.screenshot({ path: join(OUT, `${name}-board.png`) });
      await page.locator(tid(`req-card-${target.id}`)).first().click();
      await page.locator(tid('req-detail-id-copy')).waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${name}-detail.png`) });
      await detailChecks(page, vp, v.kind, target.id);
      await ctx.close();
    }
    if (theme === 'dark') continue;
    // 旧 Hub
    {
      const { ctx, page } = await context(v, theme);
      await asOldHub(page);
      if (v.kind === 'desktop') { await open(page, v.kind, theme, 'list'); await listChecks(page, vp, true); await page.screenshot({ path: join(OUT, `${name}-oldhub-list.png`) }); }
      await open(page, v.kind, theme, 'board');
      await boardChecks(page, vp, true);
      await page.screenshot({ path: join(OUT, `${name}-oldhub-board.png`) });
      await page.locator(tid(`req-card-${target.id}`)).first().click();
      await page.locator(tid('req-detail-id-copy')).waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${name}-oldhub-detail.png`) });
      await detailChecks(page, vp, v.kind, target.id, true);
      await ctx.close();
    }
  }
}
await browser.close(); web.close();
console.log(failures ? `FAILURES: ${failures}` : 'ALL PASS');
process.exit(failures ? 1 : 0);
