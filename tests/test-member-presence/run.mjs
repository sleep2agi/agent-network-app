// 人员的在线点 +「x 分钟前在线」(Vincent 2026-09-30「要展示对方在不在线」)。
// Not in CI: needs Playwright + Chromium and a web export. No hub: an in-page Tauri stub answers every request
// with placeholder data (12 agents, 3 people). Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-member-presence/run.mjs
//
// For 1320×754 (desktop) and 390×844 (phone), against a hub that returns online / last_seen_at:
//   1  every person has a dot; online = the agent online dot's colour, offline = the agent offline dot's colour
//   2  the dot sits on the avatar exactly where the agent dot sits on the agent avatar (same size, same corner offset,
//      same page x column, ±0.5 px)
//   3  subtitle: offline 5 min → 「5 分钟前在线」; online → no 「在线」 text; offline with unknown last_seen → no subtitle
//   4  a member_presence event on the user stream flips a dot live (no refetch)
// and against an old hub (no online field):
//   5  no dot and no 「在线」 text anywhere in the people rows (no fake grey)
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

const initScript = ({ withPresence }) => {
  const HUB = 'http://mock-hub.invalid';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const sessions = Array.from({ length: 12 }, (_, i) => ({ alias: `示例-${i + 1}`, status: i % 3 ? 'idle' : 'offline', agent: 'claude-code', node_id: `n_pres_${i}`, updated_at: iso(5 + i) }));
  const presence = withPresence
    ? { 'u_on': { online: true, last_seen_at: iso(0) }, 'u_off': { online: false, last_seen_at: iso(5.2) }, 'u_unk': { online: false, last_seen_at: null } }
    : {};
  const humans = [
    { user_id: 'u_tester', username: 'tester' },
    { user_id: 'u_on', username: 'person-on', ...presence.u_on },
    { user_id: 'u_off', username: 'person-off', ...presence.u_off },
    { user_id: 'u_unk', username: 'person-unk', ...presence.u_unk },
  ];
  const profile = { serverUrl: HUB, token: 'utok_placeholder', username: 'tester', profileId: 'p-presence', displayName: 'tester', networkId: 'net-presence' };
  const route = (url) => {
    const p = new URL(url).pathname;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-presence', networks: [{ network_id: 'net-presence', member_role: 'member', agent_access: 'all' }] };
    if (p === '/api/networks/net-presence/humans') return { ok: true, humans };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') return { ok: true, sessions };
    if (p === '/api/nodes') return { ok: true, nodes: sessions.map(s => ({ node_id: s.node_id, alias: s.alias })), count: sessions.length };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0 };
    if (p.startsWith('/api/events') || p.startsWith('/events')) return null;
    return { ok: true };
  };
  // 用户流:记下 listen 的回调和 start_user_event_stream 的 streamId,测试里用 __pushUserEvent 模拟 hub 推送。
  const eventHandlers = new Map();
  const userStreams = [];
  window.__pushUserEvent = (event) => {
    const h = eventHandlers.get('user-event-stream');
    if (!h) return 0;
    for (const streamId of userStreams) window[`_${h}`]({ event: 'user-event-stream', id: 1, payload: { kind: 'event', stream_id: streamId, event } });
    return userStreams.length;
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
        case 'plugin:event|listen': eventHandlers.set(args.event, args.handler); return eventHandlers.size;
        case 'start_user_event_stream': userStreams.push(args.streamId); return null;
        case 'stop_user_event_stream': { const i = userStreams.indexOf(args.streamId); if (i >= 0) userStreams.splice(i, 1); return null; }
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

/** 点相对它所在头像的几何:大小 + 右 / 下两边到头像边的距离 + 背景色。 */
const dotGeom = (page, dotSel) => page.evaluate((sel) => {
  const dot = document.querySelector(sel);
  if (!dot) return null;
  const avatar = dot.parentElement;
  const d = dot.getBoundingClientRect(), a = avatar.getBoundingClientRect();
  const r = (n) => Math.round(n * 10) / 10;
  return { x: r(d.left), w: r(d.width), h: r(d.height), right: r(a.right - d.right), bottom: r(a.bottom - d.bottom), avatarW: r(a.width), bg: getComputedStyle(dot).backgroundColor, opacity: getComputedStyle(dot).opacity };
}, dotSel);

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
async function open(vp, viewport, ua, withPresence) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript(() => { try { localStorage.setItem('theme_mode_v1', 'light'); localStorage.setItem('anet.language.v1', 'zh'); localStorage.removeItem('agent_list_collapsed_v1'); } catch {} });
  await page.addInitScript(initScript, { withPresence });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid^="person-row-"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(800);
  return { ctx, page };
}

