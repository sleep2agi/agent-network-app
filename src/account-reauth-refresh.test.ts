import assert from 'node:assert/strict';
import { acceptProfileCredential, clearProfileUnauthorized, profileAuthRevision, reportProfileAuthResponse, verifyProfileCredentialWith } from './profile-auth-state';
import { createSessionStore } from './session-registry';

// Real session store / proof gate, synthetic credentials, no account/password mutation.
const data = new Map<string, string>();
const store = createSessionStore({ get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, del: async k => { data.delete(k); } }, { newId: () => 'verified-profile' });
const cfg = await store.save({ serverUrl: 'https://hub.example.test', username: 'tester', token: 'TEST-ONLY-current' });
const id = cfg.profileId!;
acceptProfileCredential(id, cfg.token);
let writes = 0;
const clear = async (revision: number) => {
  if (profileAuthRevision(id) !== revision) return false;
  writes++; await store.markReauth(id, false); clearProfileUnauthorized(id); return true;
};
await store.markReauth(id, true);
assert.equal((await store.loadIndex()).sessions[0].requiresReauth, true);
assert.equal(await verifyProfileCredentialWith(id, cfg.token, async () => true, clear), true);
assert.equal((await store.loadIndex()).sessions[0].requiresReauth, undefined);
assert.equal(writes, 1);

await store.markReauth(id, true);
for (const verify of [async () => false, async () => { throw Error('synthetic401/network failure'); }]) {
  assert.equal(await verifyProfileCredentialWith(id, cfg.token, verify, clear), false);
}
assert.equal(writes, 1);
assert.equal((await store.loadIndex()).sessions[0].requiresReauth, true);

let release!: (value: boolean) => void;
const pending = verifyProfileCredentialWith(id, cfg.token, () => new Promise(r => { release = r; }), clear);
reportProfileAuthResponse(401, id, undefined, cfg.token);
release(true);
assert.equal(await pending, false, 'later current-token401 outranks an older positive proof');
assert.equal(writes, 1);

acceptProfileCredential(id, 'TEST-ONLY-replacement');
assert.equal(await verifyProfileCredentialWith(id, cfg.token, async () => true, clear), false, 'old token cannot clear a replacement account state');
assert.equal(writes, 1);
const other = profileAuthRevision(id);
reportProfileAuthResponse(401, 'other-profile', undefined, 'TEST-ONLY-other');
assert.equal(profileAuthRevision(id), other, 'another profile does not invalidate this proof');
console.log('PASS current-account reauth refresh13 assertions: positive proof, failed/negative proof, later401, replacement and other profile');
