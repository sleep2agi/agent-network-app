// 会话列表「全部 / 未读 N」(board #449,照飞书「消息 / 未读 52」;「标记」暂缓)。
// No hub: an in-page Tauri stub answers every request with placeholder data (12 agents in 3 teams, 3 of them
// with unread; 2 people, 1 with an unread DM). Acks clear that agent's unread in the stub. Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-conversation-unread-tab/run.mjs
//
// For desktop 1440×900 and phone 390×844, light and dark:
//   1  the control is there: 「全部」 + 「未读 4」 (4 = conversations with unread: 3 agents + 1 person — not messages)
//   2  geometry: below the search box, above the first list row; its left edge = the first row's avatar left edge (±1 px);
//      the two segments share one vertical centre; the label text is painted
//   3  未读 → only the 3 unread agents (+ the unread person); 全部 → all 12 again
//   4  open an unread conversation from the 未读 view: it stays in the list while it is open (desktop), and is gone after
//      leaving it (desktop: open another; phone: back); N drops by one
//   5  reload → 未读 is still selected (per device)
// Exit 1 when any assertion fails. Run it against the pre-change export first: it must go red.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveExport, findChromium, ANDROID_UA, paintedText } from '../test-layout-sweep/harness.mjs';

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

const UNREAD = ['示例牛2号', '示例猫1号', '示例马3号'];

