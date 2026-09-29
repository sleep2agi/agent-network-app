// 需求优先级 P0–P3(owner 09-30:「P0、P1、P2、P3 …… 最高，然后普通，然后低，然后极低」)—— web 导出 + 桩 Hub,量真框。
// Not in CI: needs Playwright + Chromium and a web export. No real hub: this script serves two in-memory stub hubs
// (placeholder data, no credentials) —
//   new hub : list capabilities include priority_lowest, accepts lowest
//   old hub : no priority_lowest; POST / PATCH with lowest answer 400 invalid_priority (what a hub before the change does)
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-requirement-priority/drive.mjs
//
// desktop 1200×800 (Tauri stub ⇒ desktop workspace) and phone 390×844 (Android UA, touch), light theme:
//   badges   every card shows a compact P0/P1/P2/P3 badge; its centre line = the owner avatar's and the due chip's ±1px,
//            height 20 (= due chip), one line; P3 is dashed and muted
//   list     (desktop) the 优先级 cell is the same badge; sorting by 优先级 gives P0→P3, again P3→P0
//   filter   the priority chip offers P0 最高 … P3 极低; picking P3 leaves only the P3 card and the chip reads 「P3 极低」
//   create   the picker shows 「P0 最高」…「P3 极低」, P1 普通 selected by default, every segment inside the dialog, labels
//            unclipped; picking P3 → the hub receives priority lowest
//   detail   the edit picker offers four; P0 → P3 → 保存修改 → hub has lowest
//   old hub  pickers and the filter offer P0–P2 only; creating never sends lowest (the stub records every write)
// Exit 1 when any assertion fails.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });

