import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.env.WEB_DIR || resolve(here, '../../dist'));
const seed = () => [
  ...['ANet', 'Unrelated', ...Array.from({ length: 40 }, (_, i) => `Parent-${String(i).padStart(2, '0')}`)].map(name => ({ name, parent_id: null, depth: 1, registered: true, count: name === 'ANet' || name === 'Unrelated' ? 1 : 0 })),
  { name: 'Seed Child', parent_id: 'ANet', depth: 2, registered: true, count: 1 },
  { name: 'Seed Grandchild', parent_id: 'Seed Child', depth: 3, registered: true, count: 1 },
];
const requirements = [['fixture-task', 'ANet'], ['child-task', 'Seed Child'], ['grandchild-task', 'Seed Grandchild'], ['unrelated-task', 'Unrelated']].map(([id, tag]) => ({ id, name: id, column: 'pool', priority: 'normal', tags: [tag], owner: null, agent_owner: null, participants: [], description: '', checklist: [], createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' }));

export async function startServer() {
  const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
  const assets = [...index.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => ({ path: m[1], sha256: createHash('sha256').update(readFileSync(resolve(dist, `.${m[1]}`))).digest('hex') }));
  let nodes = seed(), old = false, failure = 0;
  const requests = [], writes = [], unhandled = [];
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1'), p = u.pathname;
    const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (p === '/__fixture/reset' && req.method === 'POST') { nodes = seed(); old = u.searchParams.get('old') === '1'; failure = 0; requests.length = writes.length = unhandled.length = 0; return json({ ok: true }); }
    if (p === '/__fixture/mode' && req.method === 'POST') { failure = Number(u.searchParams.get('status')); return json({ failure }); }
    if (p === '/__fixture/state') return json({ nodes, requirements, requests, writes, unhandled, assets, indexSha256: createHash('sha256').update(index).digest('hex') });
    if (p.startsWith('/api/')) {
      const entry = { method: req.method, path: p, query: u.search }; requests.push(entry);
      if (req.headers.authorization !== 'Bearer utok_local_fixture_only') return json({ error: 'fixture_token_required' }, 401);
      if (req.method === 'GET') {
        if (p === '/api/auth/me') return json({ ok: true, user: { user_id: 'self', username: 'fixture-viewer', role: 'user' }, current_network: 'net-fixture', networks: [{ network_id: 'net-fixture', network_name: 'Local Fixture', member_role: 'owner', agent_access: 'all' }] });
        if (p === '/api/requirements') return json({ ok: true, requirements, has_more: false, capabilities: ['tags', 'tag_ops', ...(old ? [] : ['tag_tree'])] });
        if (p === '/api/requirements/tags') return json({ ok: true, tags: ['ANet', 'Seed Child', 'Seed Grandchild', 'Unrelated'], counts: { ANet: 1, 'Seed Child': 1, 'Seed Grandchild': 1, Unrelated: 1 }, colors: {}, can_manage: true, ...(old ? {} : { nodes }) });
        if (p === '/api/requirements/projects') return json({ ok: true, projects: [] });
        if (p === '/api/requirements/people') return json({ ok: true, people: [], me: { kind: 'user', id: 'self' } });
        return json({ ok: true, tasks: [], messages: [], nodes: [], sessions: [], schedules: [], edits: [], networks: [], members: [], groups: [], requirements: [], unread: 0 });
      }
      let raw = ''; for await (const chunk of req) raw += chunk;
      let body; try { body = JSON.parse(raw || '{}'); } catch { return json({ error: 'invalid_json' }, 400); }
      if (p === '/api/requirements/tags/create' && req.method === 'POST') {
        const status = failure || 201;
        writes.push({ ...entry, body, status });
        if (failure) return json({ ok: false, error: ({ 403: 'tag_scope_denied', 404: 'tag_parent_not_found', 409: 'tag_exists' })[failure] }, status);
        const parent = nodes.find(n => n.name === body.parent_id);
        const tag = { name: body.name, parent_id: body.parent_id, depth: parent ? parent.depth + 1 : 1, registered: true, count: 0 };
        nodes.push(tag); return json({ ok: true, tag, parent_registered: false }, 201);
      }
      unhandled.push({ ...entry, body }); return json({ error: 'fixture_write_not_allowed' }, 405);
    }
    try {
      if (p === '/__fixture/bootstrap.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(readFileSync(resolve(here, '../scheduler-ui/bootstrap.js'), 'utf8') + '\n' + readFileSync(resolve(here, 'bootstrap.js'), 'utf8')); }
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:" });
        return res.end(index.replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>'));
      }
      const file = resolve(dist, `.${decodeURIComponent(p)}`);
      if (!file.startsWith(dist + sep) || !statSync(file).isFile()) return json({ error: 'not_found' }, 404);
      res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
    } catch { json({ error: 'not_found' }, 404); }
  });
  await new Promise((r, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', r); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
