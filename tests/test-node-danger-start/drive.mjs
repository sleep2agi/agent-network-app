// 节点页「危险操作」:启动节点(agent-network board #585)。No hub: an in-page Tauri stub answers every request with
// placeholder data and records each MCP tools/call. Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo web export> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-node-danger-start/drive.mjs
//
// Three nodes, as GET /api/status + GET /api/nodes describe them:
//   示例-托管停止  offline, lifecycle_state=stopped, lifecycle_controllable=true (daemon node_daemon_x)
//                  → 启动节点 enabled; 重启 grey「节点已停止，请先启动」; 停止 grey「节点已停止」; 删除 enabled; 确认 sends start_node {node_id:n_daemon_stopped, daemon_node_id:node_daemon_x};
//                    the page says 已提交 (stub: lifecycle_state=starting), then — the stub brings the node up 3s later —
//                    已上线 after the page's next 10s poll
//   示例-手动停止  offline, lifecycle_state=stopped, lifecycle_controllable=false
//                  → 启动节点 grey + one line: 只能在它所在的机器上启动（`anet node start 示例-手动停止`）
//   示例-托管运行  idle, controllable → no 启动节点; 重启/停止/删除 enabled as before (#712)
// Desktop 1440×900 (Tauri shell) and phone 390×844 (Android UA), light and dark. Lines must be painted and inside the
// viewport (no horizontal overflow on the phone). Exit 1 when any check fails. Run it against the pre-change export
// first: it must go red.
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
    { alias: '示例-托管停止', status: 'offline', agent: 'claude-code', node_id: 'n_daemon_stopped', updated_at: iso(30) },
    { alias: '示例-手动停止', status: 'offline', agent: 'claude-code', node_id: 'n_hand_stopped', updated_at: iso(40) },
    { alias: '示例-托管运行', status: 'idle', agent: 'claude-code', node_id: 'n_daemon_run', updated_at: iso(1) },
  ];
  const nodes = [
    { node_id: 'n_daemon_stopped', alias: '示例-托管停止', lifecycle_state: 'stopped', lifecycle_controllable: true, lifecycle_daemon_node_id: 'node_daemon_x' },
    { node_id: 'n_hand_stopped', alias: '示例-手动停止', lifecycle_state: 'stopped', lifecycle_controllable: false },
    { node_id: 'n_daemon_run', alias: '示例-托管运行', lifecycle_state: 'active', lifecycle_controllable: true, lifecycle_daemon_node_id: 'node_daemon_x' },
  ];
  const capable = { n_daemon_stopped: true, n_hand_stopped: true, n_daemon_run: true };
  // Every tools/call the page sends. start_node flips the stopped node to running, the way the daemon would.
  window.__mcpCalls = [];
  let pendingStart = null;
  const settleStart = () => {
    if (!pendingStart || Date.now() < pendingStart.at) return;
    const n = pendingStart.node; pendingStart = null;
    n.lifecycle_state = 'active';
    const s = sessions.find(x => x.node_id === n.node_id);
    if (s) { s.status = 'idle'; s.updated_at = new Date().toISOString(); }
  };
  const mcp = (bodyText) => {
    let call = null; try { call = JSON.parse(bodyText); } catch {}
    const params = call?.params ?? {};
    window.__mcpCalls.push({ name: params.name, arguments: params.arguments });
    if (params.name === 'start_node') {
      // Like the Hub: the row goes to 'starting' at once; the daemon brings it up a few seconds later.
      const n = nodes.find(x => x.node_id === params.arguments?.node_id);
      if (n) { n.lifecycle_state = 'starting'; pendingStart = { node: n, at: Date.now() + 3000 }; }
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, request_id: 'str_placeholder', lifecycle_state: 'starting' }) }] } };
    }
    return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] } };
  };
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-start', displayName: 'tester', networkId: 'net-start' };
  const route = (url, bodyText) => {
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/mcp') return mcp(bodyText);
    settleStart();
    const cfgm = /^\/api\/nodes\/([^/]+)\/config$/.exec(p);
    if (cfgm) {
      const id = decodeURIComponent(cfgm[1]);
      const n = nodes.find(x => x.node_id === id);
      return { ok: true, node_id: id, alias: n?.alias, network_id: 'net-start', config_revision: 1, model: 'placeholder-model', flags: {}, config_update_capable: capable[id] === true };
    }
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-start', networks: [{ network_id: 'net-start', member_role: 'owner', agent_access: 'all' }] };
    if (p === '/api/networks/net-start/humans') return { ok: true, humans: [{ user_id: 'u_tester', username: 'tester' }] };
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
          let bodyText = ''; try { bodyText = c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : ''; } catch {}
          const body = route(c.url, bodyText);
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
    return { start: b('启动节点'), restart: b('重启节点'), stop: b('停止节点'), del: b('删除节点'), startReason: txt('node-danger-start-reason'),
      restartReason: txt('node-danger-restart-reason'), stopStateReason: txt('node-danger-stop-state-reason'), reasons: txt('node-danger-reasons'),
      result: txt('node-danger-action-message'), docW: document.documentElement.scrollWidth, vw };
  });
}