// ── stub hubs ──
const NET = 'net_fixture';
const people = [{ kind: 'user', id: 'u1', name: 'tester' }, { kind: 'node', id: 'node_demo_a', name: 'demo-node-a' }];
function seed() {
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const base = { assignee: '', owner: { kind: 'user', id: 'u1' }, agent_owner: null, participants: [], checklist: [], description: '', project_id: null, parent_id: null, tags: [], issues: [], external_ref: null, external_url: null, archived: false };
  return [
    { ...base, id: 'r_p0', name: '最高优先级的卡', priority: 'high', column: 'pool', due: day(2) },
    { ...base, id: 'r_p1', name: '普通优先级的卡', priority: 'normal', column: 'pool', due: day(3) },
    { ...base, id: 'r_p2', name: '低优先级的卡', priority: 'low', column: 'pool', due: day(4) },
    { ...base, id: 'r_p3', name: '极低优先级的卡', priority: 'lowest', column: 'pool', due: day(5) },
  ].map((r, i) => ({ ...r, createdAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(), updatedAt: new Date().toISOString() }));
}
function stubHub(lowest) {
  const hub = { rows: lowest ? seed() : seed().filter(r => r.priority !== 'lowest'), writes: [], unknown: new Set() };
  const caps = ['agent_owner', 'description', 'checklist', 'projects', 'due_datetime', 'external_ref', 'archived', 'agent_api', 'sub_requirements', 'tags', ...(lowest ? ['priority_lowest'] : [])];
  const ok = new Set(['high', 'normal', 'low', ...(lowest ? ['lowest'] : [])]);
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://stub');
    let body = {};
    if (req.method !== 'GET') { let raw = ''; for await (const c of req) raw += c; try { body = JSON.parse(raw || '{}'); } catch {} }
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const p = url.pathname;
    if (p === '/api/requirements' && req.method === 'GET') return send(200, { ok: true, requirements: hub.rows, capabilities: caps });
    if (p === '/api/requirements/projects') return send(200, { ok: true, projects: [] });
    if (p === '/api/requirements/people') return send(200, { ok: true, people });
    if (p === '/api/auth/me') return send(200, { ok: true, user: { id: 'u1', user_id: 'u1', username: 'tester' } });
    if (p === '/api/requirements' && req.method === 'POST') {
      hub.writes.push({ method: 'POST', priority: body.priority });
      const priority = body.priority ?? 'normal';
      if (!ok.has(priority)) return send(400, { ok: false, error: 'invalid_priority' });
      const row = { ...seed()[1], id: `r_new_${hub.rows.length}`, name: body.name, priority, column: body.column || 'pool', due: body.due || '', createdAt: new Date().toISOString() };
      hub.rows.unshift(row);
      return send(201, { ok: true, requirement: row });
    }
    const m = p.match(/^\/api\/requirements\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
      hub.writes.push({ method: 'PATCH', priority: body.priority });
      if ('priority' in body && !ok.has(body.priority)) return send(400, { ok: false, error: 'invalid_priority' });
      const row = hub.rows.find(r => r.id === m[1]);
      if (!row) return send(404, { ok: false, error: 'not_found' });
      if ('priority' in body) row.priority = body.priority;
      if ('name' in body) row.name = body.name;
      row.updatedAt = new Date().toISOString();
      return send(200, { ok: true, requirement: row });
    }
    if (m && req.method === 'GET') { const row = hub.rows.find(r => r.id === m[1]); return row ? send(200, { ok: true, requirement: row }) : send(404, { ok: false, error: 'not_found' }); }
    hub.unknown.add(`${req.method} ${p}`);
    send(200, { ok: true, sessions: [], nodes: [], networks: [{ network_id: NET, name: 'fixture', role: 'owner' }], members: [], tasks: [], messages: [], items: [], schedules: [] });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ hub, url: `http://127.0.0.1:${server.address().port}`, server })));
}
const hubs = { new: await stubHub(true), old: await stubHub(false) };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const web = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(WEB, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const WEB_URL = `http://127.0.0.1:${web.address().port}/`;

// Desktop-shell stub (same shape as tests/test-task-organize): plugin:http → the stub hub.
const initScript = ({ hubUrl, networkId }) => {
  const profile = { serverUrl: hubUrl, token: 'utok_fixture', username: 'tester', profileId: 'p-req-priority', displayName: 'tester', networkId };
  let rid = 0; const reqs = new Map(); const bodies = new Map(); const handlers = {};
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'load_active_desktop_profile': case 'load_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return args.sessionJson;
        case 'read_desktop_profile_file': return null;
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': { (handlers[args.event] ||= []).push(args.handler); return Math.floor(Math.random() * 1e6); }
        case 'plugin:window|get_all_windows': case 'plugin:webview|get_all_webviews': return [];
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const r = await fetch(c.url, { method: c.method, headers: c.headers, body: c.data ? new Uint8Array(c.data) : undefined });
          const buf = new Uint8Array(await r.arrayBuffer());
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: r.status, statusText: r.statusText, url: r.url || c.url, headers: Array.from(r.headers.entries()), rid: id };
        }
        case 'plugin:http|fetch_read_body': { const b = bodies.get(args.rid); if (!b.sent) { b.sent = true; return [...b.buf, 0]; } return [1]; }
        default: return null;
      }
    },
  };
  try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('task_detail_more_open_v1', '1'); } catch {}
};

const findExe = () => {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
};
const browser = await chromium.launch({ headless: true, executablePath: findExe(), args: ['--disable-web-security'] });
const r1 = (n) => Math.round(n * 10) / 10;
const tid = (id) => `[data-testid="${id}"]`;
let failures = 0;
const rows = [];
function record(vp, what, checks, detail = {}) {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  const failed = Object.keys(checks).filter(k => !checks[k]).join(',') || '-';
  rows.push({ vp, what, ok, failed, detail });
  console.log(JSON.stringify({ vp, what, ...detail, ok, failed }));
}
const rectIn = (el) => el.evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.y + b.height / 2 }; });
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

