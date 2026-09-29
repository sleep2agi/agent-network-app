// 任务页(需求池看板)—— 对着一个真 Hub 量出来,不靠眼睛。
// Not in CI: needs Playwright + Chromium, a web export, and a THROWAWAY hub you started yourself
// (never 127.0.0.1:9200) holding the seed from seed.mjs in this directory (placeholder nodes demo-node-a/b/c).
//
//   WEB_DIR=<expo export dir> OUT=<png dir> HUB_URL=http://127.0.0.1:<port> HUB_TOKEN=<utok_…> HUB_NETWORK=<net_…> \
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> [MODE=after|before] node tests/test-task-board/measure.mjs
//
// MODE=before only takes screenshots (the old board has none of the testIDs below).
// MODE=after (default) screenshots + asserts, per viewport and theme:
//   desktop 1320×754 / 1200×800 / 1000×700 (Tauri stub ⇒ desktop workspace, mouse):
//     columns    : three columns, equal width within 1px, together (+ gaps + padding) fill the content width within 2px
//     header     : 任务 title, 列表/看板, the two filter chips and ＋ 新建 share one centre line within 1px
//     cards      : every card's padding is equal on all four sides (±0.5px)
//     sidebar    : the left pane is the filter sidebar (no agent list); its title centre = page header centre ±1px
//   flows (1320×754 light only; each writes to the hub and reads it back):
//     create     : ＋ 新建 → dialog (title autofocused) → owner demo-node-c → 创建 → hub has it with owner {node,node_demo_c}
//     drag       : drag a 需求池 card onto 进行中 → drop indicator shown while over → hub column = doing, counts update
//     drawer     : click a card → drawer top = header bottom ±1px, right = content right ±1px; edit title + priority →
//                  保存修改 → hub reads back both
//     filter     : sidebar demo-node-a → only demo-node-a's cards; header owner chip reads demo-node-a
//     keyboard   : focus a card, Shift+→ → hub column moves one step
//     menu       : right-click a card → 移到 完成 → hub column = done
//   phone 390×844 (Android UA ⇒ touch): no drag (a pointer drag changes nothing on the hub); long-press menu → 移到 进行中
//     → hub reads back; card opens a pushed detail page; create opens a bottom sheet
//   foldable 1000×700 (Android UA ⇒ rail + full-width tasks, touch): three equal columns fill the width; no drag
// Exit 1 when any assertion fails. The flows mutate the hub: restore the seed DB before a rerun.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT, HUB_URL, HUB_TOKEN, HUB_NETWORK } = process.env;
const MODE = process.env.MODE || 'after';
// ROLES=two: the hub has agent_owner (负责人 = human, 负责 Agent = node). ROLES=single: an older hub —
// the app must fall back to one 负责人 (human or agent). HUB_ME = the tester's user_id (for 我负责的).
const ROLES = process.env.ROLES || 'two';
const HUB_ME = process.env.HUB_ME || '';
if (ROLES === 'two' && !HUB_ME) throw new Error('ROLES=two needs HUB_ME=<tester user_id>');
if (!WEB || !OUT || !HUB_URL || !HUB_TOKEN || !HUB_NETWORK) throw new Error('need WEB_DIR OUT HUB_URL HUB_TOKEN HUB_NETWORK');
if (/:9200\b/.test(HUB_URL)) throw new Error('refusing :9200 — that is the production hub port; start a throwaway hub');
mkdirSync(OUT, { recursive: true });

const hubList = async () => (await (await fetch(`${HUB_URL}/api/requirements?network_id=${HUB_NETWORK}`, { headers: { authorization: `Bearer ${HUB_TOKEN}` } })).json()).requirements;
const hubRow = async (name) => (await hubList()).find(r => r.name === name);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (the plain web branch hits SecureStore); plugin:http is forwarded to the real hub.
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

const rows = [];
let failures = 0;
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const row = { vp, what, ...detail, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-' };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2, text: el.textContent };
}, sel);