async function run(vp, viewport, ua) {
  const { ctx, page } = await open(vp, viewport, ua, true);
  const on = await dotGeom(page, tid('person-dot-person-on'));
  const off = await dotGeom(page, tid('person-dot-person-off'));
  const unk = await dotGeom(page, tid('person-dot-person-unk'));
  const agentOn = await dotGeom(page, tid('agent-dot-示例-2'));   // idle → online
  const agentOff = await dotGeom(page, tid('agent-dot-示例-1'));  // offline
  record(vp, '1 every person has a dot; online / offline colours = the agent dot colours', {
    present: !!on && !!off && !!unk,
    onColour: !!on && !!agentOn && on.bg === agentOn.bg && on.opacity === agentOn.opacity,
    offColour: !!off && !!agentOff && off.bg === agentOff.bg && off.opacity === agentOff.opacity,
    unkIsOffline: !!unk && !!off && unk.bg === off.bg,
  }, { on, off, agentOn, agentOff });
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  record(vp, '2 dot sits on the avatar where the agent dot sits on the agent avatar', {
    avatar: !!on && !!agentOn && near(on.avatarW, agentOn.avatarW),
    size: !!on && !!agentOn && near(on.w, agentOn.w) && near(on.h, agentOn.h),
    right: !!on && !!agentOn && near(on.right, agentOn.right),
    bottom: !!on && !!agentOn && near(on.bottom, agentOn.bottom),
    sameColumn: !!on && !!agentOn && near(on.x, agentOn.x),
  }, { person: on && { x: on.x, w: on.w, h: on.h, right: on.right, bottom: on.bottom, avatarW: on.avatarW }, agent: agentOn && { x: agentOn.x, w: agentOn.w, h: agentOn.h, right: agentOn.right, bottom: agentOn.bottom, avatarW: agentOn.avatarW } });
  const text = async (username) => (await page.locator(tid(`person-row-${username}`)).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const tOn = await text('person-on'), tOff = await text('person-off'), tUnk = await text('person-unk');
  record(vp, '3 subtitle: 「5 分钟前在线」 when offline; nothing when online or unknown', {
    off: tOff.includes('5 分钟前在线'),
    on: !tOn.includes('在线'),
    unk: !tUnk.includes('在线'),
  }, { tOn, tOff, tUnk });
  await page.screenshot({ path: join(OUT, `${vp}-1-presence.png`) });
  const rowsBox = await page.locator(tid('people-section')).boundingBox().catch(() => null);
  if (rowsBox) await page.screenshot({ path: join(OUT, `${vp}-1-presence-crop.png`), clip: { x: Math.max(0, rowsBox.x - 8), y: Math.max(0, rowsBox.y - 8), width: Math.min(viewport.width, rowsBox.width + 16), height: rowsBox.height + 16 } });

  // 4 live: person-on goes offline, person-unk comes online — via the user stream, no refetch.
  const pushed = await page.evaluate((at) => window.__pushUserEvent({ type: 'member_presence', member_user_id: 'u_on', online: false, last_seen_at: at, user_id: 'u_tester', network_id: 'net-presence', scope: 'user' })
    + window.__pushUserEvent({ type: 'member_presence', member_user_id: 'u_unk', online: true, last_seen_at: at, user_id: 'u_tester', network_id: 'net-presence', scope: 'user' }), new Date().toISOString());
  await sleep(400);
  const on2 = await dotGeom(page, tid('person-dot-person-on'));
  const unk2 = await dotGeom(page, tid('person-dot-person-unk'));
  record(vp, '4 member_presence flips the dots live', {
    pushed: pushed >= 2,
    onNowOffline: !!on2 && !!agentOff && on2.bg === agentOff.bg,
    unkNowOnline: !!unk2 && !!agentOn && unk2.bg === agentOn.bg,
    justNow: (await text('person-on')).includes('刚刚在线'),
  }, { pushed, on2: on2?.bg, unk2: unk2?.bg });
  await page.screenshot({ path: join(OUT, `${vp}-2-live.png`) });
  await ctx.close();

  // 5 old hub
  const old = await open(vp, viewport, ua, false);
  const dots = await old.page.locator('[data-testid^="person-dot-"]').count();
  const rows = await old.page.locator('[data-testid^="person-row-"]').allInnerTexts();
  record(vp, '5 old hub (no online field): no dot, no 「在线」 text', {
    rows: rows.length === 3,
    noDot: dots === 0,
    noText: !rows.some(r => r.includes('在线')),
  }, { dots, rows: rows.map(r => r.replace(/\s+/g, ' ')) });
  await old.page.screenshot({ path: join(OUT, `${vp}-3-old-hub.png`) });
  await old.ctx.close();
}

await run('desktop-1320x754', { width: 1320, height: 754 }, MAC_UA);
await run('phone-390x844', { width: 390, height: 844 }, ANDROID_UA);
await browser.close();
web.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