const initScript = ({ theme, unread }) => {
  const HUB = 'http://mock-hub.invalid';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const teams = ['示例牛', '示例猫', '示例马'];
  const sessions = Array.from({ length: 12 }, (_, i) => ({ alias: `${teams[i % 3]}${Math.floor(i / 3) + 1}号`, status: i % 5 ? 'idle' : 'offline', agent: 'claude-code', node_id: `n_tab_${i}`, updated_at: iso(5 + i) }));
  const humans = [{ user_id: 'u_tester', username: 'tester' }, { user_id: 'u_1', username: 'chuqi' }, { user_id: 'u_2', username: 'chengshi' }];
  const threads = [{ other_user_id: 'u_2', last_at: iso(3), unread: 2 }];
  const counts = Object.fromEntries(unread.map((a, i) => [a, [3, 12, 1][i] ?? 1]));
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-tab', displayName: 'tester', networkId: 'net-tab' };
  const decode = (data) => {
    try {
      if (!data) return {};
      const bytes = Array.isArray(data) ? new Uint8Array(data) : data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return {}; }
  };
  const route = (url, method, data) => {
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/api/messages/ack' && method === 'POST') {
      const body = decode(data);
      if (body.agent) delete counts[body.agent];
      return { ok: true, scope: 'agent', acked: 1 };
    }
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-tab', networks: [{ network_id: 'net-tab', member_role: 'member', agent_access: 'all' }] };
    if (p === '/api/networks/net-tab/humans') return { ok: true, humans };
    if (p === '/api/dm/threads') return { ok: true, threads };
    if (p === '/api/status') return { ok: true, sessions };
    if (p === '/api/nodes') return { ok: true, nodes: sessions.map(s => ({ node_id: s.node_id, alias: s.alias })), count: sessions.length };
    if (p === '/api/messages') {
      const total = Object.values(counts).reduce((n, c) => n + c, 0);
      return { ok: true, messages: [], unread: total, pending_count: total, unread_by_agent: { ...counts } };
    }
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
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return 0;
        case 'plugin:http|fetch': { const id = ++rid; reqs.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = reqs.get(args.rid);
          const body = route(c.url, String(c.method || 'GET').toUpperCase(), c.data);
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

// Avatar left edge of a row = left of its first child (the avatar wrap) — the edge the control must line up with.
const avatarLeft = (page, alias) => page.evaluate((a) => {
  const row = document.querySelector(`[data-testid="agent-row-${a}"]`);
  const av = row?.firstElementChild;
  const r = av?.getBoundingClientRect();
  return r ? Math.round(r.left * 10) / 10 : null;
}, alias);
// A missing control must read as a failed check, not abort the run (the pre-change export has no tabs).
const tap = (page, sel) => page.locator(sel).first().click({ timeout: 5000 }).then(() => true, () => false);
const agentRows = async (page) => (await page.locator('[data-testid^="agent-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').slice('agent-row-'.length))));

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
async function run(vp, viewport, ua, theme, phone) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript((th) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme_mode_v1', th); localStorage.setItem('anet.language.v1', 'zh'); localStorage.removeItem('agent_list_collapsed_v1'); localStorage.removeItem('agent_list_tab_v1'); sessionStorage.setItem('seeded', '1'); } } catch {} }, theme);
  await page.addInitScript(initScript, { theme, unread: UNREAD });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid^="agent-row-"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const tag = `${vp}-${theme}`;

  // 1 control + N
  const tabs = await box(page, tid('conversation-tabs'));
  const all = await box(page, tid('conversation-tab-all'));
  const un = await box(page, tid('conversation-tab-unread'));
  const nText = await page.locator(tid('conversation-tab-unread-count')).innerText().catch(() => '');
  const nPaint = await paintedText(page, tid('conversation-tab-unread-count'), '4').catch(() => null);
  const allPaint = await paintedText(page, tid('conversation-tab-all'), '全部').catch(() => null);
  await page.screenshot({ path: join(OUT, `${tag}-1-all.png`) });
  record(tag, '1 「全部」+「未读 4」(4 = conversations with unread, not messages)', {
    control: !!tabs, twoTabs: !!all && !!un, n: nText.trim() === '4', nPainted: !!nPaint?.painted, allPainted: !!allPaint?.painted,
    noMarked: (await page.locator(tid('conversation-tab-marked')).count()) === 0,
  }, { nText, nPaint, allPaint });

  // 2 geometry
  const firstAgent = (await agentRows(page))[0];
  const firstRow = firstAgent ? await box(page, tid(`agent-row-${firstAgent}`)) : null;
  const avL = firstAgent ? await avatarLeft(page, firstAgent) : null;
  const search = await box(page, 'input[placeholder*="搜索"]');
  const people = await box(page, tid('people-header'));
  const listTop = Math.min(...[firstRow?.y, people?.y].filter(v => typeof v === 'number'));
  const midA = all ? all.y + all.h / 2 : null, midU = un ? un.y + un.h / 2 : null;
  record(tag, '2 geometry: under search, above the list, left edge = row avatar left, segments share one centre', {
    belowSearch: !search || (!!tabs && tabs.y >= search.b - 0.5),
    aboveList: !!tabs && Number.isFinite(listTop) && tabs.b <= listTop + 0.5,
    leftAligned: !!tabs && avL !== null && Math.abs(tabs.x - avL) <= 1,
    sameCentre: midA !== null && midU !== null && Math.abs(midA - midU) <= 0.5,
    insideTrack: !!tabs && !!all && !!un && all.x >= tabs.x && un.r <= tabs.r && all.y >= tabs.y && all.b <= tabs.b,
    tapTarget: !!all && all.h >= 28,
  }, { tabs, all, un, avatarLeft: avL, firstRow, search, listTop, dx: tabs && avL !== null ? r1(tabs.x - avL) : null });

  // 3 未读 → only unread; 全部 → all
  await tap(page, tid('conversation-tab-unread')); await sleep(600);
  const unreadRows = await agentRows(page);
  const personRows = await page.locator('[data-testid^="person-row-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  const selected = await page.locator(tid('conversation-tab-unread')).getAttribute('aria-selected', { timeout: 5000 }).catch(() => null);
  await page.screenshot({ path: join(OUT, `${tag}-2-unread.png`) });
  record(tag, '3 未读 → only the unread conversations', {
    agents: unreadRows.length === 3 && UNREAD.every(a => unreadRows.includes(a)),
    person: personRows.length === 1 && personRows[0] === 'person-row-chengshi',
    selectedState: selected === 'true',
  }, { unreadRows, personRows, selected });
  await tap(page, tid('conversation-tab-all')); await sleep(600);
  record(tag, '3 全部 → all 12 again', { agents: (await agentRows(page)).length === 12 }, { n: (await agentRows(page)).length });

  // 4 read one from the 未读 view
  await tap(page, tid('conversation-tab-unread')); await sleep(600);
  const target = UNREAD[0];
  await tap(page, tid(`agent-row-${target}`));
  await sleep(2500);
  if (!phone) {
    const whileOpen = await agentRows(page);
    const nOpen = (await page.locator(tid('conversation-tab-unread-count')).innerText().catch(() => '')).trim();
    await page.screenshot({ path: join(OUT, `${tag}-3-open.png`) });
    record(tag, '4 desktop: the opened (now read) conversation stays in 未读 while it is open; N drops', {
      stays: whileOpen.includes(target), n: nOpen === '3',
    }, { whileOpen, nOpen });
    await tap(page, tid(`agent-row-${UNREAD[1]}`));
    await sleep(2500);
  } else {
    await tap(page, tid('chat-header-back'));
    await sleep(1500);
  }
  const after = await agentRows(page);
  const nAfter = (await page.locator(tid('conversation-tab-unread-count')).innerText().catch(() => '')).trim();
  await page.screenshot({ path: join(OUT, `${tag}-4-left.png`) });
  record(tag, '4 after leaving it, it is gone from 未读', {
    gone: !after.includes(target), othersStay: UNREAD.slice(2).every(a => after.includes(a)),
    n: phone ? nAfter === '3' : ['2', '3'].includes(nAfter),
  }, { after, nAfter });

  // 5 persisted per device
  await page.reload();
  await page.locator(tid('conversation-tabs')).waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(1500);
  record(tag, '5 reload → 未读 still selected', { selected: (await page.locator(tid('conversation-tab-unread')).getAttribute('aria-selected', { timeout: 5000 }).catch(() => null)) === 'true' });
  await ctx.close();
}

for (const theme of ['light', 'dark']) {
  await run('desktop-1440x900', { width: 1440, height: 900 }, MAC_UA, theme, false);
  await run('phone-390x844', { width: 390, height: 844 }, ANDROID_UA, theme, true);
}
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