async function open(page, kind, theme) {
  await page.addInitScript(initScript, { hubUrl: HUB_URL, token: HUB_TOKEN, networkId: HUB_NETWORK, theme });
  if (kind === 'desktop') {
    await page.goto(WEB_URL);
    await page.locator('[data-testid="desktop-rail"] [aria-label="Tasks"]').first().click({ timeout: 30000 });
  } else {
    await page.goto(`${WEB_URL}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  }
  if (MODE === 'after') {
    await page.locator(tid('tasks-view-board')).first().click({ timeout: 20000 });
    await page.locator('[data-testid^="req-card-"]').first().waitFor({ timeout: 20000 });
  } else {
    await page.getByText('看板', { exact: true }).first().click({ timeout: 20000 });
  }
  await page.waitForTimeout(1200);
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) });

const VIEWPORTS = [
  { w: 1320, h: 754, kind: 'desktop' },
  { w: 1200, h: 800, kind: 'desktop' },
  { w: 1000, h: 700, kind: 'desktop' },
  { w: 1000, h: 700, kind: 'foldable' },
  { w: 390, h: 844, kind: 'phone' },
];

for (const theme of ['light', 'dark']) {
  for (const v of VIEWPORTS) {
    const vp = `${v.kind} ${v.w}x${v.h} ${theme}`;
    const touch = v.kind !== 'desktop';
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, deviceScaleFactor: 2, ...(touch ? { userAgent: ANDROID_UA, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
    await open(page, v.kind, theme);
    await shot(page, `${v.kind}-${v.w}x${v.h}-${theme}`);
    if (MODE === 'before') { await ctx.close(); continue; }

    const geo = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2 }; };
      const board = q('[data-testid="req-board"]');
      const cols = ['pool', 'doing', 'done'].map(c => rect(q(`[data-testid="req-col-${c}"]`)));
      const root = rect(q('[data-testid="requirement-board"]'));
      const bs = board ? getComputedStyle(board) : null;
      const header = q('[data-testid="task-header"]');
      const headerKids = header ? ['tasks-view', 'task-filter-owner', 'task-filter-priority', 'req-new'].map(id => ({ id, ...rect(header.parentElement.querySelector(`[data-testid="${id}"]`)) })) : [];
      const title = header ? [...header.querySelectorAll('[role="heading"], div')].find(e => e.textContent === '任务' && e.children.length === 0) : null;
      const cards = [...document.querySelectorAll('[data-testid^="req-card-"]')].slice(0, 6).map(card => {
        const cb = card.getBoundingClientRect();
        const kids = [...card.children].map(k => k.getBoundingClientRect());
        const inner = { l: Math.min(...kids.map(k => k.left)), t: Math.min(...kids.map(k => k.top)), r: Math.max(...kids.map(k => k.right)), b: Math.max(...kids.map(k => k.bottom)) };
        return { id: card.dataset.testid, left: inner.l - cb.left, top: inner.t - cb.top, right: cb.right - inner.r, bottom: cb.bottom - inner.b };
      });
      const prioH = Math.max(0, ...[...document.querySelectorAll('[data-testid="task-prio-label"]')].map(e => e.getBoundingClientRect().height));
      const dueH = Math.max(0, ...[...document.querySelectorAll('[data-testid="task-due"]')].map(e => e.getBoundingClientRect().height));
      const side = rect(q('[data-testid="task-sidebar"]'));
      const sideTitle = q('[data-testid="task-sidebar-title"]');
      return {
        root, cols, pad: bs ? { l: parseFloat(bs.paddingLeft), r: parseFloat(bs.paddingRight), gap: parseFloat(bs.columnGap || bs.gap) } : null,
        prioH, dueH, header: rect(header), title: rect(title), headerKids, cards, side, sideTitle: rect(sideTitle),
        agentList: !!q('[data-testid="agent-list"], [data-testid="agents-screen"]'),
      };
    });

    if (v.kind === 'phone') {
      // 手机:一列一屏横向翻,列宽 = 窗口 - 两侧 16 - 露出下一列 28;第一列从 16 开始。
      const ws = geo.cols.map(c => c?.w ?? 0);
      record(vp, 'phone kanban: one column per screen', {
        three: geo.cols.every(Boolean), equalWidth: Math.max(...ws) - Math.min(...ws) <= 1,
        columnWidth: Math.abs(ws[0] - (v.w - 32 - 28)) <= 1, firstAtGutter: Math.abs(geo.cols[0].x - 16) <= 1,
        nextPeeks: geo.cols[1].x < v.w && geo.cols[1].x > v.w - 40,
      }, { widths: ws.map(r1).join('/'), x0: r1(geo.cols[0].x), x1: r1(geo.cols[1].x) });
    }
    if (v.kind !== 'phone') {
      const ws = geo.cols.map(c => c?.w ?? 0);
      const fill = geo.cols[2].r - geo.cols[0].x;
      const content = geo.root.w - geo.pad.l - geo.pad.r;
      record(vp, 'kanban columns', {
        three: geo.cols.every(Boolean),
        equalWidth: Math.max(...ws) - Math.min(...ws) <= 1,
        fillsContent: Math.abs(fill - content) <= 2,
      }, { widths: ws.map(r1).join('/'), span: r1(fill), content: r1(content), gap: geo.pad.gap });
    }
    const centres = [geo.title, ...geo.headerKids].filter(k => k && k.h).map(k => k.cy);
    if (v.kind !== 'phone') {
      record(vp, 'header one centre line', { found: centres.length === 5, centred: Math.max(...centres) - Math.min(...centres) <= 1 }, { centres: centres.map(r1).join('/') });
    }
    const pads = geo.cards.map(c => [c.left, c.top, c.right, c.bottom]);
    record(vp, 'card meta stays on one line', { prioOneLine: geo.prioH > 0 && geo.prioH <= 20, dueOneLine: geo.dueH <= 20.5 }, { prioH: r1(geo.prioH), dueH: r1(geo.dueH) });
    record(vp, 'card paddings equal', {
      cards: pads.length > 0,
      equal: pads.every(p => Math.max(...p) - Math.min(...p) <= 0.5),
    }, { pad: pads.length ? pads[0].map(r1).join('/') : '-', cards: pads.length });
    if (v.kind === 'desktop') {
      record(vp, 'left pane is the filter sidebar', {
        sidebar: !!geo.side, noAgentList: !geo.agentList,
        titleOnHeaderLine: !!geo.sideTitle && !!geo.title && Math.abs(geo.sideTitle.cy - geo.title.cy) <= 1,
      }, { sideW: geo.side && r1(geo.side.w), sideTitleCy: geo.sideTitle && r1(geo.sideTitle.cy), headerCy: geo.title && r1(geo.title.cy) });
    }

    if (theme === 'light' && v.kind === 'desktop' && v.w === 1320) await desktopFlows(page, vp);
    if (theme === 'light' && v.kind === 'phone') await phoneFlows(page, vp);
    if (theme === 'light' && v.kind === 'foldable') await foldableFlows(page, vp);
    await ctx.close();
  }
}

async function dragCard(page, fromSel, toSel, { steps = 12, holdShot } = {}) {
  const a = await box(page, fromSel);
  const b = await box(page, toSel);
  await page.mouse.move(a.x + a.w / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.w / 2 + 10, a.y + 24, { steps: 3 });
  await page.mouse.move(b.x + b.w / 2, b.y + 80, { steps });
  const indicator = await page.locator(tid('req-drop-indicator')).count();
  const ghost = await page.locator(tid('req-drag-ghost')).count();
  if (holdShot) await shot(page, holdShot);
  await page.mouse.up();
  return { indicator, ghost };
}

function cardByName(page, name) { return page.locator('[data-testid^="req-card-"]', { hasText: name }).first(); }
async function cardId(page, name) { return cardByName(page, name).getAttribute('data-testid'); }
async function count(page, col) { return Number((await page.locator(tid(`req-count-${col}`)).first().textContent()).trim()); }

async function desktopFlows(page, vp) {
  // create
  await page.locator(tid('req-new')).click();
  await page.locator(tid('req-create')).waitFor();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  await page.keyboard.type('新建的任务:检查拖动');
  let pickerKinds = '';
  if (ROLES === 'two') {
    // 负责人 = 人类,负责 Agent = 节点;两个选择器各自只列一种
    await page.locator(tid('req-assignee')).click();
    await page.locator(tid(`person-user:${HUB_ME}`)).waitFor();
    const ownerNodes = await page.locator('[data-testid^="person-node:"]').count();
    await page.locator(tid(`person-user:${HUB_ME}`)).click();
    await page.locator(tid('people-confirm')).click();
    await page.locator(tid('req-assignee-agent')).click();
    await page.locator(tid('person-node:node_demo_c')).waitFor();
    const agentUsers = await page.locator('[data-testid^="person-user:"]').count();
    await page.locator(tid('person-node:node_demo_c')).click();
    await page.locator(tid('people-confirm')).click();
    pickerKinds = `${ownerNodes}/${agentUsers}`;
  } else {
    await page.locator(tid('req-assignee')).click();
    await page.locator(tid('person-node:node_demo_c')).click();
    await page.locator(tid('people-confirm')).click();
    pickerKinds = (await page.locator(tid('req-assignee-agent')).count()) === 0 ? '0/0' : 'agent-picker-shown';
  }
  await page.locator(tid('req-priority-high')).click();
  await shot(page, 'flow-create-dialog');
  await page.locator(tid('req-add')).click();
  await page.locator(tid('req-create')).waitFor({ state: 'detached' });
  const created = await hubRow('新建的任务:检查拖动');
  record(vp, 'flow: create via dialog', {
    autofocus: focused === 'req-name', onHub: !!created,
    ownerIdentity: ROLES === 'two'
      ? JSON.stringify(created?.owner) === JSON.stringify({ kind: 'user', id: HUB_ME }) && JSON.stringify(created?.agent_owner) === '{"kind":"node","id":"node_demo_c"}'
      : JSON.stringify(created?.owner) === '{"kind":"node","id":"node_demo_c"}' && created?.agent_owner === undefined,
    pickersFilterKinds: pickerKinds === '0/0',
    assigneeEmpty: created?.assignee === '', priority: created?.priority === 'high',
    onBoard: await cardByName(page, '新建的任务:检查拖动').count() === 1,
  }, { owner: JSON.stringify(created?.owner), agent: JSON.stringify(created?.agent_owner), pickerKinds });

  // cards: two avatars, human then agent (ROLES=two); a card with both roles on the seed
  if (ROLES === 'two') {
    const av = await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-testid^="req-card-"]')].find(c => c.textContent.includes('登录页支持扫码登录'));
      const x = (id) => { const e = card?.querySelector(`[data-testid="${id}"]`); return e ? e.getBoundingClientRect().x : null; };
      return { owner: x('task-avatar-owner'), agent: x('task-avatar-agent') };
    });
    record(vp, 'cards: 负责人 avatar then 负责 Agent avatar', { both: av.owner !== null && av.agent !== null, humanFirst: av.owner < av.agent }, { ownerX: av.owner && r1(av.owner), agentX: av.agent && r1(av.agent) });
  }

  // drag 需求池 → 进行中
  const name = '看板卡片支持拖动换列';
  const poolBefore = await count(page, 'pool'), doingBefore = await count(page, 'doing');
  const { indicator, ghost } = await dragCard(page, tid(await cardId(page, name)), tid('req-col-doing'), { holdShot: 'flow-drag-over' });
  await page.waitForTimeout(800);
  const moved = await hubRow(name);
  record(vp, 'flow: drag card to 进行中', {
    ghostShown: ghost === 1, dropIndicator: indicator === 1, hubColumn: moved?.column === 'doing',
    countsUpdated: (await count(page, 'pool')) === poolBefore - 1 && (await count(page, 'doing')) === doingBefore + 1,
    noDetailOpened: await page.locator(tid('req-detail')).count() === 0,
  }, { hub: moved?.column });

  // checklist progress on the card (seed: 登录页支持扫码登录 has 3/7)
  const prog = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-testid^="req-card-"]')].find(c => c.textContent.includes('登录页支持扫码登录'));
    const p = card?.querySelector('[data-testid="task-checklist-progress"]');
    const bar = card?.querySelector('[data-testid="task-checklist-bar"]');
    return { text: p?.textContent ?? null, barW: bar ? bar.getBoundingClientRect().width : 0, trackW: bar ? bar.parentElement.getBoundingClientRect().width : 0 };
  });
  if (ROLES === 'two') {
    record(vp, 'cards: checklist progress 3/7 + bar', { text: !!prog.text && prog.text.includes('3/7'), bar: Math.abs(prog.barW / prog.trackW - 3 / 7) < 0.02 }, { text: prog.text, ratio: prog.trackW ? r1(prog.barW / prog.trackW * 100) + '%' : '-' });

    // detail: description preview/edit + checklist toggle / add / drag reorder / delete, each read back from the hub
    const cName = '登录页支持扫码登录';
    await cardByName(page, cName).click();
    await page.locator(tid('req-detail')).waitFor();
    await page.waitForTimeout(400);
    const previewShown = await page.locator(tid('req-description-preview')).count();
    await page.locator(tid('req-checklist-item-s3')).click();
    await page.waitForTimeout(600);
    const afterToggle = (await hubRow(cName)).checklist;
    await page.locator(tid('req-checklist-input')).fill('补一条子任务');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const afterAdd = (await hubRow(cName)).checklist;
    // drag the first item's handle below the third
    const h = await box(page, tid('req-checklist-handle-s0'));
    const t = await box(page, tid('req-checklist-item-s2'));
    await page.locator(tid('req-checklist-item-s0')).hover();
    await page.mouse.move(h.x + h.w / 2, h.y + h.h / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.w / 2, t.y + t.h * 0.8, { steps: 8 });
    const dropShown = await page.locator(tid('req-checklist-drop')).count();
    await shot(page, 'flow-checklist-drag');
    await page.mouse.up();
    await page.waitForTimeout(700);
    const afterMove = (await hubRow(cName)).checklist;
    await page.locator(tid('req-checklist-item-s5')).hover();
    await page.locator(tid('req-checklist-delete-s5')).click();
    await page.waitForTimeout(600);
    const afterDelete = (await hubRow(cName)).checklist;
    await page.locator(tid('req-description-mode-edit')).click();
    await page.locator(tid('req-description-input')).fill('## 目标\n扫码登录\n\n**验收**:三端都能扫');
    await page.locator(tid('req-description-mode-preview')).click();
    const rendered = await page.locator(`${tid('req-description-preview')}`).textContent();
    await page.locator(tid('req-edit-save')).click();
    await page.waitForTimeout(700);
    await shot(page, 'flow-description-checklist');
    const afterDesc = await hubRow(cName);
    record(vp, 'detail: description + checklist round-trip', {
      previewFirst: previewShown === 1,
      toggleOneItem: afterToggle.map(i => i.done).join() === 'true,true,true,true,false,false,false',
      add: afterAdd.length === 8 && afterAdd[7].text === '补一条子任务',
      dragIndicator: dropShown === 1,
      reorder: afterMove.slice(0, 3).map(i => i.id).join() === 's1,s2,s0',
      delete: afterDelete.length === 7 && !afterDelete.some(i => i.id === 's5'),
      descriptionSaved: afterDesc.description === '## 目标\n扫码登录\n\n**验收**:三端都能扫',
      previewRendersMarkdown: !!rendered && !rendered.includes('**'),
    }, { order: afterMove.slice(0, 3).map(i => i.id).join() });
    await page.locator(tid('req-detail-close')).click();
  } else {
    await cardByName(page, '登录页支持扫码登录').click();
    await page.locator(tid('req-detail')).waitFor();
    record(vp, 'old hub: no description/checklist, upgrade hint', {
      hint: await page.locator(tid('req-details-unsupported')).count() === 1,
      noChecklist: await page.locator(tid('req-checklist')).count() === 0,
      noProgressOnCards: await page.locator(tid('task-checklist-progress')).count() === 0,
    });
    await page.locator(tid('req-detail-close')).click();
  }

  // sidebar: only nodes with tasks; the 40 idle ones behind 「更多节点」 with a search
  {
    const side = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="task-side-node:"]')].map(e => ({ id: e.dataset.testid, count: Number((e.lastElementChild?.textContent || '').trim()) })));
    const moreBtn = await page.locator(tid('task-side-more-nodes')).count();
    const moreText = moreBtn ? await page.locator(tid('task-side-more-nodes')).textContent() : '';
    await page.locator(tid('task-side-more-nodes')).click();
    await page.locator(tid('task-side-more-search')).fill('idle-node-1');
    await page.waitForTimeout(300);
    const found = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="task-side-node:node_idle_"]')].length);
    await shot(page, 'flow-sidebar-more-nodes');
    await page.locator(tid('task-side-more-nodes')).click();
    record(vp, 'sidebar: nodes with tasks only; idle ones folded + searchable', {
      noZeroRows: side.length > 0 && side.every(r => r.count >= 1),
      folded: moreBtn === 1 && Number((moreText || '').replace(/\D+/g, '')) >= 40,
      search: found === 10,
    }, { shown: side.length, more: (moreText || '').replace(/\D+/g, ''), searchHits: found });
  }

  if (ROLES === 'two') {
    // projects: sidebar filter + counts, chips on cards, default in create, manager (create / rename / recolour / archive)
    const hubAll = await hubList();
    const projectsOnHub = (await (await fetch(`${HUB_URL}/api/requirements/projects?network_id=${HUB_NETWORK}`, { headers: { authorization: `Bearer ${HUB_TOKEN}` } })).json()).projects;
    const tmai = projectsOnHub.find(p => p.name === 'TMAI');
    const chips = await page.locator(tid('task-project-chip')).count();
    await page.locator(tid(`task-side-project-${tmai.id}`)).click();
    await page.waitForTimeout(400);
    const shownT = await page.locator('[data-testid^="req-card-"]').count();
    const sideCount = (await page.locator(tid(`task-side-project-${tmai.id}`)).textContent()).replace(/\D+/g, '');
    await shot(page, 'flow-project-filter-tmai');
    await page.locator(tid('req-new')).click();
    await page.locator(tid('req-create')).waitFor();
    const defaultOn = await page.evaluate((id) => { const e = document.querySelector(`[data-testid="req-project-${id}"]`); return e?.getAttribute('aria-checked') ?? e?.getAttribute('aria-selected') ?? 'missing'; }, tmai.id);
    await page.keyboard.type('TMAI 里新建的任务');
    await page.locator(tid('req-add')).click();
    await page.locator(tid('req-create')).waitFor({ state: 'detached' });
    const createdT = await hubRow('TMAI 里新建的任务');
    record(vp, 'projects: sidebar filter, chips, create default', {
      chipsOnCards: chips >= 5,
      filtered: shownT === hubAll.filter(r => r.project_id === tmai.id).length,
      countMatches: Number(sideCount) === shownT,
      defaultProject: defaultOn === 'true' && createdT?.project_id === tmai.id,
    }, { shown: shownT, side: sideCount, created: createdT?.project_id === tmai.id, defaultOn });
    await page.locator(tid('task-side-project-all')).click();
    await page.waitForTimeout(300);

    await page.locator(tid('task-side-manage-projects')).click();
    await page.locator(tid('project-manager')).waitFor();
    await page.locator(tid('project-new-name')).fill('测试项目');
    await page.locator(tid('project-new-add')).click();
    await page.waitForTimeout(600);
    let list = (await (await fetch(`${HUB_URL}/api/requirements/projects?network_id=${HUB_NETWORK}`, { headers: { authorization: `Bearer ${HUB_TOKEN}` } })).json()).projects;
    const test = list.find(p => p.name === '测试项目');
    await page.locator(tid(`project-name-${test.id}`)).click();
    await page.locator(tid(`project-name-input-${test.id}`)).fill('测试项目二');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.locator(tid(`project-color-${test.id}`)).click();
    await page.waitForTimeout(500);
    await shot(page, 'flow-project-manager');
    await page.locator(tid(`project-archive-${test.id}`)).click();
    await page.waitForTimeout(600);
    list = (await (await fetch(`${HUB_URL}/api/requirements/projects?network_id=${HUB_NETWORK}`, { headers: { authorization: `Bearer ${HUB_TOKEN}` } })).json()).projects;
    const after = list.find(p => p.id === test.id);
    await page.locator(tid('project-manager-close')).click();
    const sideHasArchived = await page.locator(tid(`task-side-project-${test.id}`)).count();
    record(vp, 'projects: manager create / rename / recolour / archive', {
      created: !!test, renamed: after?.name === '测试项目二', recoloured: after && after.color !== test.color, archived: after?.archived === true, hiddenFromSidebar: sideHasArchived === 0,
    });

    // list view sorted by project
    await page.locator(tid('tasks-view-list')).click();
    await page.locator(tid('req-sort-project')).click();
    await page.waitForTimeout(300);
    const firstRows = await page.locator('[data-testid^="req-row-"] [data-testid="task-project-chip"]').allTextContents();
    await shot(page, 'flow-list-sorted-by-project');
    record(vp, 'list: sort by project', { projectFirst: firstRows.length > 0 && firstRows[0].includes('军团项目') }, { first: firstRows[0] });
    await page.locator(tid('tasks-view-board')).click();
    await page.waitForTimeout(300);
  } else {
    record(vp, 'old hub: projects hidden', {
      noSidebarGroup: await page.locator(tid('task-side-manage-projects')).count() === 0,
      noChip: await page.locator(tid('task-filter-project')).count() === 0,
      noCardChips: await page.locator(tid('task-project-chip')).count() === 0,
    });
  }

  // drawer edit
  await cardByName(page, '设置页拆分子页面').click();
  await page.locator(tid('req-detail')).waitFor();
  await page.waitForTimeout(400);
  const drawer = await box(page, tid('req-detail'));
  const header = await box(page, tid('task-header'));
  const root = await box(page, tid('requirement-board'));
  await page.locator(tid('req-edit-name')).fill('设置页拆分子页面(已编辑)');
  await page.locator(tid('req-edit-priority-high')).click();
  await page.locator(tid('req-edit-due-tomorrow')).click();
  if (ROLES === 'two') {
    await page.locator(tid('req-edit-owner-agent')).click();
    await page.locator(tid('person-node:node_demo_b')).click();
    await page.locator(tid('people-confirm')).click();
  }
  await shot(page, 'flow-drawer-edit');
  await page.locator(tid('req-edit-save')).click();
  await page.waitForTimeout(800);
  const edited = await hubRow('设置页拆分子页面(已编辑)');
  record(vp, 'flow: edit in drawer', {
    drawerTopOnHeaderBottom: Math.abs(drawer.y - header.b) <= 1, drawerRightOnContentRight: Math.abs(drawer.r - root.r) <= 1,
    hubTitle: !!edited, hubPriority: edited?.priority === 'high', hubDue: !!edited?.due,
    hubAgent: ROLES !== 'two' || edited?.agent_owner?.id === 'node_demo_b',
  }, { drawerTop: r1(drawer.y), headerBottom: r1(header.b), drawerRight: r1(drawer.r), contentRight: r1(root.r) });
  await page.locator(tid('req-detail-close')).click();

  // filter by owner from the sidebar
  // 没任务的节点折在「更多节点」里:先展开、搜到再点
  if (!(await page.locator(tid('task-side-node:node_demo_a')).count())) {
    await page.locator(tid('task-side-more-nodes')).click();
    await page.locator(tid('task-side-more-search')).fill('demo-node-a');
  }
  await page.locator(tid('task-side-node:node_demo_a')).click();
  await page.waitForTimeout(400);
  const shown = await page.locator('[data-testid^="req-card-"]').allTextContents();
  const all = await hubList();
  const expectA = all.filter(r => (ROLES === 'two' ? r.agent_owner?.id : r.owner?.id) === 'node_demo_a').length;
  const chip = (await page.locator(tid('task-filter-owner')).textContent()) || '';
  await shot(page, 'flow-filter-node-a');
  record(vp, 'flow: filter by owner (sidebar)', { onlyA: shown.length === expectA, chipReads: chip.includes('demo-node-a') }, { shown: shown.length, expect: expectA });
  if (ROLES === 'two') {
    await page.locator(tid('task-side-mine')).click();
    await page.waitForTimeout(400);
    const mine = await page.locator('[data-testid^="req-card-"]').count();
    const expectMine = all.filter(r => r.owner?.kind === 'user' && r.owner.id === HUB_ME).length;
    const label = (await page.locator('[data-testid="task-sidebar"]').textContent()) || '';
    await shot(page, 'flow-filter-mine');
    record(vp, 'flow: 我负责的 = 负责人 is me; sidebar says 按 Agent', { mine: mine === expectMine && mine > 0, agentSection: label.includes('按 Agent') }, { shown: mine, expect: expectMine });
  }
  await page.locator(tid('task-side-all')).click();
  await page.waitForTimeout(300);

  // keyboard: Shift+→
  const kName = '登录页支持扫码登录';
  await page.locator(tid(await cardId(page, kName))).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(800);
  record(vp, 'flow: keyboard Shift+→', { hubColumn: (await hubRow(kName))?.column === 'doing' });

  // right-click menu
  const mName = '整理 9 月的发版说明,补上安卓和桌面端的差异';
  await cardByName(page, mName).click({ button: 'right' });
  await page.locator(tid('task-menu')).waitFor();
  await shot(page, 'flow-context-menu');
  await page.locator(tid('task-menu-move-done')).click();
  await page.waitForTimeout(800);
  record(vp, 'flow: right-click 移到 完成', { hubColumn: (await hubRow(mName))?.column === 'done' });

  // list view (table, sortable)
  await page.locator(tid('tasks-view-list')).click();
  await page.locator(tid('req-list')).waitFor();
  await page.locator(tid('req-sort-due')).click();
  await page.waitForTimeout(300);
  await shot(page, 'flow-list-sorted-by-due');
  const firstRow = (await page.locator('[data-testid^="req-row-"]').first().textContent()) || '';
  record(vp, 'list view sorted by due', { overdueFirst: firstRow.includes('节点日志查看器') || firstRow.includes('逾期') }, { first: firstRow.slice(0, 20) });
  await page.locator(tid('tasks-view-board')).click();
}

async function phoneFlows(page, vp) {
  // 手机一屏一列:用第一列(需求池)里看得见的第一张卡片。
  const name = ((await page.locator(`${tid('req-col-pool')} [data-testid^="req-card-"]`).first().textContent()) || '').replace(/(高|普通|低).*$/, '');
  if (!(await hubRow(name))) throw new Error(`phone flow: no hub row for "${name}"`);
  const before = (await hubRow(name))?.column;
  // A pointer drag on touch must not move anything.
  const card = await box(page, tid(await cardId(page, name)));
  await page.mouse.move(card.x + 30, card.y + 20);
  await page.mouse.down();
  await page.mouse.move(card.x + 200, card.y + 20, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const afterDrag = (await hubRow(name))?.column;
  // long-press → menu → 移到 完成
  await page.locator(tid('req-detail')).count().then(n => n && page.locator(tid('req-detail-close')).click());
  const c2 = await box(page, tid(await cardId(page, name)));
  await page.mouse.move(c2.x + 30, c2.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const menu = await page.locator(tid('task-menu')).count();
  await shot(page, 'flow-phone-longpress-menu');
  if (menu) await page.locator(tid('task-menu-move-done')).click();
  await page.waitForTimeout(800);
  record(vp, 'phone: no drag, long-press menu moves', {
    dragDidNothing: afterDrag === before, menuOpened: menu === 1, hubColumn: (await hubRow(name))?.column === 'done',
    noGhost: await page.locator(tid('req-drag-ghost')).count() === 0,
  }, { before, afterDrag });
  // detail = pushed page (full screen)
  await cardByName(page, '语音输入快捷键').click();
  await page.locator(tid('req-detail')).waitFor();
  await page.waitForTimeout(500);
  const d = await box(page, tid('req-detail'));
  await shot(page, 'flow-phone-detail-page');
  record(vp, 'phone: detail is a pushed page', { fullWidth: Math.abs(d.w - 390) <= 1, fromTop: d.y <= 1 }, { w: r1(d.w), y: r1(d.y) });
  await page.locator(tid('req-detail-close')).click();
  await page.waitForTimeout(400);
  // create = bottom sheet
  await page.locator(tid('req-new')).click();
  await page.locator(tid('req-create')).waitFor();
  await page.waitForTimeout(500);
  const sheet = await box(page, tid('req-create'));
  await shot(page, 'flow-phone-create-sheet');
  record(vp, 'phone: create is a bottom sheet', { atBottom: Math.abs(sheet.b - 844) <= 1, fullWidth: Math.abs(sheet.w - 390) <= 1 }, { bottom: r1(sheet.b), w: r1(sheet.w) });
  await page.locator(tid('req-create-close')).click();
  // grouped list
  await page.locator(tid('tasks-view-list')).click();
  await page.waitForTimeout(500);
  await shot(page, 'flow-phone-grouped-list');
  record(vp, 'phone: list is grouped by status', { groups: await page.locator('[data-testid^="req-group-"]').count() === 3 });
  await page.locator(tid('tasks-view-board')).click();
}

async function foldableFlows(page, vp) {
  const name = '设置页拆分子页面(已编辑)';
  const id = await cardId(page, name);
  const before = (await hubRow(name))?.column;
  if (id) await dragCard(page, tid(id), tid('req-col-done'));
  await page.waitForTimeout(600);
  record(vp, 'foldable: touch has no drag', { found: !!id, unchanged: (await hubRow(name))?.column === before, noGhost: await page.locator(tid('req-drag-ghost')).count() === 0 });
  if (await page.locator(tid('req-detail')).count()) await page.locator(tid('req-detail-close')).click();
}

console.log('\n| viewport | check | ok | detail |');
console.log('|---|---|---|---|');
for (const r of rows) {
  const { vp, what, ok, failed, ...rest } = r;
  console.log(`| ${vp} | ${what} | ${ok ? '✅' : '❌ ' + failed} | ${Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ')} |`);
}
await browser.close();
web.close();
console.log(`\n${failures ? `FAIL ${failures}` : 'PASS'} (${rows.length} checks)`);
process.exit(failures ? 1 : 0);
