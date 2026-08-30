import { sendTask, type HubConfig } from './api';
import { sendConfirmationFromResponse } from './actual-recipient';

const cfg: HubConfig = { serverUrl: 'https://hub.example', token: 'utok_fixture', networkId: 'net_a', username: 'admin' };
const original = globalThis.fetch;
try {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: false, queued: true, error: 'alias_offline', task_id: 'task_1',
    actual_to: { alias: 'canonical', to_node_id: null, network_id: 'net_a' },
  }), { status: 202, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const response = await sendTask(cfg, 'legacy-name', 'work');
  const notice = sendConfirmationFromResponse(response);
  if (!response.ok || !notice.queued || notice.actualRecipient?.alias !== 'canonical' || notice.actualRecipient.toNodeId !== null) {
    throw new Error('FAIL: real HTTP 202 queued response was not accepted and projected');
  }
  console.log('actual recipient HTTP 202: 1/1 checks passed');
} finally { globalThis.fetch = original; }