async function open(kind, hubKind) {
  const phone = kind === 'phone';
  // 每一段从同一份种子起步(前一段的新建 / 改动不带过来)。
  const fresh = hubKind === 'new' ? seed() : seed().filter(r => r.priority !== 'lowest');
  hubs[hubKind].hub.rows.splice(0, Infinity, ...fresh);
  hubs[hubKind].hub.writes.length = 0;
  const [w, h] = phone ? [390, 844] : [1200, 800];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ...(phone ? { userAgent: PHONE_UA, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  await page.addInitScript(initScript, { hubUrl: hubs[hubKind].url, networkId: NET });
  if (phone) {
    await page.goto(`${WEB_URL}?safeAreaSim=32,0,24,0`);
    await page.waitForFunction(() => !!window.__anetLayoutSweep, null, { timeout: 30000 });
    await page.evaluate(() => window.__anetLayoutSweep.setScreen({ name: 'tasks' }));
  } else {
    await page.goto(WEB_URL);
    await page.locator('[data-testid="desktop-rail"] [aria-label="任务"]').first().click({ timeout: 30000 });
  }
  await page.locator(tid('tasks-view-board')).first().click({ timeout: 20000 });
  await page.locator('[data-testid^="req-card-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors, vp: `${kind} ${w}x${h} ${hubKind} hub`, w, h };
}

async function badgeRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-card-"]')].filter(c => c.getBoundingClientRect().width > 0).map(card => {
    const q = (id) => card.querySelector(`[data-testid="${id}"]`);
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { cy: b.y + b.height / 2, h: b.height, w: b.width }; };
    const badge = q('task-prio-badge');
    const avatar = card.querySelector('[data-testid^="task-avatar-"]') || q('task-owner');
    const text = badge ? badge.textContent : null;
    const style = badge ? getComputedStyle(badge) : null;
    const label = badge ? badge.querySelector('div') : null;
    return { id: card.dataset.testid.replace('req-card-', ''), text, badge: r(badge), avatar: r(avatar), due: r(q('task-due')), dashed: style?.borderTopStyle === 'dashed', color: label ? getComputedStyle(label).color : null, clipped: label ? label.scrollWidth > label.clientWidth + 0.5 : null };
  }));
}

async function checkBadges(s) {
  const got = await badgeRows(s.page);
  const want = { r_p0: 'P0', r_p1: 'P1', r_p2: 'P2', r_p3: 'P3' };
  const seeded = got.filter(g => want[g.id]);
  const aligned = seeded.every(g => g.badge && g.avatar && g.due && Math.abs(g.badge.cy - g.avatar.cy) <= 1 && Math.abs(g.badge.cy - g.due.cy) <= 1);
  const p3 = got.find(g => g.id === 'r_p3');
  const p2 = got.find(g => g.id === 'r_p2');
  record(s.vp, 'cards: compact P0–P3 badge on the owner / due centre line', {
    allSeeded: seeded.length === (s.vp.includes('old') ? 3 : 4),
    text: seeded.every(g => g.text === want[g.id]),
    aligned, height20: seeded.every(g => g.badge && Math.abs(g.badge.h - 20) <= 0.5 && Math.abs(g.badge.h - g.due.h) <= 0.5),
    unclipped: seeded.every(g => g.clipped === false),
    p3Dashed: s.vp.includes('old') ? true : !!p3?.dashed,
    p3Muted: s.vp.includes('old') ? true : !!p3 && !!p2 && p3.color !== p2.color,
  }, { rows: seeded.map(g => `${g.text}:dy_avatar=${g.badge && g.avatar ? r1(g.badge.cy - g.avatar.cy) : 'x'},dy_due=${g.badge && g.due ? r1(g.badge.cy - g.due.cy) : 'x'},h=${g.badge ? r1(g.badge.h) : 'x'},w=${g.badge ? r1(g.badge.w) : 'x'}`).join(' ') });
}

async function checkFilter(s, expectLowest) {
  await s.page.locator(tid('task-filter-priority')).first().click();
  await s.page.locator(tid('task-filter-opt-high')).first().waitFor({ timeout: 5000 });
  const opts = await s.page.evaluate(() => ['high', 'normal', 'low', 'lowest'].map(p => { const e = [...document.querySelectorAll(`[data-testid="task-filter-opt-${p}"]`)].find(x => x.getBoundingClientRect().width > 0); return e ? e.textContent : null; }));
  await shot(s.page, `filter-${s.vp.replace(/\W+/g, '-')}`);
  const labels = ['P0 最高', 'P1 普通', 'P2 低', 'P3 极低'];
  const listed = opts.map((o, i) => o !== null && o.includes(labels[i]));
  if (expectLowest) {
    await s.page.locator(tid('task-filter-opt-lowest')).first().click();
    await s.page.keyboard.press('Escape').catch(() => {});
    await s.page.mouse.click(5, s.h - 5).catch(() => {});
    await s.page.waitForTimeout(400);
    const ids = (await badgeRows(s.page)).map(g => g.id);
    const chip = await s.page.locator(tid('task-filter-priority')).first().textContent();
    record(s.vp, 'filter: four options P0 最高 … P3 极低; P3 leaves only the P3 card', { four: listed.every(Boolean), onlyP3: ids.length === 1 && ids[0] === 'r_p3', chip: (chip || '').includes('P3 极低') }, { opts: opts.join('|'), ids: ids.join(','), chip });
    await s.page.locator(tid('task-filter-priority')).first().click();
    await s.page.locator(tid('task-filter-reset')).first().click();
    await s.page.waitForTimeout(300);
  } else {
    record(s.vp, 'filter (old hub): P0–P2 only', { three: listed.slice(0, 3).every(Boolean) && opts[3] === null }, { opts: opts.join('|') });
    await s.page.keyboard.press('Escape').catch(() => {});
    await s.page.mouse.click(5, s.h - 5).catch(() => {});
    await s.page.waitForTimeout(300);
  }
}

