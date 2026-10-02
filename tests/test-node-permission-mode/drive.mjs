// 节点页「权限」分区(board #489,Hub RFC-041 第一阶段)。No hub: an in-page Tauri stub answers every request with
// placeholder data. Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo web export> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-node-permission-mode/drive.mjs
//
// Three nodes, as GET /api/nodes describes them:
//   示例-主人   viewer_can.permission_mode = true   (the Hub says this user may change it)
//   示例-别人   viewer_can.permission_mode = false  (a member who is not the owner / admin)
//   示例-旧版   no viewer_can at all                (a Hub older than .93)
// For desktop 1440×900 (Tauri shell) and phone 390×844 (Android UA), light and dark:
//   1  示例-主人's node page has a 「权限」 section; 示例-别人 and 示例-旧版 don't (the Hub's answer, not a client rule)
//   2  the layout: desktop = one segmented row (3 segments, same height, centres within 1 px) + the selected option's
//      one-line description; phone = 3 stacked cards, each ≥ 64 px tall, inside the viewport (no horizontal overflow),
//      every description painted
//   3  picking 受限 sends PUT …/permission-mode {mode:"restricted"} once and shows it checked + 「已改为」
//   4  a failed PUT puts the old choice back and says why
//   5  the report row reads 「过去 7 天本来会拦下 7 次」 and opens into counts by reason and by action
// Exit 1 when any check fails. Run it against the pre-change export first: it must go red.
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

const initScript = ({ theme }) => {
  const HUB = 'http://mock-hub.invalid';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const sessions = [
    { alias: '示例-主人', status: 'idle', agent: 'claude-code', node_id: 'n_perm_own', updated_at: iso(3) },
    { alias: '示例-别人', status: 'idle', agent: 'claude-code', node_id: 'n_perm_other', updated_at: iso(4) },
    { alias: '示例-旧版', status: 'idle', agent: 'claude-code', node_id: 'n_perm_old', updated_at: iso(5) },
  ];
  const nodes = [
    { node_id: 'n_perm_own', alias: '示例-主人', permission_mode: 'normal', viewer_can: { permission_mode: true } },
    { node_id: 'n_perm_other', alias: '示例-别人', permission_mode: 'normal', viewer_can: { permission_mode: false } },
    { node_id: 'n_perm_old', alias: '示例-旧版' },
  ];
  const report = {
    ok: true, network_id: 'net-perm', since: iso(7 * 24 * 60), mode: 'log', total: 7,
    nodes: [{ node_id: 'n_perm_own', alias: '示例-主人', permission_mode: 'normal', total: 7, by_reason: { beyond_owner_visibility: 5, human_only: 2 },
      routes: [
        { route: 'PATCH /api/requirements/:id', reason: 'beyond_owner_visibility', hits: 4, sample: '#12' },
        { route: 'GET /api/requirements', reason: 'beyond_owner_visibility', hits: 1, sample: 'list' },
        { route: 'PUT /api/nodes/:id/attrs', reason: 'human_only', hits: 2, sample: 'n_perm_other' },
      ] }],
  };
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-perm', displayName: 'tester', networkId: 'net-perm' };
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
    const put = /^\/api\/nodes\/([^/]+)\/permission-mode$/.exec(p);
    if (put && method === 'PUT') {
      const body = decode(data);
      (window.__permPuts ||= []).push({ node: decodeURIComponent(put[1]), ...body });
      if (window.__permFail) return { __status: 403, ok: false, error: 'permission_denied' };
      const n = nodes.find(x => x.node_id === decodeURIComponent(put[1]));
      const previous = n?.permission_mode ?? 'normal';
      if (n) n.permission_mode = body.mode;
      return { ok: true, node_id: n?.node_id, permission_mode: body.mode, previous };
    }
    if (p === '/api/networks/net-perm/node-permission-report') return report;
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-perm', networks: [{ network_id: 'net-perm', member_role: 'owner', agent_access: 'all' }] };
    if (p === '/api/networks/net-perm/humans') return { ok: true, humans: [{ user_id: 'u_tester', username: 'tester' }] };
    if (p === '/api/dm/threads') return { ok: true, threads: [] };
    if (p === '/api/status') {
      const one = u.searchParams.get('alias');
      return { ok: true, sessions: one ? sessions.filter(s => s.alias === one) : sessions };
    }
    if (p === '/api/nodes') return { ok: true, nodes, count: nodes.length };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0, unread_by_agent: {} };
    if (p.startsWith('/api/events') || p.startsWith('/events')) return null;
    return { ok: true };
  };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ ||= { unregisterListener: () => {} };
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
          const status = body === null ? 404 : (body.__status ?? 200);
          if (body && body.__status) delete body.__status;
          const buf = new TextEncoder().encode(body === null ? '{"ok":false}' : JSON.stringify(body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status, statusText: 'OK', url: c.url, headers: [['content-type', 'application/json']], rid: id };
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

async function openNode(page, alias) {
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
  await page.locator(tid(`agent-row-${alias}`)).waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(800);
  await page.locator(tid(`agent-row-${alias}`)).click({ button: 'right', timeout: 3000 }).catch(() => {});
  await sleep(400);
  await page.locator(tid('agent-row-menu-detail')).click({ timeout: 3000 }).catch(() => {});
  await page.locator(tid('node-section-nav')).waitFor({ timeout: 10000 }).catch(() => {});
  await sleep(800);
}
// Tab text minus the icon font's private-use glyph (desktop rail rows carry an Ionicons glyph before the label).
const tabs = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="node-section-nav"] [role="tab"]')].map(t => (t.textContent || '').replace(/[\uE000-\uF8FF]/g, '').trim()));

