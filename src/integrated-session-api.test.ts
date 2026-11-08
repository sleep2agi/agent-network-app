// Synthetic transport only: real API serializers, no Hub/native/network access.
import { strict as assert } from 'node:assert';
import { postSourceProjectCreate, postSessionSourceFork, type HubConfig } from './api';
import { validateSelection } from './session-source-fork';

const original = globalThis.fetch;
const requests: { url: string; body: Record<string, unknown> }[] = [];
let status = 200;
globalThis.fetch = (async (url, init) => {
  requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify({ ok: true, request_id: 'req_fixture', status: 'create_pending' }), { status });
}) as typeof fetch;
const cfg = { serverUrl: 'https://synthetic.invalid', token: 'synthetic-only', networkId: 'net_fixture' } as HubConfig;
const common = { selectionScope: 'srcdir_fixture', snapshotId: 'snap_fixture', childName: 'fixture-child', intentId: 'intent_fixture' };
let checks = 0;
const ck = (name: string, ok: boolean) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };
try {
  ck('newSession accepted', (await postSourceProjectCreate(cfg, { ...common, projectId: 'oprj_fixture' })).ok);
  assert.deepEqual(requests[0].body, { selection_scope: common.selectionScope, snapshot_id: common.snapshotId, project_id: 'oprj_fixture', child_name: common.childName, intent_id: common.intentId });
  ck('newSession exact five fields', Object.keys(requests[0].body).length === 5);
  ck('attach accepted', (await postSourceProjectCreate(cfg, { ...common, sessionId: 'oses_fixture' })).ok);
  assert.deepEqual(requests[1].body, { selection_scope: common.selectionScope, snapshot_id: common.snapshotId, session_id: 'oses_fixture', child_name: common.childName, intent_id: common.intentId });
  ck('attach exact five fields, opaque oses preserved', Object.keys(requests[1].body).length === 5);
  ck('mutually exclusive selectors rejected', !(await postSourceProjectCreate(cfg, { ...common, sessionId: 'oses_fixture', projectId: 'oprj_fixture' })).ok && requests.length === 2);
  ck('managed fork accepted', (await postSessionSourceFork(cfg, { networkId: 'net_fixture', sourceNodeId: 'node_fixture', sessionId: 'ses_fixture', childName: common.childName, intentId: common.intentId })).ok);
  assert.deepEqual(requests[2].body, { network_id: 'net_fixture', source_node_id: 'node_fixture', session_id: 'ses_fixture', mode: 'fork_independent', child_name: common.childName, intent_id: common.intentId });
  ck('managed fork separate endpoint and exact six fields', requests[2].url === `${cfg.serverUrl}/api/node-session-control/source` && Object.keys(requests[2].body).length === 6);
  // Fork UI owns validation before invoking its serializer; do not invent an API guard.
  ck('fork UI validator rejects directory oses', !validateSelection({ networkId: 'net_fixture', sourceNodeId: 'node_fixture', sessionId: 'oses_fixture', childName: common.childName, intentId: common.intentId }).ok);
  status = 404;
  const closed = await postSourceProjectCreate(cfg, { ...common, projectId: 'oprj_fixture' });
  ck('closed gate preserved, no fallback', !closed.ok && closed.unavailable === true && requests.length === 4);
} finally {
  globalThis.fetch = original;
}
console.log(`${checks}/${checks} checks passed`);