async function checkCreate(s, expectLowest) {
  const hub = hubs[s.vp.includes('old') ? 'old' : 'new'].hub;
  await s.page.locator(tid('req-new')).first().click();
  await s.page.locator(tid('req-create')).first().waitFor({ timeout: 8000 });
  await s.page.waitForTimeout(300);
  const seg = await s.page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[data-testid="req-create"]')].find(x => x.getBoundingClientRect().width > 0);
    const d = dlg.getBoundingClientRect();
    return ['high', 'normal', 'low', 'lowest'].map(p => {
      const e = dlg.querySelector(`[data-testid="req-priority-${p}"]`);
      if (!e) return null;
      const b = e.getBoundingClientRect(); const t = e.querySelector('div:last-child');
      return { p, text: e.textContent, checked: e.getAttribute('aria-checked'), inside: b.left >= d.left - 0.5 && b.right <= d.right + 0.5, clipped: t ? t.scrollWidth > t.clientWidth + 0.5 : true, cy: b.y + b.height / 2, h: b.height, x: b.x, w: b.width };
    });
  });
  await shot(s.page, `create-${s.vp.replace(/\W+/g, '-')}`);
  const labels = ['P0 最高', 'P1 普通', 'P2 低', 'P3 极低'];
  const shown = seg.filter(Boolean);
  const oneRow = shown.every(x => Math.abs(x.cy - shown[0].cy) <= 1);
  record(s.vp, `create: picker 「P0 最高」… ${expectLowest ? '「P3 极低」' : '「P2 低」 (no P3 on the old hub)'}, P1 default, inside the dialog, unclipped`, {
    options: expectLowest ? shown.length === 4 : shown.length === 3 && seg[3] === null,
    labels: shown.every((x, i) => x.text.includes(labels[i])),
    p1Default: seg[1]?.checked === 'true' && shown.filter(x => x.checked === 'true').length === 1,
    inside: shown.every(x => x.inside), unclipped: shown.every(x => !x.clipped),
  }, { segs: shown.map(x => `${x.text}@${r1(x.x)}+${r1(x.w)}`).join(' '), oneRow });
  const name = `新建的卡 ${s.vp}`;
  await s.page.locator(tid('req-name')).first().fill(name);
  const before = hub.writes.length;
  if (expectLowest) await s.page.locator(tid('req-priority-lowest')).first().click();
  else await s.page.locator(tid('req-priority-low')).first().click();
  await s.page.locator(tid('req-add')).first().click();
  await s.page.waitForTimeout(800);
  const writes = hub.writes.slice(before);
  const row = hub.rows.find(r => r.name === name);
  record(s.vp, `create: ${expectLowest ? 'P3 → hub gets lowest' : 'hub never gets lowest'}`, {
    posted: writes.length === 1 && writes[0].method === 'POST',
    value: expectLowest ? row?.priority === 'lowest' : row?.priority === 'low',
    neverLowest: expectLowest || hub.writes.every(w => w.priority !== 'lowest'),
  }, { writes: JSON.stringify(writes), stored: row?.priority });
}

