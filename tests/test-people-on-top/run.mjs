// 「人员」区块在会话 / agent 列表最上面(Vincent 2026-09-30「这个人员放太下面了」:304 个 agent 时它沉在最底)。
// Not in CI: needs Playwright + Chromium and a web export. No hub: an in-page Tauri stub answers every request
// with placeholder data (40 agents in 3 teams, 3 people). Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-people-on-top/run.mjs
//
// For 1320×754 (desktop) and 390×844 (phone):
//   1  人员 is the first section: its header sits right under the search box and above every agent group header
//   2  header shows the count (3); people rows share the agent rows' left edge / width
//   3  tap the header → folds (rows gone, count stays); reload → still folded (per-device); tap → unfolds
//   4  typing in the search box filters people too (「cheng」 → only chengshi)
// Exit 1 when any assertion fails. Run it against the pre-change export first: it must go red.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA } from '../test-layout-sweep/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WEB_DIR: WEB, OUT } = process.env;
if (!WEB || !OUT) throw new Error('need WEB_DIR OUT');
mkdirSync(OUT, { recursive: true });
const web = await serveExport(WEB);
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const tid = (id) => `[data-testid="${id}"]`;
const r1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const record = (vp, what, checks, detail = {}) => {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...detail }));
};
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox().catch(() => null); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height) }; };

const initScript = () => {
  const HUB = 'http://mock-hub.invalid';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const teams = ['示例牛', '示例猫', '示例马'];
  const sessions = Array.from({ length: 40 }, (_, i) => ({ alias: `${teams[i % 3]}${Math.floor(i / 3) + 1}号`, status: i % 4 ? 'idle' : 'offline', agent: 'claude-code', node_id: `n_people_${i}`, updated_at: iso(5 + i) }));
  const humans = [{ user_id: 'u_tester', username: 'tester' }, { user_id: 'u_1', username: 'chuqi' }, { user_id: 'u_2', username: 'chengshi' }, { user_id: 'u_3', username: 'vansin' }];
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-people', displayName: 'tester', networkId: 'net-people' };
  const route = (url) => {
    const p = new URL(url).pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-people', networks: [{ network_id: 'net-people', member_role: 'member', agent_access: 'all' }] };
    if (p === '/api/networks/net-people/humans') return { ok: true, humans };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions };
    if (p === '/api/nodes') return { ok: true, nodes: sessions.map(s => ({ node_id: s.node_id, alias: s.alias })), count: sessions.length };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0 };
    if (p.startsWith('/api/events') || p.startsWith('/events')) return null;
    return { ok: true };
  };
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
        case 'get_theme_preference': return 'light';
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const body = route(c.url);
          const buf = new TextEncoder().encode(body === null ? '{"ok":false}' : JSON.stringify(body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: body === null ? 404 : 200, statusText: 'OK', url: c.url, headers: [['content-type', 'application/json']], rid: id };
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

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
async function run(vp, viewport, ua) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); localStorage.removeItem('agent_list_collapsed_v1'); sessionStorage.setItem('seeded', '1'); } } catch {} });
  await page.addInitScript(initScript);
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator(tid('people-section')).waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(800);

  const measure = async () => {
    const people = await box(page, tid('people-header'));
    const groups = [];
    for (const loc of await page.locator('[data-testid^="agent-group-"]').all()) {
      const id = await loc.getAttribute('data-testid');
      if (!/^agent-group-示例/.test(id ?? '') && !/^agent-group-/.test(id ?? '')) continue;
      const b = await loc.boundingBox(); if (b) groups.push({ id, y: r1(b.y) });
    }
    return { people, groups };
  };
  const search = page.getByPlaceholder(/搜索/).first();
  const searchBox = await box(page, 'input[placeholder*="搜索"]');
  const m = await measure();
  await page.screenshot({ path: join(OUT, `${vp}-1-top.png`) });
  const firstGroupY = m.groups.length ? Math.min(...m.groups.map(g => g.y)) : null;
  record(vp, '1 人员 is the first section: under the search box, above every agent group', {
    present: !!m.people,
    underSearch: !!m.people && !!searchBox && m.people.y >= searchBox.b - 0.5 && m.people.y - searchBox.b <= 60,
    aboveGroups: !!m.people && firstGroupY !== null && m.people.b <= firstGroupY + 0.5,
  }, { searchBottom: searchBox?.b, peopleY: m.people?.y, peopleBottom: m.people?.b, firstGroupY, groups: m.groups.length });
  const count = await page.locator(tid('people-count')).innerText().catch(() => '');
  const personRow = await box(page, '[data-testid^="person-row-"]');
  const agentRow = await box(page, '[data-testid^="agent-row-"]');
  record(vp, '2 header shows the count; people rows share the agent rows’ left edge and width', { count: count === '3', left: !!personRow && !!agentRow && Math.abs(personRow.x - agentRow.x) <= 1, width: !!personRow && !!agentRow && Math.abs(personRow.w - agentRow.w) <= 1 }, { count, personRow, agentRow });

  // 3 fold → reload → still folded → unfold
  await page.locator(tid('people-header')).click(); await sleep(400);
  const foldedRows = await page.locator('[data-testid^="person-row-"]').count();
  record(vp, '3 tap header → folded (rows gone, count stays)', { rows: foldedRows === 0, count: (await page.locator(tid('people-count')).innerText()) === '3' });
  await page.reload(); await page.locator(tid('people-header')).waitFor({ timeout: 30000 }); await sleep(800);
  record(vp, '3 reload → still folded (remembered on this device)', { rows: (await page.locator('[data-testid^="person-row-"]').count()) === 0 });
  await page.screenshot({ path: join(OUT, `${vp}-2-folded.png`) });
  await page.locator(tid('people-header')).click(); await sleep(400);
  record(vp, '3 tap again → unfolded', { rows: (await page.locator('[data-testid^="person-row-"]').count()) === 3 });

  // 4 search filters people
  await search.fill('cheng'); await sleep(600);
  const names = await page.locator('[data-testid^="person-row-"]').allInnerTexts();
  record(vp, '4 search filters people (cheng → chengshi only)', { one: names.length === 1 && names[0].includes('chengshi') }, { names });
  await page.screenshot({ path: join(OUT, `${vp}-3-search.png`) });
  await ctx.close();
}

await run('desktop-1320x754', { width: 1320, height: 754 }, MAC_UA);
await run('phone-390x844', { width: 390, height: 844 }, ANDROID_UA);
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
