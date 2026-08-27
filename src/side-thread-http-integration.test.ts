import fs from 'node:fs';
import http from 'node:http';
import { createSideThreadClient, SideThreadApiError } from './side-thread-api';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const golden = JSON.parse(fs.readFileSync('tests/test-btw-side-thread-ui/fixtures/golden.json', 'utf8'));
const seen: Array<{ method?: string; url?: string; authorization?: string; contentType?: string; body: string }> = [];

const server = http.createServer((req, response) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    seen.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      body,
    });
    response.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/api/side-threads/capability?')) {
      response.end(JSON.stringify(golden.capabilityResponse));
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/side-threads?')) {
      response.end(JSON.stringify({ ok: true, sideThreads: [golden.sideThreadEnvelope.sideThread], count: 1 }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/side-threads') {
      response.statusCode = 201;
      response.end(JSON.stringify(golden.sideThreadEnvelope));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: 'SIDE_THREAD_DISABLED' }));
  });
});

const listen = () => new Promise<number>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') reject(new Error('stub did not bind a TCP port'));
    else resolve(address.port);
  });
});

const close = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

const run = async () => {
  const port = await listen();
  try {
    const client = createSideThreadClient({
      serverUrl: `http://127.0.0.1:${port}`,
      token: 'atok_http_integration_secret',
      networkId: 'net_a',
    });
    const context = { sourceThreadId: 'source_thread', boundary: { kind: 'through' as const, turnId: 'source_turn' } };
    const capability = await client.capability('node / 中文', context);
    const listed = await client.list('node / 中文', 'node_1');
    const created = await client.create(golden.requests.create);

    const capabilityRequest = seen[0]!;
    const capabilityUrl = new URL(capabilityRequest.url!, `http://127.0.0.1:${port}`);
    check('生产 transport 命中 Hub capability route', capabilityUrl.pathname === '/api/side-threads/capability');
    check('capability scope 通过 URLSearchParams 编码且不串节点', capabilityUrl.searchParams.get('alias') === 'node / 中文'
      && capabilityUrl.searchParams.get('networkId') === 'net_a'
      && capabilityUrl.searchParams.get('sourceThreadId') === 'source_thread'
      && capabilityUrl.searchParams.get('boundaryKind') === 'through'
      && capabilityUrl.searchParams.get('boundaryTurnId') === 'source_turn');
    check('真实 HTTP 全程携带 Bearer，不把 token 放 URL/body', seen.every(request => request.authorization === 'Bearer atok_http_integration_secret'
      && !request.url?.includes('atok_http_integration_secret')
      && !request.body.includes('atok_http_integration_secret')));
    check('list route 携带 networkId/nodeId owner scope', (() => {
      const url = new URL(seen[1]!.url!, `http://127.0.0.1:${port}`);
      return url.pathname === '/api/side-threads' && url.searchParams.get('networkId') === 'net_a' && url.searchParams.get('nodeId') === 'node_1';
    })());
    check('真实 HTTP 解码 capability/list/create golden', capability.supported && listed[0]?.sideThreadId === 'sth_1' && created.question === 'Original question');
    const createRequest = seen[2]!;
    const createBody = JSON.parse(createRequest.body);
    check('create 命中 collection POST 并保留 question/attachments/requestKey', createRequest.method === 'POST'
      && createRequest.url === '/api/side-threads'
      && createRequest.contentType === 'application/json'
      && createBody.question === 'Original question'
      && createBody.attachments[0]?.fileId === 'file_ref_0001'
      && createBody.requestKey === 'create-request-0001');

    let disabled = false;
    try { await client.get('missing'); }
    catch (error) { disabled = error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_DISABLED' && error.status === 404; }
    check('真实 HTTP 非 SideThread route/error fail closed', disabled);
  } finally {
    await close();
  }
  console.log(`\n${passed}/${total} passed`);
  process.exitCode = passed === total ? 0 : 1;
};

void run();
