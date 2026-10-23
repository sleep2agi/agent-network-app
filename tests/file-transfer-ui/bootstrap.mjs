export function bootstrap({ theme, browser = false }) {
  localStorage.clear();
  localStorage.setItem('theme_mode_v1', theme);
  localStorage.setItem('anet.language.v1', 'zh-CN');
  localStorage.setItem('voice_composer_input_mode_v1', 'keyboard');
  localStorage.setItem('anet.pooledHttp.off', '1');
  const profile = { serverUrl: location.origin, token: 'file_fixture_only', username: 'tester', profileId: 'file-fixture', displayName: 'tester', networkId: 'net-fixture' };
  const attachments = [
    { type: 'file', file_id: 'f_ppt00000001', name: 'Release-review-with-a-very-long-filename-for-extension-preservation.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 1258291 },
    { type: 'file', file_id: 'f_pdf00000001', name: 'Acceptance.pdf', mime: 'application/pdf', size: 2048 },
    { type: 'file', file_id: 'f_zip00000001', name: 'Empty.zip', mime: 'application/zip', size: 0 },
    { type: 'file', file_id: 'f_img00000001', name: 'Diagram.png', mime: 'image/png', size: 68 },
  ];
  const iso = new Date().toISOString();
  const sessions = ['Fixture-Agent', 'Other-Agent'].map((alias, i) => ({ alias, node_id: `node-fixture-${i}`, status: 'idle', runtime: 'agent-node', agent: 'claude-code', updated_at: iso, last_seen_at: iso, hostname: 'fixture', project_dir: '/fixture' }));
  const message = { message_id: 'dm-fixture-1', direction: 'in', from_session: 'peer', content: 'Received release files and diagram', created_at: iso, acked: 1, meta_json: JSON.stringify({ attachments }) };
  const task = { task_id: 'task-fixture-1', from_name: 'tester', to_name: 'Fixture-Agent', status: 'replied', content: 'Please review the release files', result: 'Release files received from the agent', created_at: iso, completed_at: iso, meta_json: JSON.stringify({ source: 'dashboard-chat', auth_origin: 'user', reply_attachments: attachments }) };
  const state = window.__fixture = { calls: [], requests: [], anchors: [], fail: { upload: 0, task: 0, download: 0 }, delay: { upload: 0, task: 0, download: 0 }, savePath: null, uploads: 0, attachments };
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const nativeFetch = fetch.bind(window);
  async function route(url, method = 'GET', headers, body) {
    const u = new URL(url, location.href), p = u.pathname;
    if (u.origin !== location.origin) throw new Error('External request prohibited');
    const entry = { path: p, query: u.search, method, authorization: new Headers(headers).get('authorization'), body: typeof body === 'string' ? body : body ? new TextDecoder().decode(new Uint8Array(body)) : '' };
    state.requests.push(entry);
    const json = (data, status = 200) => { entry.status = status; return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }); };
    if (p.startsWith('/api/') && entry.authorization !== 'Bearer file_fixture_only') return json({ error: 'fixture_auth_required' }, 401);
    if (p.startsWith('/api/files/')) {
      await new Promise(r => setTimeout(r, state.delay.download));
      if (state.fail.download-- > 0) return json({ error: 'fixture_download_failure' }, 503);
      entry.status = 200;
      return new Response(p.includes('img') ? png : p.includes('zip') ? new Uint8Array() : new TextEncoder().encode('LOCAL ACCEPTANCE FILE BYTES'), { headers: { 'content-type': p.includes('img') ? 'image/png' : 'application/octet-stream' } });
    }
    if (p === '/api/upload' && method === 'POST') {
      await new Promise(r => setTimeout(r, state.delay.upload));
      if (state.fail.upload-- > 0) return json({ ok: false, error: 'fixture_upload_failure' }, 500);
      return json({ ok: true, file_id: `f_uploaded${++state.uploads}`, url: `/api/files/f_uploaded${state.uploads}`, size: 26, mime: 'application/octet-stream' });
    }
    if (p === '/api/task' && method === 'POST') {
      await new Promise(r => setTimeout(r, state.delay.task));
      if (state.fail.task-- > 0) return json({ ok: false, error: 'fixture_send_failure' }, 503);
      return json({ ok: true, task_id: `sent-${state.uploads}` });
    }
    if (p === '/api/auth/me') return json({ ok: true, user: { user_id: 'self', id: 'self', username: 'tester' }, current_network: 'net-fixture', networks: [{ network_id: 'net-fixture', name: 'File Acceptance' }] });
    if (p === '/api/status') return json({ ok: true, sessions, files_capable: true });
    if (p === '/api/nodes') return json({ ok: true, nodes: sessions.map(s => ({ ...s, lifecycle_state: 'active' })) });
    if (p === '/api/tasks') return json({ ok: true, tasks: [task] });
    if (p.endsWith('/humans')) return json({ ok: true, humans: [{ user_id: 'peer', username: 'peer', display_name: 'Fixture Peer' }, { user_id: 'self', username: 'tester' }] });
    if (p === '/api/dm/threads') return json({ ok: true, threads: [{ other_user_id: 'peer', last_at: iso, unread: 1 }], group_threads: [{ group_id: 'group-fixture', name: 'Fixture Release Group', last_at: iso, unread: 1 }] });
    if (p === '/api/dm') return json({ ok: true, messages: [message] });
    if (p.endsWith('/chat-groups/group-fixture/messages')) return json({ ok: true, messages: [{ ...message, group_id: 'group-fixture', seq: 1, sender_user_id: 'peer' }], unread: 0, next_before: null });
    if (p.endsWith('/chat-groups/group-fixture')) return json({ ok: true, group: { id: 'group-fixture', name: 'Fixture Release Group', department_id: null, viewer_can: { post: true, manage: false } }, members: [{ user_id: 'self', username: 'tester' }, { user_id: 'peer', username: 'peer' }], is_member: true });
    if (p.endsWith('/chat-groups')) return json({ ok: true, groups: [{ id: 'group-fixture', name: 'Fixture Release Group' }] });
    if (p === '/health') return json({ ok: true, capabilities: ['chat_groups'] });
    if (p.includes('events')) return json({ ok: false }, 404);
    return json({ ok: true, supported: false, messages: [], tasks: [], networks: [{ network_id: 'net-fixture', name: 'File Acceptance' }], members: [], departments: [], requirements: [], unread: 0 });
  }
  window.fetch = (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
    if (u.origin !== location.origin) return Promise.reject(new Error('External fetch prohibited'));
    return u.pathname.startsWith('/api/') || u.pathname === '/health' ? route(u.href, init.method, init.headers, init.body) : nativeFetch(input, init);
  };
  window.WebSocket = class extends EventTarget { readyState = 3; static CLOSED = 3; send() {} close() {} };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { state.anchors.push({ href: this.href, download: this.download }); return click.call(this); };
  let rid = 0;
  const requests = new Map(), bodies = new Map(), files = new Map();
  if (browser) {
    const { profileId, ...webProfile } = profile;
    localStorage.setItem('hub_config_v1', JSON.stringify(webProfile));
    return;
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(cb) { const id = ++rid; window[`_${id}`] = cb; return id; },
    unregisterCallback(id) { delete window[`_${id}`]; }, convertFileSrc: p => p,
    async invoke(cmd, args = {}) {
      state.calls.push({ cmd, args });
      switch (cmd) {
        case 'load_active_desktop_profile': return JSON.stringify(profile);
        case 'save_desktop_profile': return JSON.stringify(profile);
        case 'read_desktop_profile_file': return files.get(args.relativePath) ?? null;
        case 'write_desktop_profile_file': files.set(args.relativePath, args.contents); return null;
        case 'get_theme_preference': return theme;
        case 'plugin:event|listen': return ++rid;
        case 'plugin:path|resolve_directory': return '/Fixture/Downloads/';
        case 'plugin:dialog|save': return state.savePath;
        case 'save_download': return args.targetPath || `/Fixture/Downloads/${args.name}`;
        case 'plugin:http|fetch': { const id = ++rid; requests.set(id, args.clientConfig); return id; }
        case 'plugin:http|fetch_send': {
          const c = requests.get(args.rid);
          const response = await route(c.url, c.method, c.headers, c.data);
          const id = ++rid; bodies.set(id, new Uint8Array(await response.arrayBuffer()));
          return { status: response.status, statusText: response.statusText, url: c.url, headers: [...response.headers], rid: id };
        }
        case 'plugin:http|fetch_read_body': { const b = bodies.get(args.rid); bodies.delete(args.rid); return b ? [...b, 0] : [1]; }
        default: return null;
      }
    },
  };
}