async function run(vp, viewport, ua, theme) {
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

  // 1 daemon-managed, stopped: Start visible + enabled; the others keep #712 behavior.
  let g = await openDanger('示例-托管停止');
  const restartPaint = await paintedText(page, tid('node-danger-restart-reason')).catch(() => null);
  record(tag, '1 示例-托管停止: 启动 enabled; 重启 grey「节点已停止，请先启动」; 停止 grey「节点已停止」; 删除 enabled', {
    found: !!g.start, startEnabled: g.start?.disabled === false, noStartReason: g.startReason === null,
    restartGrey: g.restart?.disabled === true, restartReason: !!g.restartReason?.text?.includes('节点已停止，请先启动'),
    noGenericOffline: !g.reasons?.text?.includes('离线'),
    stopGrey: g.stop === null || g.stop.disabled === true, stopReason: g.stop === null || !!g.stopStateReason?.text?.includes('节点已停止'),
    deleteEnabled: g.del?.disabled === false, painted: !!restartPaint?.painted,
    inView: inView(g, g.start) && inView(g, g.restartReason), noOverflow: noOverflow(g),
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-1-daemon-stopped.png`) });
  await page.locator(btn('启动节点')).click({ timeout: 3000 }).catch(() => {});
  await sleep(500);
  const dialog = await page.getByText('启动节点？').count();
  await page.screenshot({ path: join(OUT, `${tag}-1b-confirm.png`) });
  await page.getByText('确认', { exact: true }).last().click({ timeout: 3000 }).catch(() => {});
  await sleep(800);
  const calls = await page.evaluate(() => window.__mcpCalls || []);
  const startCall = calls.find(c => c.name === 'start_node');
  g = await dangerState(page);
  record(tag, '1c 确认 sends start_node with the node and daemon ids; page says 已提交', {
    dialog: dialog > 0, sent: !!startCall,
    nodeId: startCall?.arguments?.node_id === 'n_daemon_stopped', daemonId: startCall?.arguments?.daemon_node_id === 'node_daemon_x',
    network: startCall?.arguments?.network_id === 'net-start', onlyOne: calls.filter(c => c.name === 'start_node').length === 1,
    submitted: !!g.result?.text?.includes('已提交'),
  }, { calls, result: g.result?.text });
  await page.screenshot({ path: join(OUT, `${tag}-1c-submitted.png`) });
  // The page polls every 10s; the stub already flipped the node to idle.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { g = await dangerState(page); if (g.result?.text?.includes('已上线')) break; await sleep(500); }
  record(tag, '1d after the next poll the page says 已上线, hides 启动节点, and 重启/停止 come back', {
    online: !!g.result?.text?.includes('已上线'), startGone: g.start === null,
    restartEnabled: g.restart?.disabled === false, stopEnabled: g.stop?.disabled === false, noStateReasons: g.restartReason === null && g.stopStateReason === null,
  }, { result: g.result?.text });
  await page.screenshot({ path: join(OUT, `${tag}-1d-online.png`) });

  // 2 hand-started, stopped: Start grey + the one line.
  g = await openDanger('示例-手动停止');
  const paint = await paintedText(page, tid('node-danger-start-reason')).catch(() => null);
  record(tag, '2 示例-手动停止: 启动节点 grey + 「只能在它所在的机器上启动（anet node start 示例-手动停止）」', {
    found: !!g.start, startGrey: g.start?.disabled === true,
    reason: !!g.startReason?.text?.includes('这个节点是手动启动的，只能在它所在的机器上启动（`anet node start 示例-手动停止`）'),
    painted: !!paint?.painted, inView: inView(g, g.startReason), noOverflow: noOverflow(g),
    unchanged: g.restart?.disabled === true && !!g.restartReason?.text?.includes('离线') && g.stop?.disabled === true && g.del?.disabled === true && g.stopStateReason === null,
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-2-hand-stopped.png`) });

  // 3 daemon-managed, running: no Start; the three others enabled.
  g = await openDanger('示例-托管运行');
  record(tag, '3 示例-托管运行: no 启动节点; 重启/停止/删除 enabled, no reason lines', {
    noStart: g.start === null, all: g.restart?.disabled === false && g.stop?.disabled === false && g.del?.disabled === false,
    noReasons: g.reasons === null,
  }, { g });
  await page.screenshot({ path: join(OUT, `${tag}-3-daemon-running.png`) });

  record(tag, '0 no page errors', { none: errors.length === 0 }, { errors: errors.slice(0, 3) });
  await ctx.close();
}

for (const theme of ['light', 'dark']) {
  await run('desktop', { width: 1440, height: 900 }, MAC_UA, theme);
  await run('phone', { width: 390, height: 844 }, ANDROID_UA, theme);
}
await browser.close();
web.close?.();
console.log(failures ? `FAIL ${failures}` : 'PASS');
process.exit(failures ? 1 : 0);
