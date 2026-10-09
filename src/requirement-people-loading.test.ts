import assert from 'node:assert/strict';
import { listRequirementPeople, PEOPLE_LOAD_TIMEOUT_MS, RequirementPeopleError } from './requirement-people-api';
const cfg = { serverUrl: 'http://isolated.test', token: 'fixture', networkId: 'n1' };
const fetchBefore = globalThis.fetch, timerBefore = globalThis.setTimeout;
let count = 0;
const signals: AbortSignal[] = [];
let late: (response: Response) => void = () => {};
// Accelerate only the production deadline, not arbitrary test sleeps.
globalThis.setTimeout = ((fn: any, ms: number, ...args: any[]) => timerBefore(fn, ms === PEOPLE_LOAD_TIMEOUT_MS ? 30 : ms, ...args)) as typeof setTimeout;
try {
  globalThis.fetch = async (_url, init) => {
    count++; signals.push(init!.signal!);
    return new Promise<Response>(resolve => { late = resolve; }); // deliberately ignores abort
  };
  const a = listRequirementPeople(cfg), duplicate = listRequirementPeople({ ...cfg });
  assert.equal(a, duplicate);
  const otherNetwork = listRequirementPeople({ ...cfg, networkId: 'n2' });
  const otherUser = listRequirementPeople({ ...cfg, token: 'other' });
  const otherHub = listRequirementPeople({ ...cfg, serverUrl: 'http://other.test' });
  assert.equal(count, 4);
  const failures = await Promise.allSettled([a, duplicate, otherNetwork, otherUser, otherHub]);
  assert(failures.every(r => r.status === 'rejected' && r.reason instanceof RequirementPeopleError && r.reason.status === 408));
  assert(signals.every(signal => signal.aborted));
  late(Response.json({ people: [] })); // old native completion cannot populate a reusable cache

  globalThis.fetch = async () => { count++; return Response.json({ people: [{ kind: 'user', id: 'u1', name: 'Alice', networkId: 'n1' }] }); };
  assert.equal((await listRequirementPeople(cfg))[0].name, 'Alice');
  assert.equal(count, 5, 'timeout evicted; retry sends new request');
  await listRequirementPeople(cfg);
  assert.equal(count, 6, 'completed directories are not retained across requests');

  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response;
  await assert.rejects(listRequirementPeople(cfg), e => e instanceof RequirementPeopleError && e.status === 408);
  globalThis.fetch = async () => Response.json({}, { status: 403 });
  await assert.rejects(listRequirementPeople(cfg), /读取人员/);
  globalThis.fetch = async () => Response.json({ people: [{ kind: 'user', id: 'u1', name: 'other', networkId: 'n2' }] });
  await assert.rejects(listRequirementPeople(cfg), /当前网络/);
  globalThis.fetch = async () => Response.json({ people: [] });
  assert.deepEqual(await listRequirementPeople(cfg), []);
  console.log('people loading: concurrent identity isolation, fetch/body deadlines, abort, late response and retry passed');
} finally { globalThis.fetch = fetchBefore; globalThis.setTimeout = timerBefore; }
