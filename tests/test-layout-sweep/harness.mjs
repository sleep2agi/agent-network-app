// Shared plumbing for the layout sweep: static server for the expo web export, a Tauri stub that
// answers every hub request from placeholder data in-page (no hub process, no network, no port),
// and a Chromium launcher. Placeholder data only — aliases are 示例-A / 示例-B, never real nodes.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// The drives assert on the Chinese UI. Headless Chromium takes its UI language from LANG, so a shell with LANG=C / en_US
// renders English and every Chinese text lookup times out. Default it here (before any drive launches Chromium, which
// inherits process.env); ANET_TEST_LANG overrides, e.g. ANET_TEST_LANG=en_US.UTF-8 for an English run.
process.env.LANG = process.env.ANET_TEST_LANG || 'zh_CN.UTF-8';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

export async function serveExport(dir) {
  const server = createServer((req, res) => {
    let p = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

// Runs in the page before the app. Everything the app reads from the "hub" comes from here.
export const initScript = ({ theme }) => {
  const HUB = 'http://mock-hub.invalid';
  const now = new Date();
  const iso = (minAgo) => new Date(now.getTime() - minAgo * 60000).toISOString();
  const profile = { serverUrl: HUB, token: 'placeholder-token', username: 'tester', profileId: 'p-sweep', displayName: 'tester', networkId: 'net-sweep' };
  const sessions = [
    { alias: '示例-A', status: 'idle', agent: 'claude-code', runtime: 'agent-node', node_id: 'n_sweep_a', hostname: 'host-a', project_dir: '/work/demo-a', version: '0.0.0', model: 'model-x', updated_at: iso(1), rules_file_capable: true, skills_capable: true, files_capable: true },
    { alias: '示例-B', status: 'working', agent: 'codex', runtime: 'agent-node', node_id: 'n_sweep_b', hostname: 'host-b', project_dir: '/work/demo-b', version: '0.0.0', task: '整理示例数据', updated_at: iso(3) },
    { alias: '示例-C', status: 'offline', agent: 'grok', node_id: 'n_sweep_c', updated_at: iso(90) },
    // > 10 agents so the list shows its search box (the two-pane alignment reference)
    ...Array.from({ length: 9 }, (_, i) => ({ alias: `示例-${i + 4}`, status: i % 3 ? 'idle' : 'offline', agent: 'claude-code', node_id: `n_sweep_${i + 4}`, updated_at: iso(20 + i) })),
  ];
  const nodes = sessions.map(s => ({ node_id: s.node_id, alias: s.alias, lifecycle_state: 'running', runtime: s.runtime ?? null, lifecycle_controllable: true, config_revision: 1, config_snapshot: { model: 'model-x', role: null } }));
  const tasks = [
    { task_id: 't_sweep_1', from_name: 'tester', to_name: '示例-A', content: '示例任务:检查一下构建', result: '示例回复:构建通过。', status: 'replied', priority: 'normal', created_at: iso(10), updated_at: iso(9), completed_at: iso(9) },
    { task_id: 't_sweep_2', from_name: 'tester', to_name: '示例-B', content: '示例任务二', status: 'delivered', priority: 'high', created_at: iso(5), updated_at: iso(5) },
  ];
  const schedules = [{ schedule_id: 's_sweep_1', network_id: 'net-sweep', name: '示例定时任务', target_node_id: 'n_sweep_a', target_alias: '示例-A', task_content: '每天早上汇报', priority: 'normal', schedule: { type: 'daily', time: '09:00' }, timezone: 'Asia/Shanghai', misfire_policy: 'skip', status: 'active', next_run_at: iso(-600), last_run_at: iso(840), revision: 1 }];
  const daemons = [{ daemon_node_id: 'd_sweep_1', alias: '示例-守护', hostname: 'host-d', online: true, last_seen_at: iso(0), runtimes_supported: ['claude-code', 'codex'], can_create_nodes: true, create_capability_observed_ms_ago: 1000 }];
  // A drive can hand in its own synthetic rules file (window.__rulesFixture, set by an earlier init script).
  const RULES = window.__rulesFixture || '# 示例规则\n\n占位内容,只用于布局测量。\n\n## 第二节\n\n- 一\n- 二\n';
  const LISTING = JSON.stringify({ path: '', total: 3, truncated: false, entries: [{ name: 'src', type: 'dir' }, { name: 'README.md', type: 'file', size: 120 }, { name: 'package.json', type: 'file', size: 64 }] });
  const mcp = (name, args) => {
    if (name === 'read_node_rules_file' || name === 'write_node_rules_file') return { ok: true, request_id: 'r_sweep', op: 'read' };
    if (name === 'list_node_files') return { ok: true, request_id: 'f_sweep_list', op: 'read' };
    if (name === 'get_rules_file_result') {
      const listing = args?.request_id === 'f_sweep_list';
      return { ok: true, request_id: args?.request_id, op: 'read', status: 'done', file_name: listing ? null : 'CLAUDE.md', exists: true, content: listing ? LISTING : RULES, error: null, age_ms: 5 };
    }
    return { ok: true };
  };
  const route = (url, bodyText) => {
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/mcp') {
      let params = {};
      try { params = JSON.parse(bodyText || '{}')?.params ?? {}; } catch {}
      return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(mcp(params.name ?? '', params.arguments ?? {})) }] } };
    }
    // A drive can hand in a task board (window.__tasksFixture = { requirements, projects, people, capabilities }).
    const TASKS = window.__tasksFixture;
    if (TASKS && p === '/api/requirements/projects') return { ok: true, projects: TASKS.projects ?? [] };
    if (TASKS && p === '/api/requirements/people') return { ok: true, people: TASKS.people ?? [] };
    // Tags (hub tag_ops): GET answers from the fixture's rows (+ TASKS.tagColors, TASKS.tagCanManage); POST …/tags/ops
    // records the body in window.__tagOps and rewrites the rows the way the hub does. TASKS.tagCanManage undefined =
    // an older hub (no counts / colors / can_manage fields).
    if (TASKS && p === '/api/requirements/tags' && !bodyText) {
      const counts = {};
      for (const r of TASKS.requirements ?? []) for (const t of r.tags ?? []) counts[t] = (counts[t] ?? 0) + 1;
      const tags = Object.keys(counts).sort();
      if (TASKS.tagCanManage === undefined) return { ok: true, tags };
      const colors = Object.fromEntries(Object.entries(TASKS.tagColors ?? {}).filter(([t]) => counts[t]));
      return { ok: true, tags, counts, colors, can_manage: TASKS.tagCanManage };
    }
    if (TASKS && p === '/api/requirements/tags/ops' && bodyText) {
      const op = JSON.parse(bodyText);
      (window.__tagOps ||= []).push(op);
      const colors = (TASKS.tagColors ||= {});
      if (op.op === 'color') { if (op.color) colors[op.tag] = op.color.toLowerCase(); else delete colors[op.tag]; return { ok: true, op: 'color', affected: 0 }; }
      const sources = op.op === 'rename' ? [op.from] : op.op === 'merge' ? op.from : [op.tag];
      const to = op.op === 'delete' ? null : op.to;
      let affected = 0;
      for (const r of TASKS.requirements ?? []) {
        if (!(r.tags ?? []).some(t => sources.includes(t))) continue;
        const next = [];
        for (const t of r.tags) { const m = sources.includes(t) ? to : t; if (m !== null && !next.includes(m)) next.push(m); }
        r.tags = next; affected++;
      }
      if (to && !colors[to]) { const c = sources.map(t => colors[t]).find(Boolean); if (c) colors[to] = c; }
      for (const t of sources) delete colors[t];
      return { ok: true, op: op.op, affected };
    }
    // GET /api/requirements/stats (hub capability stats): TASKS.stats(query) when the drive hands one in; recorded in
    // window.__statsQueries. No TASKS.stats = an old hub (404).
    if (TASKS && p === '/api/requirements/stats') { (window.__statsQueries ||= []).push(u.search); return typeof TASKS.stats === 'function' ? TASKS.stats(u.searchParams) : null; }
    // GET /api/requirements/events (hub capability events): TASKS.events (newest first, hub shape), filtered by since /
    // cursor / requirement_id like the hub; recorded in window.__eventsQueries. No TASKS.events = an old hub (404).
    if (TASKS && p === '/api/requirements/events') {
      (window.__eventsQueries ||= []).push(u.search);
      if (!TASKS.events) return null;
      const since = u.searchParams.get('since'), cursor = u.searchParams.get('cursor'), card = u.searchParams.get('requirement_id');
      const limit = Number(u.searchParams.get('limit') || 200);
      const rows = TASKS.events.filter(e => (!since || e.at >= since) && (!cursor || Number(e.id) < Number(cursor)) && (!card || e.requirement_id === card));
      return { ok: true, events: rows.slice(0, limit), has_more: rows.length > limit, next_cursor: rows.length > limit ? rows[limit - 1].id : null, server_time: new Date().toISOString() };
    }
    // GET /api/requirements/<id> (the dashboard opening a card that is not on the board, e.g. archived).
    const oneGet = TASKS && !bodyText && /^\/api\/requirements\/([^/]+)$/.exec(p);
    if (oneGet) { const id = decodeURIComponent(oneGet[1]); const row = [...(TASKS.requirements ?? []), ...(TASKS.archived ?? [])].find(r => r.id === id); return row ? { ok: true, requirement: row } : null; }
    // PATCH /api/requirements/<id> (the only requirement call with a body): merge, record the body for the drive to
    // assert on (window.__tasksPatches); window.__tasksFailPatch = true answers 404 so the drive can watch a revert.
    const one = TASKS && /^\/api\/requirements\/([^/]+)$/.exec(p);
    if (one && bodyText) {
      const patch = JSON.parse(bodyText);
      (window.__tasksPatches ||= []).push(patch);
      if (window.__tasksFailPatch) return null;
      const row = TASKS.requirements.find(r => r.id === decodeURIComponent(one[1]));
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      return { ok: true, requirement: row };
    }
    // ?q= (hub capability search): a naive name match over the fixture's serverOnly rows (older tasks the list
    // didn't return) — or its archived rows with archived=true. Recorded in window.__tasksQueries for the drive.
    if (TASKS && p === '/api/requirements' && u.searchParams.has('q')) {
      (window.__tasksQueries ||= []).push(u.search);
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const pool = u.searchParams.get('archived') === 'true' ? (TASKS.archived ?? []) : [...(TASKS.requirements ?? []), ...(TASKS.serverOnly ?? [])];
      return { ok: true, requirements: pool.filter(r => q.split(/\s+/).filter(Boolean).every(t => r.name.toLowerCase().includes(t))), capabilities: TASKS.capabilities ?? [], has_more: false, next_cursor: null };
    }
    // ?archived=true (the 任务 search's 包含已归档): only the fixture's archived rows.
    if (TASKS && p === '/api/requirements' && u.searchParams.get('archived') === 'true') return { ok: true, requirements: TASKS.archived ?? [], capabilities: TASKS.capabilities ?? [] };
    // TASKS.hasMore: the list is truncated (a paging hub says so with has_more); undefined = an old hub (no field).
    if (TASKS && p === '/api/requirements') return { ok: true, requirements: TASKS.requirements ?? [], capabilities: TASKS.capabilities ?? [], ...(TASKS.hasMore !== undefined ? { has_more: TASKS.hasMore, next_cursor: TASKS.hasMore ? 'c1' : null } : {}) };
    // TASKS.meId: the signed-in user's id (the 任务 badge tells my own edits from others' by it); unset = an app that never needed it.
    if (p === '/api/auth/me') return { ok: true, user: { username: 'tester', ...(TASKS?.meId ? { user_id: TASKS.meId } : {}) }, current_network: 'net-sweep', networks: [{ network_id: 'net-sweep', name: 'sweep' }] };
    // `?light=1` is the hub's narrow projection (server/src/server.ts): exactly these 8 fields, no
    // node_id, no capability bits. Answering it with full rows hid a real bug (2026-09-29: chat info
    // read caps from the light rows and dropped 规则文件 / 技能 for every claude-code session).
    if (p === '/api/status' && u.searchParams.get('light') === '1') {
      return { ok: true, sessions: sessions.map(s => ({ alias: s.alias, status: s.status, agent: s.agent ?? null, task: s.task ?? null, server: s.server ?? null, updated_at: s.updated_at ?? null, runtime: s.runtime ?? null, network_id: s.network_id ?? null })) };
    }
    if (p === '/api/status') return { ok: true, sessions, files_capable: true };
    if (p === '/api/nodes') return { ok: true, nodes, count: nodes.length };
    // A drive can hand in its own chat history (window.__chatTasksFixture = HubTask[]), e.g. long markdown replies.
    const chatTasks = window.__chatTasksFixture || tasks;
    if (p === '/api/tasks') return { ok: true, tasks: chatTasks.filter(t => !u.searchParams.get('to') || t.to_name === u.searchParams.get('to')) };
    if (p === '/api/task') return { ok: true, task: chatTasks[0], ...chatTasks[0] };
    if (p === '/api/task_events' || p === '/api/hub/task-events') return { ok: true, events: [] };
    if (p === '/api/messages') return { ok: true, messages: [], unread: 0, pending_count: 0 };
    if (p === '/api/scheduled-tasks') return { ok: true, schedules };
    if (/\/api\/scheduled-tasks\/[^/]+\/runs$/.test(p)) return { ok: true, runs: [] };
    if (p === '/api/host-supervisors') return { ok: true, count: daemons.length, daemons };
    if (p === '/api/side-threads/capability') return { ok: true, supported: false };
    if (p === '/api/side-threads') return { ok: true, side_threads: [], threads: [] };
    if (/\/external-schedule-edits$/.test(p)) return { ok: true, edits: [] };
    if (/\/api\/nodes\/[^/]+\/config$/.test(p)) return { ok: true, node_id: 'n_sweep_a', revision: 1, config: { model: 'model-x' } };
    if (p.startsWith('/api/events')) return null; // SSE: answer 404, the app falls back to polling
    return { ok: true };
  };
  let rid = 0; const reqs = new Map(); const bodies = new Map();
  // @tauri-apps/api's unlisten calls __TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener, which the real shell injects.
  // Without it, every listener torn down on unmount (e.g. leaving 任务) threw a TypeError that drives counted as a page error.
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
          const body = route(c.url, c.data ? new TextDecoder().decode(new Uint8Array(c.data)) : '');
          const buf = new TextEncoder().encode(body === null ? '{"ok":false}' : JSON.stringify(body));
          const id = ++rid; bodies.set(id, { buf, sent: false });
          return { status: body === null ? 404 : 200, statusText: 'OK', url: c.url, headers: [['content-type', 'application/json']], rid: id };
        }
        case 'plugin:http|fetch_read_body': {
          const b = bodies.get(args.rid);
          if (!b.sent) { b.sent = true; return [...b.buf, 0]; }
          return [1];
        }
        // Desktop opens 设置 (and other windows) as separate Tauri windows (desktop-settings-window.ts). The stub has one
        // page, so it records each request in window.__openedWindows — a drive opens that URL itself (openStubWindow).
        case 'plugin:window|get_all_windows': return ['main', ...(window.__openedWindows || []).map(w => w.label)];
        case 'plugin:webview|get_all_webviews': return [{ windowLabel: 'main', label: 'main' }, ...(window.__openedWindows || []).map(w => ({ windowLabel: w.label, label: w.label }))];
        case 'plugin:webview|create_webview_window': (window.__openedWindows ||= []).push({ label: args.options.label, url: args.options.url }); return null;
        default: return null;
      }
    },
  };
};

