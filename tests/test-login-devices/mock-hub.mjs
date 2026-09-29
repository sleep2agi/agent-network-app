// A stand-in Hub for tests/test-login-devices/drive.mjs. Placeholder users / aliases / tokens only; never a real hub.
// Serves what the signed-in shell reads, plus the login-session API of agent-network's hub:
//   GET    /api/auth/sessions               → { ok, sessions[], current_token_id, idle_timeout_days }
//   POST   /api/auth/sessions/revoke-others → { ok, revoked, kept_token_id }
//   DELETE /api/auth/sessions/:id           → { ok, was_current }
// legacy: true  → behaves like a hub from before that API: unknown paths get the 200 text/plain help page (measured on
//                 0.9.0-preview.68), so the app must hide the entry.
// Control endpoints for the driver (no auth):
//   POST /__expire       → the token issued last now gets 401 { error: "token_expired" } everywhere
//   GET  /__calls        → the session API calls seen so far
import { createServer } from 'node:http';

export function startMockHub({ name, username, password, networkId, agents, legacy = false, others = [] }) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, accept, cache-control',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  };
  const json = (res, status, body) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const utc = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
  const now = utc(0);
  // token → session row
  const sessions = new Map();
  let seq = 0;
  for (const o of others) {
    const id = `tok_${name}_other${seq++}`;
    sessions.set(`utok_${id}`, { token_id: id, name: 'user-login', created_at: utc(o.createdAgo ?? 86400_000 * 10), last_used_at: o.usedAgo == null ? null : utc(o.usedAgo), client_label: o.label ?? null, user_agent: o.ua ?? null });
  }
  const expired = new Set();
  const calls = [];
  let lastIssued = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (url.pathname === '/__calls') return json(res, 200, { calls });
    if (url.pathname === '/__expire' && req.method === 'POST') { if (lastIssued) expired.add(lastIssued); return json(res, 200, { ok: true, expired: lastIssued }); }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const body = JSON.parse(raw || '{}');
      if (body.username !== username || body.password !== password) return json(res, 401, { ok: false, error: 'invalid username or password' });
      const id = `tok_${name}_${seq++}`;
      const token = `utok_${id}`;
      sessions.set(token, { token_id: id, name: 'user-login', created_at: now, last_used_at: now, client_label: legacy ? null : (body.client_label ?? null), user_agent: req.headers['user-agent'] ?? null });
      lastIssued = token;
      calls.push({ what: 'login', client_label: body.client_label ?? null });
      return json(res, 200, legacy ? { ok: true, token } : { ok: true, token, token_id: id });
    }
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (auth && expired.has(auth)) return json(res, 401, { ok: false, error: 'token_expired', message: 'login session expired after inactivity; sign in again' });
    const me = auth && sessions.get(auth);
    if (!me) return json(res, 401, { ok: false, error: 'invalid token' });
    if (url.pathname === '/events/users/me') {
      res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hello\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 5000);
      req.on('close', () => clearInterval(ping));
      return;
    }
    if (url.pathname.startsWith('/api/auth/sessions')) {
      if (legacy) { res.writeHead(200, { ...cors, 'content-type': 'text/plain; charset=utf-8' }); res.end('CommHub MCP Server v0.9.0-preview.68 (Streamable HTTP + SSE Push)\n\nEndpoints:\n  POST /mcp\n'); return; }
      calls.push({ what: `${req.method} ${url.pathname}` });
      if (url.pathname === '/api/auth/sessions' && req.method === 'GET') {
        const list = [...sessions.entries()].map(([tok, s]) => ({ ...s, is_current: tok === auth }));
        return json(res, 200, { ok: true, sessions: list, current_token_id: me.token_id, idle_timeout_days: 30 });
      }
      if (url.pathname === '/api/auth/sessions/revoke-others' && req.method === 'POST') {
        let n = 0; for (const tok of [...sessions.keys()]) if (tok !== auth) { sessions.delete(tok); n++; }
        return json(res, 200, { ok: true, revoked: n, kept_token_id: me.token_id });
      }
      const m = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)$/);
      if (m && req.method === 'DELETE') {
        const id = decodeURIComponent(m[1]);
        const hit = [...sessions.entries()].find(([, s]) => s.token_id === id);
        if (!hit) return json(res, 404, { ok: false, error: 'session_not_found' });
        sessions.delete(hit[0]);
        return json(res, 200, { ok: true, was_current: hit[0] === auth });
      }
    }
    switch (url.pathname) {
      case '/api/auth/me':
        return json(res, 200, { ok: true, user: { user_id: `u_${name}`, username, role: 'member' }, networks: [{ network_id: networkId, network_name: `net-${name}`, member_role: 'owner' }], current_network: null, credential: { kind: 'user' } });
      case '/api/networks':
        return json(res, 200, { ok: true, networks: [{ network_id: networkId, network_name: `net-${name}` }] });
      case '/api/status':
        return json(res, 200, { sessions: agents.map(alias => ({ alias, status: 'idle', agent: 'claude-code', updated_at: now, network_id: networkId, node_id: `node_${alias}` })) });
      case '/api/nodes':
        return json(res, 200, { ok: true, nodes: agents.map(alias => ({ node_id: `node_${alias}`, alias, node_name: alias, lifecycle_state: 'active', runtime: 'claude-code', network_id: networkId })), count: agents.length });
      case '/api/tasks':
        return json(res, 200, { tasks: [] });
      case '/api/messages':
        return json(res, 200, { ok: true, messages: [] });
      case '/api/version':
        return json(res, 200, { ok: true, version: '0.0.0-mock' });
      default:
        return json(res, 404, { ok: false, error: 'not in mock' });
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, calls: () => calls, sessionCount: () => sessions.size, close: () => server.close() });
  }));
}
