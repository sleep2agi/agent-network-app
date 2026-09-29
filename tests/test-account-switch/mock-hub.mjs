// A tiny stand-in Hub for tests/test-account-switch/drive.mjs. Placeholder users / aliases only.
// Serves just what the signed-in phone shell reads, plus the user SSE stream, and counts open SSE
// connections so the driver can assert that switching accounts closes the old stream and opens the new one.
//   GET /__sse → { open: <number of open /events/users/me connections>, opened: <total ever opened> }
import { createServer } from 'node:http';

export function startMockHub({ name, username, password, token, networkId, agents, tasks }) {
  const streams = new Set();
  let opened = 0;
  const unknown = new Set();
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, accept, cache-control',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  };
  const json = (res, status, body) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (url.pathname === '/__sse') return json(res, 200, { open: streams.size, opened, unknown: [...unknown] });
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const body = JSON.parse(raw || '{}');
      if (body.username === username && body.password === password) return json(res, 200, { ok: true, token });
      return json(res, 401, { ok: false, error: 'invalid credentials' });
    }
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (auth !== token) return json(res, 401, { ok: false, error: 'invalid token' });
    if (url.pathname === '/events/users/me') {
      res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hello\n\n');
      streams.add(res); opened++;
      const ping = setInterval(() => res.write(': ping\n\n'), 5000);
      req.on('close', () => { clearInterval(ping); streams.delete(res); });
      return;
    }
    switch (url.pathname) {
      case '/api/auth/me':
        return json(res, 200, { ok: true, user: { user_id: `u_${name}`, username, role: 'member' }, networks: [{ network_id: networkId, network_name: `net-${name}`, member_role: 'owner' }], current_network: null });
      case '/api/networks':
        return json(res, 200, { ok: true, networks: [{ network_id: networkId, network_name: `net-${name}` }] });
      case '/api/status':
        return json(res, 200, { sessions: agents.map(alias => ({ alias, status: 'idle', agent: 'claude-code', updated_at: now, network_id: networkId, node_id: `node_${alias}` })) });
      case '/api/nodes':
        return json(res, 200, { ok: true, nodes: agents.map(alias => ({ node_id: `node_${alias}`, alias, node_name: alias, lifecycle_state: 'active', runtime: 'claude-code', network_id: networkId })), count: agents.length });
      case '/api/tasks':
        return json(res, 200, { tasks: tasks.map((content, i) => ({ task_id: `t_${name}_${i}`, from_name: username, to_name: agents[0], content, status: 'completed', result: `done ${content}`, created_at: now, updated_at: now, network_id: networkId })) });
      case '/api/messages':
        return json(res, 200, { ok: true, messages: [] });
      case '/api/version':
        return json(res, 200, { ok: true, version: '0.0.0-mock' });
      default:
        unknown.add(`${req.method} ${url.pathname}`);
        return json(res, 404, { ok: false, error: 'not in mock' });
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, sse: () => ({ open: streams.size, opened }), unknown: () => [...unknown], close: () => { for (const s of streams) s.destroy(); server.close(); } });
  }));
}
