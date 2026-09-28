import assert from 'node:assert/strict';
import { assignmentsFromHub, listRequirementPeople, saveRequirementAssignments, RequirementPeopleError } from './requirement-people-api';
const cfg = { serverUrl: 'http://isolated.test', token: 'fixture', networkId: 'net-a' };
const original = globalThis.fetch;
const requests: { url: string; body: any }[] = [];
let response: unknown = {};
let status = 200;
globalThis.fetch = async (input, init) => {
  requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
  return Response.json(response, { status });
};
try {
  const refs = [{ kind: 'user' as const, id: 'same' }, { kind: 'node' as const, id: 'same' }];
  assert.deepEqual(assignmentsFromHub({ owner: null, participants: [...refs, refs[0]] }), { owner: null, participants: refs });
  assert.throws(() => assignmentsFromHub({ assignee: 'old text' }), error => error instanceof RequirementPeopleError && error.status === 501);
  assert.throws(() => assignmentsFromHub({ owner: null, participants: [{ kind: 'admin', id: 'x' }] }));
  response = { people: [{ ...refs[0], networkId: 'net-b', name: 'foreign' }] };
  await assert.rejects(listRequirementPeople(cfg));
  response = { people: [{ ...refs[0], networkId: 'net-a', name: '人类' }, { ...refs[1], networkId: 'net-a', name: 'Agent' }] };
  assert.equal((await listRequirementPeople(cfg)).length, 2);
  response = { requirement: { owner: refs[0], participants: refs } };
  assert.deepEqual(await saveRequirementAssignments(cfg, 'r/1', { owner: refs[0], participants: refs }), response.requirement);
  assert(requests.at(-1)!.url.endsWith('/api/requirements/r%2F1?network_id=net-a'));
  response = { requirement: { owner: null, participants: [] } };
  await saveRequirementAssignments(cfg, 'r1', { owner: null, participants: [] });
  assert.deepEqual(requests.at(-1)!.body, { owner: null, participants: [] });
  response = { requirement: { id: 'r1', assignee: '' } };
  await assert.rejects(saveRequirementAssignments(cfg, 'r1', { owner: null, participants: [] }), error => error instanceof RequirementPeopleError && error.status === 501);
  status = 403;
  await assert.rejects(saveRequirementAssignments(cfg, 'r1', { owner: null, participants: [] }), error => error instanceof RequirementPeopleError && error.status === 403);
  const before = requests.length;
  await assert.rejects(listRequirementPeople({ ...cfg, networkId: undefined }));
  assert.equal(requests.length, before);
  console.log('requirement people API: 12 assertions passed');
} finally { globalThis.fetch = original; }
