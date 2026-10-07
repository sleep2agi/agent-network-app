// 节点页「概览 → 节点操作」(agent-network board #694 第 4 步)。No hub: an in-page Tauri stub answers every request
// with placeholder data. Nothing touches 127.0.0.1:9200.
//
//   WEB_DIR=<expo web export> OUT=<png dir> PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node tests/test-node-control-card/drive.mjs
//
// Three nodes (GET /api/nodes + GET /api/host-supervisors):
//   示例-托管    lifecycle_controllable=true                              → 重启 / 停止 enabled, no reason line
//   示例-可收编  hand-started, adoption projection, daemon on the same host → both grey + the reason + 「交给守护进程管理」
//                (clicking it opens the 0.2.218 adoption dialog in place)
//   示例-无守护  hand-started, no daemon on its host                        → both grey + the reason + 「这台机器上还没有守护进程」
// Desktop 1440×900 and phone 390×844 (Android UA), light and dark. Measures: reason / next-step text start at the same x as
// the 重启 button; the card's left edge matches the 概览 facts card; phone buttons ≥ 44 high and equal width; no
// horizontal overflow. Exit 1 when any check fails. Against the pre-change export it goes red (no card at all).
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
const REASON = '这个节点是手动启动的，还没交给守护进程（daemon）管理，所以不能在这里重启。';
let failures = 0;
const record = (vp, what, checks, detail = {}) => {
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;
  console.log(JSON.stringify({ vp, what, ok, failed: Object.keys(checks).filter(k => !checks[k]).join(',') || '-', ...(ok ? {} : detail) }));
};

const initScript = ({ theme }) => {
  const HUB = 'http://mock-hub.invalid';
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const sessions = [
    { alias: '示例-托管', status: 'idle', agent: 'claude-code', node_id: 'n_daemon', updated_at: iso(1) },
    { alias: '示例-可收编', status: 'idle', agent: 'grok-build-acp', node_id: 'n_adopt', updated_at: iso(2) },
    { alias: '示例-无守护', status: 'idle', agent: 'grok-build-acp', node_id: 'n_lonely', updated_at: iso(3) },
  ];
  const nodes = [
    { node_id: 'n_daemon', alias: '示例-托管', hostname: 'box-a', lifecycle_controllable: true, lifecycle_state: 'active', lifecycle_daemon_node_id: 'd_a', managed: 'created', adoption: null },
    { node_id: 'n_adopt', alias: '示例-可收编', hostname: 'box-a', lifecycle_controllable: false, lifecycle_state: 'active', managed: 'none', adoption: null },
    { node_id: 'n_lonely', alias: '示例-无守护', hostname: 'box-z', lifecycle_controllable: false, lifecycle_state: 'active', managed: 'none', adoption: null },
  ];
  const daemons = [{ daemon_node_id: 'd_a', alias: '示例-daemon', hostname: 'box-a', online: true, adopt_capable: true }];
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-ctl', displayName: 'tester', networkId: 'net-ctl' };
  const route = (url) => {
    const u = new URL(url);
    const p = u.pathname;
    const cfgm = /^\/api\/nodes\/([^/]+)\/config$/.exec(p);
    if (cfgm) return { ok: true, node_id: decodeURIComponent(cfgm[1]), network_id: 'net-ctl', config_revision: 1, model: 'placeholder-model', flags: {}, config_update_capable: false };
    if (p === '/api/host-supervisors') return { ok: true, count: daemons.length, daemons };
    if (p === '/api/auth/me') return { ok: true, user: { user_id: 'u_tester', username: 'tester', role: 'user' }, current_network: 'net-ctl', networks: [{ network_id: 'net-ctl', member_role: 'owner', agent_access: 'all' }] };
    if (p === '/api/networks/net-ctl/humans') return { ok: true, humans: [{ user_id: 'u_tester', username: 'tester' }] };
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
          const status = body === null ? 404 : 200;
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
  await page.locator(tid('node-control-card')).waitFor({ timeout: 10000 }).catch(() => {});
  await sleep(1200);
}

const measure = (page) => page.evaluate(() => {
  const box = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, text: e.textContent, disabled: e.getAttribute('aria-disabled') === 'true' }; };
  // 文字真正开始的位置(按钮 / 链接有内边距时,量里面的文字节点)。
  const textLeft = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const range = document.createRange(); range.selectNodeContents(e); const rs = [...range.getClientRects()].filter(r => r.width > 0); return rs.length ? Math.min(...rs.map(r => r.left)) : null; };
  const card = box('node-control-card');
  // 概览字段卡 = 内容列 → 概览块 → 第一段(标题 + 卡)里的第二个子元素。
  const factsCard = (() => { const sib = document.querySelector('[data-testid="node-page-content"]')?.firstElementChild?.firstElementChild?.children?.[1]; if (!sib) return null; const r = sib.getBoundingClientRect(); return { l: r.left, r: r.right }; })();
  return { card, factsCard, restart: box('node-control-restart'), stop: box('node-control-stop'), notice: box('node-control-notice'), adopt: box('node-control-adopt'), noDaemon: box('node-control-no-daemon'),
    noticeL: textLeft('node-control-notice'), adoptTextL: (() => { const e = document.querySelector('[data-testid="node-control-adopt"] div, [data-testid="node-control-adopt"] span'); return e ? e.getBoundingClientRect().left : null; })(), noDaemonL: textLeft('node-control-no-daemon'),
    docW: document.documentElement.scrollWidth, vw: window.innerWidth };
});

