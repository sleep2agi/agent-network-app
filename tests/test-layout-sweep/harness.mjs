// Shared plumbing for the layout sweep: static server for the expo web export, a Tauri stub that
// answers every hub request from placeholder data in-page (no hub process, no network, no port),
// and a Chromium launcher. Placeholder data only — aliases are 示例-A / 示例-B, never real nodes.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

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
  const RULES = '# 示例规则\n\n占位内容,只用于布局测量。\n\n## 第二节\n\n- 一\n- 二\n';
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
    if (p === '/api/auth/me') return { ok: true, user: { username: 'tester' }, current_network: 'net-sweep', networks: [{ network_id: 'net-sweep', name: 'sweep' }] };
    if (p === '/api/status') return { ok: true, sessions, files_capable: true };
    if (p === '/api/nodes') return { ok: true, nodes, count: nodes.length };
    if (p === '/api/tasks') return { ok: true, tasks: tasks.filter(t => !u.searchParams.get('to') || t.to_name === u.searchParams.get('to')) };
    if (p === '/api/task') return { ok: true, task: tasks[0], ...tasks[0] };
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
        default: return null;
      }
    },
  };
};

export function findChromium() {
  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const d of ['chromium-1234', 'chromium-1217', 'chromium-1208']) for (const p of [`${base}/${d}/chrome-linux64/chrome`, `${base}/${d}/chrome-linux/chrome`]) if (existsSync(p)) return p;
  return undefined;
}

export const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