// The window the app asked the stub to open (label, e.g. 'settings'), opened as a second page of the same browser
// context — same origin, so localStorage is shared as between real windows of the app. `scripts` are the
// [fn, arg] init scripts the drive gave its main page (initScript first). Returns the page, or null if none was asked for.
export async function openStubWindow(page, label, scripts, { timeout = 5000 } = {}) {
  const req = await page.waitForFunction((l) => (window.__openedWindows || []).filter(w => w.label === l).pop() || null, label, { timeout }).then(h => h.jsonValue()).catch(() => null);
  if (!req) return null;
  const win = await page.context().newPage();
  for (const [fn, arg] of scripts) await win.addInitScript(fn, arg);
  await win.goto(new URL(req.url, page.url()).href);
  return win;
}

export function findChromium() {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
}

export const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// ── painted text ──────────────────────────────────────────────────────────────────────────────────
// A text check must look at the painted box, not textContent. 0.2.159–0.2.162 drew every task-list title 0px wide
// (react-native-web `flex: 0` = CSS `0 1 0%` + overflow:hidden) while textContent was still the title, so every
// text-only check stayed green (tests/test-task-title-visible, src/flex-zero-rule.test.ts).
//
// paintedText(page, selector, text?) → { w, h, text, painted } for the first rendered match (optionally the one whose
// textContent === text), or null. painted = the box is ≥ 1×1 and the text is not clipped to nothing by an
// overflow-hidden ancestor.
export const paintedText = (page, selector, text) => page.evaluate(([s, t]) => {
  const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length && (t === undefined || e.textContent === t));
  if (!el) return null;
  const b = el.getBoundingClientRect();
  let w = b.width, h = b.height;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = a.getBoundingClientRect();
    w = Math.min(w, Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)));
    h = Math.min(h, Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)));
  }
  return { w, h, text: el.textContent, painted: w >= 1 && h >= 1 };
}, [selector, text]);

