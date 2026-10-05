// 节点页「危险操作」:手动启动的节点的重启(agent-network board #586)。No hub: an in-page Tauri stub answers every
// request with placeholder data. Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo web export> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-node-danger-restart/drive.mjs
//
// Four nodes, as GET /api/nodes + GET /api/nodes/:id/config describe them:
//   示例-手动     lifecycle_controllable=false, online, config_update_capable=true   → 重启 enabled; 停止/删除 grey + one line why
//   示例-手动旧版 lifecycle_controllable=false, online, config_update_capable=false  → 重启 grey + 「不支持远程重启」
//   示例-手动离线 lifecycle_controllable=false, offline                            → 重启 grey + 「离线」
//   示例-托管     lifecycle_controllable=true                                     → all three enabled, no reason line
// Desktop 1440×900 (Tauri shell) and phone 390×844 (Android UA), light and dark. Every reason line must be painted and
// inside the viewport (no horizontal overflow on the phone). Clicking 重启 on 示例-手动 opens the confirm dialog.
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
    { alias: '示例-手动', status: 'idle', agent: 'claude-code', node_id: 'n_hand_ok', updated_at: iso(1) },
    { alias: '示例-手动旧版', status: 'idle', agent: 'claude-code', node_id: 'n_hand_old', updated_at: iso(2) },
    { alias: '示例-手动离线', status: 'offline', agent: 'claude-code', node_id: 'n_hand_off', updated_at: iso(90) },
    { alias: '示例-托管', status: 'idle', agent: 'claude-code', node_id: 'n_daemon', updated_at: iso(3) },
  ];
  const nodes = [
    { node_id: 'n_hand_ok', alias: '示例-手动', lifecycle_controllable: false },
    { node_id: 'n_hand_old', alias: '示例-手动旧版', lifecycle_controllable: false },
    { node_id: 'n_hand_off', alias: '示例-手动离线', lifecycle_controllable: false },
    { node_id: 'n_daemon', alias: '示例-托管', lifecycle_controllable: true, lifecycle_daemon_node_id: 'node_daemon_x' },
  ];
  const capable = { n_hand_ok: true, n_hand_old: false, n_hand_off: true, n_daemon: true };
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-danger', displayName: 'tester', networkId: 'net-danger' };
  const route = (url) => {
    const u = new URL(url);
    const p = u.pathname;
    const cfgm = /^\/api\/nodes\/([^/]+)\/config$/.exec(p);
    if (cfgm) {
      const id = decodeURIComponent(cfgm[1]);
      const n = nodes.find(x => x.node_id === id);
      return { ok: true, node_id: id, alias: n?.alias, network_id: 'net-danger', config_revision: 1, model: 'placeholder-model', flags: {}, config_update_capable: capable[id] === true };
    }
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-danger', networks: [{ network_id: 'net-danger', member_role: 'owner', agent_access: 'all' }] };
    if (p === '/api/networks/net-danger/humans') return { ok: true, humans: [{ user_id: 'u_tester', username: 'tester' }] };
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
          const body = route(c.url);
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

const btn = (label) => `[role="button"][aria-label="${label}"]`;
async function dangerState(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const b = (l) => { const e = document.querySelector(`[role="button"][aria-label="${l}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { disabled: e.getAttribute('aria-disabled') === 'true', l: r.left, r: r.right, w: r.width }; };
    const txt = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right, h: r.height }; };
    return { restart: b('重启节点'), stop: b('停止节点'), del: b('删除节点'), restartReason: txt('node-danger-restart-reason'), stopReason: txt('node-danger-stop-reason'),
      docW: document.documentElement.scrollWidth, vw };
  });
}

async function run(vp, viewport, ua, theme, phone) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  await page.addInitScript((th) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme_mode_v1', th); localStorage.setItem('anet.language.v1', 'zh'); sessionStorage.setItem('seeded', '1'); } } catch {} }, theme);
  await page.addInitScript(initScript, { theme });
  const tag = `${vp}-${theme}`;
  const openDanger = async (alias) => {
    await openNode(page, alias);
    await page.locator(`${tid('node-section-nav')} [role="tab"]`, { hasText: '危险操作' }).first().click({ timeout: 3000 }).catch(() => {});
    await page.locator(btn('重启节点')).waitFor({ timeout: 5000 }).catch(() => {});
    await sleep(900);
    return dangerState(page);
  };
  const inView = (g, x) => !!x && x.l >= -0.5 && x.r <= g.vw + 0.5;
  const noOverflow = (g) => g.docW <= g.vw + 0.5;

  // 1 hand-started, online, capable
  let g = await openDanger('示例-手动');
  const stopPaint = await paintedText(page, tid('node-danger-stop-reason')).catch(() => null);
  record(tag, '1 示例-手动: 重启 enabled; 停止/删除 grey with the one-line reason', {
    found: !!g.restart && !!g.stop && !!g.del,
    restartEnabled: g.restart?.disabled === false, stopGrey: g.stop?.disabled === true, deleteGrey: g.del?.disabled === true,
    noRestartReason: g.restartReason === null,
    stopReason: !!g.stopReason?.text?.includes('这个节点是手动启动的，只能在它所在的机器上停止 / 删除'),
    painted: !!stopPaint?.painted, inView: inView(g, g.stopReason) && inView(g, g.restart), noOverflow: noOverflow(g),
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-1-hand-started.png`) });
  await page.locator(btn('重启节点')).click({ timeout: 3000 }).catch(() => {});
  await sleep(500);
  const dialog = await page.getByText('重启节点？').count();
  record(tag, '1b clicking 重启 opens the confirm dialog', { dialog: dialog > 0 }, { dialog });
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByText('返回', { exact: true }).last().click({ timeout: 2000 }).catch(() => {});
  await sleep(300);

  // 2 hand-started, online, NOT capable
  g = await openDanger('示例-手动旧版');
  const rPaint = await paintedText(page, tid('node-danger-restart-reason')).catch(() => null);
  record(tag, '2 示例-手动旧版: 重启 grey + 「不支持远程重启」', {
    restartGrey: g.restart?.disabled === true, reason: !!g.restartReason?.text?.includes('不支持远程重启'), painted: !!rPaint?.painted,
    stopReason: !!g.stopReason, inView: inView(g, g.restartReason), noOverflow: noOverflow(g),
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-2-not-capable.png`) });

  // 3 hand-started, offline
  g = await openDanger('示例-手动离线');
  record(tag, '3 示例-手动离线: 重启 grey + 「离线」', {
    restartGrey: g.restart?.disabled === true, reason: !!g.restartReason?.text?.includes('离线'), noOverflow: noOverflow(g),
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-3-offline.png`) });

  // 4 daemon-managed: unchanged
  g = await openDanger('示例-托管');
  record(tag, '4 示例-托管: all three enabled, no reason line', {
    all: g.restart?.disabled === false && g.stop?.disabled === false && g.del?.disabled === false,
    noReasons: g.restartReason === null && g.stopReason === null,
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-4-daemon.png`) });

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