async function checkDetail(s, expectLowest) {
  const hub = hubs[s.vp.includes('old') ? 'old' : 'new'].hub;
  await s.page.locator('[data-testid^="req-card-"]', { hasText: '最高优先级的卡' }).first().click();
  await s.page.locator(tid('req-edit-priority-high')).first().waitFor({ timeout: 10000 });
  await s.page.waitForTimeout(300);
  const opts = await s.page.evaluate(() => ['high', 'normal', 'low', 'lowest'].map(p => { const e = [...document.querySelectorAll(`[data-testid="req-edit-priority-${p}"]`)].find(x => x.getBoundingClientRect().width > 0); if (!e) return null; const t = e.querySelector('div:last-child'); return { text: e.textContent, clipped: t ? t.scrollWidth > t.clientWidth + 0.5 : true, right: e.getBoundingClientRect().right }; }));
  await shot(s.page, `detail-${s.vp.replace(/\W+/g, '-')}`);
  const shown = opts.filter(Boolean);
  if (expectLowest) {
    await s.page.locator(tid('req-edit-priority-lowest')).first().click();
    await s.page.locator(tid('req-edit-save')).first().click();
    await s.page.waitForTimeout(800);
  }
  record(s.vp, `detail: edit picker offers ${expectLowest ? 'four; P0 → P3 saves lowest' : 'P0–P2 only'}`, {
    options: shown.length === (expectLowest ? 4 : 3), unclipped: shown.every(o => !o.clipped), inView: shown.every(o => o.right <= s.w + 0.5),
    saved: !expectLowest || hub.rows.find(r => r.id === 'r_p0')?.priority === 'lowest',
  }, { opts: shown.map(o => o.text).join('|') });
}

async function checkList(s) {
  await s.page.locator(tid('tasks-view-list')).first().click();
  await s.page.locator('[data-testid^="req-row-"]').first().waitFor({ timeout: 10000 });
  await s.page.locator(tid('req-sort-priority')).first().click();
  await s.page.waitForTimeout(300);
  const order = () => s.page.evaluate(() => [...document.querySelectorAll('[data-testid^="req-row-r_p"]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.dataset.testid.replace('req-row-', '')));
  const asc = await order();
  const cell = await s.page.evaluate(() => { const c = document.querySelector('[data-testid="task-cell-r_p3-priority"]'); const b = c?.querySelector('[data-testid="task-prio-badge"]'); const row = document.querySelector('[data-testid="req-row-r_p3"]'); if (!b || !row) return null; const bb = b.getBoundingClientRect(); const cb = c.getBoundingClientRect(); return { text: b.textContent, dy: (bb.y + bb.height / 2) - (cb.y + cb.height / 2) }; });
  await shot(s.page, `list-${s.vp.replace(/\W+/g, '-')}`);
  await s.page.locator(tid('req-sort-priority')).first().click();
  await s.page.waitForTimeout(300);
  const desc = await order();
  record(s.vp, 'list: 优先级 cell is the badge (centred ±1px); sort P0→P3, then P3→P0', {
    asc: asc.join() === 'r_p0,r_p1,r_p2,r_p3', desc: desc.join() === 'r_p3,r_p2,r_p1,r_p0', badge: cell?.text === 'P3', centred: !!cell && Math.abs(cell.dy) <= 1,
  }, { asc: asc.join(), desc: desc.join(), cell: JSON.stringify(cell) });
  await s.page.locator(tid('tasks-view-board')).first().click();
  await s.page.waitForTimeout(300);
}

for (const kind of ['desktop', 'phone']) {
  for (const hubKind of ['new', 'old']) {
    const lowest = hubKind === 'new';
    let s = await open(kind, hubKind);
    await shot(s.page, `board-${kind}-${hubKind}`);
    await checkBadges(s);
    await checkFilter(s, lowest);
    if (kind === 'desktop' && lowest) await checkList(s);
    await checkCreate(s, lowest);
    await s.ctx.close();
    s = await open(kind, hubKind);
    await checkDetail(s, lowest);
    record(s.vp, 'no page errors', { none: s.errors.length === 0 }, { errors: s.errors.slice(0, 3).join(' / ') });
    await s.ctx.close();
  }
}

await browser.close();
web.close();
for (const h of Object.values(hubs)) h.server.close();
console.log('\n| viewport | check | ok | failed |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.vp} | ${r.what} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.failed} |`);
console.log(`\n${rows.length - failures}/${rows.length} rows passed`);
process.exit(failures ? 1 : 0);
