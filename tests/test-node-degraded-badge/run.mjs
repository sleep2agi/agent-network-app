// 节点「降级」徽标(board #460)。No hub: an in-page Tauri stub answers every request with placeholder data
// (12 agents; 2 degraded: one with App Server down, one needing a re-login). The list reads ?light=1 with the Hub's
// `degraded` field; node detail reads the full projection in the Hub .84/.85 shape (health + age, no `degraded`), so
// both data paths are exercised. Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo export dir> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-node-degraded-badge/run.mjs
//
// For desktop 1440×900 and phone 390×844, light and dark:
//   1  exactly the 2 degraded rows carry 「降级 · <reason>」 (painted); healthy rows carry nothing
//   2  geometry: the badge sits on the name line (vertical centres within 1 px), right of the name, left of the time,
//      inside the row
//   3  hover (desktop) / tap (phone) shows the tip with every failing layer, and the tip is on top (elementFromPoint)
//   4  node detail (row menu → 节点详情) shows the badge in the header, computed from `health`
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
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox({ timeout: 3000 }).catch(() => null); return b && { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height), r: r1(b.x + b.width), b: r1(b.y + b.height) }; };

const DEGRADED = {
  '示例牛2号': {
    layers: [{ layer: 'app_server', label: 'App Server 断开', reason: 'connect ECONNREFUSED' }],
    health: { bridge: 'ok', app_server: { ok: false, rtt_ms: null, last_error: 'connect ECONNREFUSED' }, model_auth: 'ok' },
  },
  '示例猫1号': {
    layers: [{ layer: 'tui', label: 'TUI 已退出', reason: 'pane-dead' }, { layer: 'model_auth', label: '需要重新登录', reason: 'revoked' }],
    health: { bridge: 'ok', tui: { ok: false, reason: 'pane-dead' }, model_auth: 'revoked' },
  },
};

