import { createDashboardRequestId, dashboardRequestIdForLocalId, sendTask, type HubConfig } from './api';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const firstId = createDashboardRequestId();
const secondId = createDashboardRequestId();
check('Dashboard request ids use the Hub steering contract', /^dreq_[a-f0-9]{32}$/.test(firstId));
check('consecutive Dashboard request ids are distinct', firstId !== secondId);
check('a current dreq bubble keeps its request id on retry', dashboardRequestIdForLocalId(firstId) === firstId);
check('a legacy local bubble gets one stable valid request id',
  dashboardRequestIdForLocalId('local-123-1') === dashboardRequestIdForLocalId('local-123-1')
  && /^dreq_[a-f0-9]{32}$/.test(dashboardRequestIdForLocalId('local-123-1')));

const requests: any[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  requests.push(JSON.parse(String(init?.body ?? '{}')));
  return new Response(JSON.stringify({ ok: true, task_id: 'task-steer-1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

try {
  const cfg: HubConfig = {
    serverUrl: 'https://hub.example',
    token: 'utok_authenticated_user',
    networkId: 'net_1',
    username: 'admin',
  };
  await sendTask(cfg, 'codex-tui', 'please handle this now');
  await sendTask(cfg, 'codex-tui', 'keep this urgent', undefined, 'high');
  await sendTask(cfg, 'codex-tui', 'retry me once', undefined, 'normal', firstId);
} finally {
  globalThis.fetch = originalFetch;
}

check('chat sends declare authenticated Dashboard provenance', requests.every(
  request => request.meta?.source === 'dashboard-chat',
));
check('every send gets a valid client request id', requests.every(
  request => /^dreq_[a-f0-9]{32}$/.test(request.meta?.client_request_id),
));
check('separate sends never reuse the correlation id',
  requests[0].meta.client_request_id !== requests[1].meta.client_request_id);
check('sendTask honors the bubble correlation id across retries',
  requests[2].meta.client_request_id === firstId);
check('the client cannot self-assert the security boundary', requests.every(
  request => !Object.prototype.hasOwnProperty.call(request.meta, 'auth_origin'),
));
check('steering provenance is independent of queue priority',
  requests[0].priority === 'normal' && requests[1].priority === 'high'
  && requests[0].meta.source === requests[1].meta.source);

console.log(`dashboard Codex steer: ${passed}/${total} checks passed`);