async function run(vp, viewport, ua, theme, phone) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  await page.addInitScript((th) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme_mode_v1', th); localStorage.setItem('anet.language.v1', 'zh'); sessionStorage.setItem('seeded', '1'); } } catch {} }, theme);
  await page.addInitScript(initScript, { theme });
  const tag = `${vp}-${theme}`;

  // 1 who sees the section
  await openNode(page, '示例-别人');
  const otherTabs = await tabs(page);
  await openNode(page, '示例-旧版');
  const oldTabs = await tabs(page);
  await openNode(page, '示例-主人');
  const ownTabs = await tabs(page);
  record(tag, '1 「权限」 only where the Hub says viewer_can.permission_mode=true', {
    navLoaded: ownTabs.length > 3, own: ownTabs.includes('权限'), other: !otherTabs.includes('权限'), oldHub: !oldTabs.includes('权限'),
    beforeDanger: ownTabs.indexOf('权限') === ownTabs.indexOf('危险操作') - 1,
  }, { ownTabs, otherTabs, oldTabs });

  await page.locator(`${tid('node-section-nav')} [role="tab"]`, { hasText: '权限' }).first().click({ timeout: 3000 }).catch(() => {});
  await page.locator(tid('node-perm-section')).waitFor({ timeout: 5000 }).catch(() => {});
  await sleep(600);

  // 2 layout
  const geo = await page.evaluate(() => {
    const q = (s) => document.querySelector(`[data-testid="${s}"]`);
    const b = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cy: (r.top + r.bottom) / 2 }; };
    const opts = ['normal', 'readonly', 'restricted'].map(m => q(`node-perm-option-${m}`));
    return {
      segmented: !!q('node-perm-segmented'), cards: !!q('node-perm-cards'),
      opts: opts.map(o => o && { ...b(o), checked: o.getAttribute('aria-checked') }),
      docW: document.documentElement.scrollWidth, vw: window.innerWidth,
    };
  });
  const r = (o) => o && { l: r1(o.l), r: r1(o.r), h: r1(o.h), cy: r1(o.cy), checked: o.checked };
  const optsOk = geo.opts.every(Boolean);
  const descs = phone
    ? await Promise.all(['normal', 'readonly', 'restricted'].map(m => paintedText(page, tid(`node-perm-option-${m}-summary`)).catch(() => null)))
    : [await paintedText(page, tid('node-perm-summary')).catch(() => null)];
  const expectDesc = phone ? ['和你一样', '只看不动', '只管派给它的任务'] : ['和你一样'];
  const layoutChecks = phone ? {
    cards: geo.cards && !geo.segmented, three: optsOk,
    tall: optsOk && geo.opts.every(o => o.h >= 64), stacked: optsOk && geo.opts[0].b <= geo.opts[1].t + 0.5 && geo.opts[1].b <= geo.opts[2].t + 0.5,
    inViewport: optsOk && geo.opts.every(o => o.l >= 0 && o.r <= geo.vw + 0.5) && geo.docW <= geo.vw + 0.5,
    painted: descs.every((d, i) => d?.painted && String(d.text).startsWith(expectDesc[i])),
  } : {
    segmented: geo.segmented && !geo.cards, three: optsOk,
    oneRow: optsOk && Math.max(...geo.opts.map(o => o.cy)) - Math.min(...geo.opts.map(o => o.cy)) <= 1,
    sameHeight: optsOk && Math.max(...geo.opts.map(o => o.h)) - Math.min(...geo.opts.map(o => o.h)) <= 0.5,
    adjacent: optsOk && Math.abs(geo.opts[0].r - geo.opts[1].l) <= 1.5 && Math.abs(geo.opts[1].r - geo.opts[2].l) <= 1.5,
    painted: descs.every((d, i) => d?.painted && String(d.text).startsWith(expectDesc[i])),
  };
  record(tag, `2 layout (${phone ? 'phone cards' : 'desktop segmented'})`, { ...layoutChecks, normalChecked: geo.opts[0]?.checked === 'true' }, { opts: geo.opts.map(r), docW: geo.docW, vw: geo.vw });
  await page.screenshot({ path: join(OUT, `${tag}-1-section.png`) });

  // 3 pick 受限
  await page.evaluate(() => { window.__permPuts = []; window.__permFail = false; });
  await page.locator(tid('node-perm-option-restricted')).click({ timeout: 3000 }).catch(() => {});
  await sleep(700);
  const puts = await page.evaluate(() => window.__permPuts);
  const checked3 = await page.locator(tid('node-perm-option-restricted')).getAttribute('aria-checked').catch(() => null);
  const saved = await page.locator(tid('node-perm-saved')).innerText({ timeout: 2000 }).catch(() => '');
  record(tag, '3 picking 受限 sends one PUT and shows it', {
    onePut: puts.length === 1 && puts[0].mode === 'restricted' && puts[0].node === 'n_perm_own', checked: checked3 === 'true', saved: saved.includes('受限'),
  }, { puts, checked3, saved });

  // 4 failed PUT reverts
  await page.evaluate(() => { window.__permFail = true; });
  await page.locator(tid('node-perm-option-readonly')).click({ timeout: 3000 }).catch(() => {});
  await sleep(700);
  const err = await page.locator(tid('node-perm-error')).innerText({ timeout: 2000 }).catch(() => '');
  const back = await page.locator(tid('node-perm-option-restricted')).getAttribute('aria-checked').catch(() => null);
  const ro = await page.locator(tid('node-perm-option-readonly')).getAttribute('aria-checked').catch(() => null);
  record(tag, '4 a refused PUT puts the old choice back and says why', { error: err.includes('没有权限'), restored: back === 'true' && ro === 'false' }, { err, back, ro });
  await page.evaluate(() => { window.__permFail = false; });
  // back to 正常 (succeeds, clears the error) so the report screenshot shows the normal state
  await page.locator(tid('node-perm-option-normal')).click({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  const errGone = await page.locator(tid('node-perm-error')).count();
  const normalBack = await page.locator(tid('node-perm-option-normal')).getAttribute('aria-checked').catch(() => null);
  record(tag, '4b a later successful pick clears the error', { cleared: errGone === 0, normal: normalBack === 'true' }, { errGone, normalBack });

  // 5 report
  const headline = await page.locator(tid('node-perm-report-headline')).innerText({ timeout: 3000 }).catch(() => '');
  const hPaint = await paintedText(page, tid('node-perm-report-headline'), '过去 7 天本来会拦下 7 次').catch(() => null);
  await page.locator(tid('node-perm-report')).click({ timeout: 3000 }).catch(() => {});
  await sleep(500);
  const reasons = await page.locator('[data-testid^="node-perm-reason-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').slice('node-perm-reason-'.length)));
  const routes = await page.locator(tid('node-perm-route')).evaluateAll(els => els.map(e => e.textContent));
  const foot = await page.locator(tid('node-perm-report-footnote')).innerText({ timeout: 2000 }).catch(() => '');
  await page.locator(tid('node-perm-report-detail')).scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await page.screenshot({ path: join(OUT, `${tag}-2-report.png`) });
  record(tag, '5 report row: 「过去 7 天本来会拦下 7 次」 → by reason and by action', {
    headline: headline.trim() === '过去 7 天本来会拦下 7 次', painted: !!hPaint?.painted,
    reasons: reasons.join(',') === 'beyond_owner_visibility,human_only', routes: routes.length === 3 && routes[0].includes('改任务') && routes[0].includes('4'),
    footnote: foot.includes('只记录、不拦截'),
  }, { headline, reasons, routes, foot });
  record(tag, '0 no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3) });
  await ctx.close();
}

for (const theme of ['light', 'dark']) {
  await run('desktop', { width: 1440, height: 900 }, MAC_UA, theme, false);
  await run('phone', { width: 390, height: 844 }, ANDROID_UA, theme, true);
}
await browser.close();
web.close?.();
console.log(failures ? `FAIL ${failures}` : 'PASS');
process.exit(failures ? 1 : 0);
