// A stand-in Hub for tests/test-change-password/drive.mjs. Placeholder user / password / tokens only; never a real hub.
// Mirrors what agent-network's hub does for #653 (server/src/auth.ts + server.ts):
//   POST /api/auth/login     → weak password (< 8 chars or on the weak list) adds must_change_password: true
//   POST /api/auth/password  → { old_password, new_password }:
//        new too short  → 400 "new password must be at least 8 characters"
//        new too common → 400 "new password is too common"
//        old wrong      → 400 "incorrect current password"
//        ok             → revokes every other user token AND the calling one, returns { ok, revoked, token, token_id }
// Control endpoints for the driver (no auth): GET /__calls, GET /__state.
import { createServer } from 'node:http';

const WEAK = new Set(['123456', 'password', '12345678', 'qwerty', 'password123', 'qwerty123', 'iloveyou', 'sunshine', 'admin', 'anethub']);
const strength = (pw) => (!pw || pw.length < 8 ? 'new password must be at least 8 characters' : WEAK.has(pw.toLowerCase()) ? 'new password is too common' : null);

export function startMockHub({ username, password, networkId = 'net_mock', agents = ['示例-A'], otherDevices = 2 }) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, accept, cache-control',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  };
  const json = (res, status, body) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let current = password;
  let mustChange = false;
  let seq = 0;
  const tokens = new Set(Array.from({ length: otherDevices }, (_, i) => `utok_mock_other_${i}`));
  const calls = [];
  const issue = () => { const t = `utok_mock_${++seq}`; tokens.add(t); return t; };
  const readBody = async (req) => { let raw = ''; for await (const c of req) raw += c; try { return JSON.parse(raw || '{}'); } catch { return {}; } };
  const now = new Date().toISOString();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (url.pathname === '/__calls') return json(res, 200, { calls });
    if (url.pathname === '/__state') return json(res, 200, { tokens: tokens.size, mustChange, passwordIsWeak: !!strength(current) });
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      calls.push({ what: 'login' });
      if (body.username !== username || body.password !== current) return json(res, 401, { ok: false, error: 'invalid username or password' });
      if (strength(body.password)) mustChange = true;
      const token = issue();
      return json(res, 200, { ok: true, user: { user_id: 'u_mock', username, role: 'admin' }, token, token_id: token.slice(5), network_id: networkId, ...(mustChange ? { must_change_password: true } : {}) });
    }
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth || !tokens.has(auth)) {
      if (url.pathname !== '/events/users/me') calls.push({ what: 'unauthorized', path: url.pathname });
      return json(res, 401, { ok: false, error: 'invalid token' });
    }
    if (url.pathname === '/api/auth/password' && req.method === 'POST') {
      const body = await readBody(req);
      calls.push({ what: 'password', keys: Object.keys(body).sort().join(',') });
      const weak = strength(body.new_password);
      if (weak) return json(res, 400, { ok: false, error: weak });
      if (body.old_password !== current) return json(res, 400, { ok: false, error: 'incorrect current password' });
      current = body.new_password;
      mustChange = false;
      const revoked = tokens.size - 1;
      tokens.clear();
      const token = issue();
      return json(res, 200, { ok: true, revoked, token, token_id: token.slice(5) });
    }
    if (url.pathname === '/events/users/me') {
      res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hello\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 5000);
      req.on('close', () => clearInterval(ping));
      return;
    }
    switch (url.pathname) {
      case '/api/auth/me':
        return json(res, 200, { ok: true, user: { user_id: 'u_mock', username, role: 'admin' }, networks: [{ network_id: networkId, network_name: 'net-mock', member_role: 'owner' }], current_network: null, credential: { kind: 'user' } });
      case '/api/networks':
        return json(res, 200, { ok: true, networks: [{ network_id: networkId, network_name: 'net-mock' }] });
      case '/api/status':
        return json(res, 200, { sessions: agents.map(alias => ({ alias, status: 'idle', agent: 'claude-code', updated_at: now, network_id: networkId, node_id: `node_${alias}` })) });
      case '/api/nodes':
        return json(res, 200, { ok: true, nodes: agents.map(alias => ({ node_id: `node_${alias}`, alias, node_name: alias, lifecycle_state: 'active', runtime: 'claude-code', network_id: networkId })), count: agents.length });
      case '/api/auth/sessions':
        return json(res, 200, { ok: true, sessions: [...tokens].map(t => ({ token_id: t.slice(5), name: 'user-login', created_at: now, last_used_at: now, client_label: null, user_agent: null, is_current: t === auth })), current_token_id: auth.slice(5), idle_timeout_days: 30 });
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
    resolve({ url, calls: () => calls, state: () => ({ tokens: tokens.size, mustChange }), close: () => server.close() });
  }));
}