// zeroSizeText(page) → the rendered elements (inside an optional root) that own a visible text node but are painted
// narrower / shorter than 1px — the exact title-blank shape. Skips what is meant to be unseen: visibility:hidden,
// opacity 0 (animation / measuring twins), aria-hidden subtrees and elements positioned off-screen.
export const zeroSizeText = (page, root) => page.evaluate((rootSel) => {
  const scope = rootSel ? document.querySelector(rootSel) : document.body;
  if (!scope) return [];
  const out = [];
  const unseen = (el) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0 || a.getAttribute('aria-hidden') === 'true') return true;
    }
    return false;
  };
  for (const el of scope.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.replace(/[\s​-‏﻿]/g, '')).map(n => n.textContent).join('');
    if (!own) continue;
    const b = el.getBoundingClientRect();
    if (b.width >= 1 && b.height >= 1) continue;
    if (b.right < 0 || b.bottom < 0 || b.left > innerWidth || b.top > innerHeight) continue;
    if (unseen(el)) continue;
    out.push(`${el.getAttribute('data-testid') || el.parentElement?.getAttribute('data-testid') || el.tagName.toLowerCase()} "${own.trim().slice(0, 20)}" ${Math.round(b.width * 10) / 10}×${Math.round(b.height * 10) / 10}`);
  }
  return out;
}, root ?? null);
