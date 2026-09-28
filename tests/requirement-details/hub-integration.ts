import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequirementOnHub, listRequirements, migrateLocalRequirements, moveRequirementOnHub, RequirementsHubError } from '../../src/requirements-hub';

// Only run in the isolated Docker recipe documented alongside this file.
const dir = mkdtempSync(join(tmpdir(), 'requirements-integration-'));
process.env.COMMHUB_DB = join(dir, 'hub.db');
delete process.env.COMMHUB_AUTH_TOKEN;
delete process.env.COMMHUB_DEV_OPEN;
const hubRoot = '/tmp/qa/server/src';
const { register, addNetworkMember } = await import(`${hubRoot}/auth.ts`);
register('seed_admin', 'RequirementsAdmin123!', undefined, 'seed');
const owner = register('owner', 'RequirementsOwner123!', undefined, 'seed');
const viewer = register('viewer', 'RequirementsViewer123!', undefined, 'seed');
const stranger = register('stranger', 'RequirementsStranger123!', undefined, 'seed');
assert(owner.ok && viewer.ok && stranger.ok, 'isolated auth registration');
addNetworkMember(owner.network_id, viewer.user.user_id, 'viewer', owner.user.user_id);
const { bootServer } = await import(`${hubRoot}/server.ts`);
const server = bootServer({ port: 0, hostname: '127.0.0.1' });
const cfg = { serverUrl: `http://127.0.0.1:${server.port}`, token: owner.token, networkId: owner.network_id };
try {
  const created = await createRequirementOnHub(cfg, { name: '两端共享任务', priority: 'high', assignee: '负责人', due: '2026-10-01' });
  assert.equal(created.column, 'pool');
  assert((await listRequirements({ ...cfg })).some(row => row.id === created.id));
  console.log('PASS create through App transport and independent client read');
  await moveRequirementOnHub(cfg, created.id, 'doing');
  assert.equal((await listRequirements({ ...cfg })).find(row => row.id === created.id)?.column, 'doing');
  console.log('PASS move persists and second client observes it');
  const local = [{ ...created, id: 'legacy-local-card', name: '本地旧任务', column: 'done' as const }];
  await migrateLocalRequirements(cfg, () => [...local], rows => { local.splice(0, local.length, ...rows as typeof local); });
  assert.equal(local.length, 0);
  assert((await listRequirements(cfg)).some(row => row.name === '本地旧任务' && row.column === 'done'));
  const again = await createRequirementOnHub(cfg, { name: '本地旧任务', priority: 'high', assignee: '负责人', due: '2026-10-01', clientId: 'legacy-local-card' });
  assert.equal((await listRequirements(cfg)).filter(row => row.id === again.id).length, 1);
  assert.equal(again.column, 'done');
  console.log('PASS migration into nonempty Hub and retry idempotency');
  await assert.rejects(moveRequirementOnHub({ ...cfg, token: viewer.token }, created.id, 'done'), (error: unknown) => error instanceof RequirementsHubError && error.status === 403);
  assert.equal((await listRequirements(cfg)).find(row => row.id === created.id)?.column, 'doing');
  assert(!(await listRequirements({ ...cfg, token: stranger.token, networkId: stranger.network_id })).some(row => row.id === created.id));
  console.log('PASS viewer write denied without state change and foreign network cannot read');
  console.log('REAL HUB INTEGRATION PASS');
} finally {
  server.stop(true);
}
process.exit(0);