const initScript = ({ theme, degraded }) => {
  const HUB = 'http://mock-hub.invalid';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const teams = ['示例牛', '示例猫', '示例马'];
  const sessions = Array.from({ length: 12 }, (_, i) => ({ alias: `${teams[i % 3]}${Math.floor(i / 3) + 1}号`, status: i % 5 ? 'idle' : 'offline', agent: 'claude-code', node_id: `n_deg_${i}`, updated_at: iso(5 + i) }));
  const humans = [{ user_id: 'u_tester', username: 'tester' }, { user_id: 'u_1', username: 'chuqi' }, { user_id: 'u_2', username: 'chengshi' }];
  const threads = [];
  const counts = {};
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-deg', displayName: 'tester', networkId: 'net-deg' };
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
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-deg', networks: [{ network_id: 'net-deg', member_role: 'member', agent_access: 'all' }] };
    if (p === '/api/networks/net-deg/humans') return { ok: true, humans };
    if (p === '/api/dm/threads') return { ok: true, threads };
    if (p === '/api/status') {
      // ?light=1 (the list): Hub ≥ #460 carries `degraded` only on degraded rows.
      // Full projection for one alias (node detail): Hub .84/.85 shape — `health` + age, no `degraded` (the app computes it).
      if (u.searchParams.get('light') === '1') return { ok: true, sessions: sessions.map(s => degraded[s.alias] ? { ...s, degraded: degraded[s.alias].layers } : s) };
      const one = u.searchParams.get('alias');
      const rows = one ? sessions.filter(s => s.alias === one) : sessions;
      return { ok: true, sessions: rows.map(s => ({ ...s, health: degraded[s.alias]?.health ?? null, health_observed_ms_ago: degraded[s.alias] ? 20_000 : null })) };
    }
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

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
async function run(vp, viewport, ua, theme, phone) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message.split('\n')[0]));
  await page.addInitScript((th) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme_mode_v1', th); localStorage.setItem('anet.language.v1', 'zh'); localStorage.removeItem('agent_list_collapsed_v1'); sessionStorage.setItem('seeded', '1'); } } catch {} }, theme);
  await page.addInitScript(initScript, { theme, degraded: DEGRADED });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator('[data-testid^="agent-row-"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const tag = `${vp}-${theme}`;

  // 1 which rows
  const badges = await page.locator('[data-testid^="agent-degraded-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').slice('agent-degraded-'.length)));
  const ox = await page.locator(tid('agent-degraded-示例牛2号')).innerText({ timeout: 3000 }).catch(() => '');
  const cat = await page.locator(tid('agent-degraded-示例猫1号')).innerText({ timeout: 3000 }).catch(() => '');
  const paint = await paintedText(page, tid('agent-degraded-示例牛2号'), '降级 · App Server 断开').catch(() => null);
  await page.screenshot({ path: join(OUT, `${tag}-1-list.png`) });
  record(tag, '1 exactly the degraded rows carry 「降级 · <reason>」', {
    two: badges.length === 2 && Object.keys(DEGRADED).every(a => badges.includes(a)),
    textOx: ox.trim() === '降级 · App Server 断开', textCat: cat.trim() === '降级 · TUI 已退出', painted: !!paint?.painted,
  }, { badges, ox, cat, paint });

  // 2 geometry on the name line
  const alias = '示例牛2号';
  const g = await page.evaluate((a) => {
    const row = document.querySelector(`[data-testid="agent-row-${a}"]`);
    const badge = document.querySelector(`[data-testid="agent-degraded-${a}"]`);
    if (!row || !badge) return null;
    const rb = row.getBoundingClientRect(); const bb = badge.getBoundingClientRect();
    // the name text node: the first element inside the row whose own text is exactly the alias
    const name = [...row.querySelectorAll('*')].find(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.includes(a)));
    const nb = name?.getBoundingClientRect();
    const time = [...row.querySelectorAll('*')].find(e => e !== name && /^(\d{1,2}:\d{2}|昨天|刚刚|\d+ ?分钟前|.*月.*日)$/.test((e.textContent || '').trim()) && e.children.length === 0);
    const tb = time?.getBoundingClientRect();
    const r = (x) => Math.round(x * 10) / 10;
    return { row: { l: r(rb.left), r: r(rb.right), t: r(rb.top), b: r(rb.bottom) }, badge: { l: r(bb.left), r: r(bb.right), cy: r((bb.top + bb.bottom) / 2), h: r(bb.height) }, name: nb && { r: r(nb.right), cy: r((nb.top + nb.bottom) / 2) }, time: tb && { l: r(tb.left) } };
  }, alias);
  record(tag, '2 badge on the name line: centred with the name, right of it, left of the time, inside the row', {
    measured: !!g && !!g.name,
    sameLine: !!g?.name && Math.abs(g.badge.cy - g.name.cy) <= 1,
    rightOfName: !!g?.name && g.badge.l >= g.name.r - 0.5,
    leftOfTime: !g?.time || g.badge.r <= g.time.l + 0.5,
    insideRow: !!g && g.badge.l >= g.row.l && g.badge.r <= g.row.r,
  }, { g });

  // 3 tip
  // phone: a tap (click; this context has no touch emulation); desktop: hover only.
  if (phone) await page.locator(tid(`agent-degraded-${alias}`)).click({ timeout: 3000 }).catch(() => {});
  else await page.locator(tid(`agent-degraded-${alias}`)).hover({ timeout: 3000 }).catch(() => {});
  await sleep(400);
  const tipText = await page.locator(tid(`agent-degraded-${alias}-tip`)).innerText({ timeout: 3000 }).catch(() => '');
  const tipBox = await box(page, tid(`agent-degraded-${alias}-tip`));
  // The tip is pointer-events:none (it must not eat the hover), so elementFromPoint skips it: lift that for the probe.
  const onTop = tipBox ? await page.evaluate(([sel, x, y]) => { const t = document.querySelector(sel); if (!t) return false; const st = document.createElement('style'); st.textContent = `${sel}, ${sel} * { pointer-events: auto !important; }`; document.head.appendChild(st); const hit = document.elementFromPoint(x, y); st.remove(); return !!hit && t.contains(hit); }, [tid(`agent-degraded-${alias}-tip`), tipBox.x + tipBox.w / 2, tipBox.y + tipBox.h / 2]) : false;
  // Not clipped by the list pane: the tip lies inside the row's horizontal extent.
  const rowBox = await box(page, tid(`agent-row-${alias}`));
  await page.screenshot({ path: join(OUT, `${tag}-2-tip.png`) });
  record(tag, '3 hover / tap shows the reason tip, on top', {
    text: tipText.includes('App Server 断开') && tipText.includes('重启'), visible: !!tipBox && tipBox.w > 40, onTop,
    notClipped: !!tipBox && !!rowBox && tipBox.x >= rowBox.x - 0.5 && tipBox.r <= rowBox.r + 0.5,
  }, { tipText, tipBox, rowBox });
  await page.mouse.move(2, viewport.height - 2);

  // 4 node detail via the row menu (computed from `health`)
  const target = '示例猫1号';
  await page.locator(tid(`agent-row-${target}`)).click({ button: 'right', timeout: 3000 }).catch(() => {});
  await sleep(400);
  await page.locator(tid('agent-row-menu-detail')).click({ timeout: 3000 }).catch(() => {});
  await sleep(2000);
  const hdr = await page.locator(tid('node-degraded')).innerText({ timeout: 5000 }).catch(() => '');
  const hdrLabel = await page.locator(tid('node-degraded')).getAttribute('aria-label', { timeout: 3000 }).catch(() => null);
  await page.screenshot({ path: join(OUT, `${tag}-3-detail.png`) });
  record(tag, '4 node detail header shows the badge (from health)', {
    text: hdr.trim() === '降级 · TUI 已退出', fullLabel: (hdrLabel ?? '').includes('需要重新登录'),
  }, { hdr, hdrLabel });
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