async function run(vp, viewport, ua, theme, phone) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2, locale: 'zh-CN', colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
  await page.addInitScript((th) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme_mode_v1', th); localStorage.setItem('anet.language.v1', 'zh'); sessionStorage.setItem('seeded', '1'); } } catch {} }, theme);
  await page.addInitScript(initScript, { theme });
  const tag = `${vp}-${theme}`;
  const shot = (name) => page.screenshot({ path: join(OUT, `restartbtn-${vp}-${name}-${theme}.png`) });
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1;
  const inView = (g, x) => !!x && x.l >= -0.5 && x.r <= g.vw + 0.5;
  const sizing = (g) => phone
    ? { touch44: g.restart?.h >= 44 && g.stop?.h >= 44, equalWidth: near(g.restart?.w, g.stop?.w) }
    : { desktop34: g.restart && g.restart.h < 44, sameHeight: near(g.restart?.h, g.stop?.h) };

  // 1 daemon-managed → enabled
  await openNode(page, '示例-托管');
  let g = await measure(page);
  record(tag, '1 托管: 重启 / 停止 enabled, no reason line', {
    card: !!g.card, restartOn: g.restart?.disabled === false, stopOn: g.stop?.disabled === false, noNotice: g.notice === null && g.adopt === null && g.noDaemon === null,
    cardAlignedWithFacts: near(g.card?.l, g.factsCard?.l), noOverflow: g.docW <= g.vw + 0.5, ...sizing(g),
  }, { g });
  await shot('managed');

  // 2 hand-started, daemon on its host → grey + reason + adopt link
  await openNode(page, '示例-可收编');
  g = await measure(page);
  const noticePaint = await paintedText(page, tid('node-control-notice')).catch(() => null);
  record(tag, '2 可收编: grey + reason + 交给守护进程管理', {
    restartGrey: g.restart?.disabled === true, stopGrey: g.stop?.disabled === true,
    reason: g.notice?.text === REASON, painted: !!noticePaint?.painted, adopt: !!g.adopt?.text?.includes('交给守护进程管理'), noNoDaemon: g.noDaemon === null,
    noticeAligned: near(g.noticeL, g.restart?.l), adoptAligned: phone ? near(g.adopt?.l, g.restart?.l) && near(g.adopt?.r, g.stop?.r) : near(g.adoptTextL, g.restart?.l),
    inView: inView(g, g.notice) && inView(g, g.adopt) && inView(g, g.stop), noOverflow: g.docW <= g.vw + 0.5, ...sizing(g),
  }, { g });
  await shot('adoptable');
  await page.locator(tid('node-control-adopt')).click({ timeout: 3000 }).catch(() => {});
  await sleep(800);
  const panel = await page.locator(`${tid('node-control-card')} ${tid('adopt-confirm-panel')}`).count();
  const daemonBtn = await page.locator(tid('adopt-daemon-d_a')).count();
  record(tag, '2b 交给守护进程管理 opens the adoption dialog in place', { panel: panel > 0, daemonListed: daemonBtn > 0 }, { panel, daemonBtn });
  await shot('adopt-open');

  // 3 hand-started, no daemon on its host
  await openNode(page, '示例-无守护');
  g = await measure(page);
  record(tag, '3 无守护: grey + reason + 这台机器上还没有守护进程', {
    restartGrey: g.restart?.disabled === true, stopGrey: g.stop?.disabled === true, reason: g.notice?.text === REASON,
    noDaemon: g.noDaemon?.text === '这台机器上还没有守护进程', noAdopt: g.adopt === null,
    aligned: near(g.noticeL, g.restart?.l) && near(g.noDaemonL, g.restart?.l), noOverflow: g.docW <= g.vw + 0.5,
  }, { g });
  await shot('no-daemon');

  // 4 模型与运行时: one pointer line back to 概览
  await page.locator(`${tid('node-section-nav')} [role="tab"]`, { hasText: '模型与运行时' }).first().click({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  const pointer = await page.locator(tid('node-model-control-pointer')).count();
  await page.locator(tid('node-model-control-pointer')).click({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  const back = await page.locator(tid('node-control-card')).count();
  record(tag, '4 模型与运行时 pointer → 概览', { pointer: pointer > 0, back: back > 0 }, { pointer, back });

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
