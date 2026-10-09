import assert from 'node:assert/strict';
import { fetchAuthMe, forgetAuthMe, putUserAvatar } from './user-admin-api';
const cfg = { serverUrl: 'http://fixture.invalid', token: 'dummy-a' };
let calls: Array<{ url: string; init?: RequestInit }> = [];
let receipt: unknown = { ok: true, user_id: 'u1', avatar_url: '/avatars/avatar-01.webp' };
let status = 200;
const original = globalThis.fetch;
globalThis.fetch = (async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify(init?.method === 'PUT' ? receipt : { user: { user_id: 'u1', avatar_url: null } }), { status });
}) as typeof fetch;
let count = 0;
const check = (name: string, condition: boolean) => { assert(condition, name); count++; console.log('PASS', name); };
try {
  forgetAuthMe();
  const b = { ...cfg, token: 'dummy-b' };
  await fetchAuthMe(cfg); await fetchAuthMe(b);
  check('saved receipt accepted', await putUserAvatar(cfg, 'u1', ' /avatars/avatar-01.webp ') === '/avatars/avatar-01.webp');
  const write = calls.find(x => x.init?.method === 'PUT')!;
  check('self route, no supplied user or network ID', write.url.endsWith('/api/auth/me/avatar') && write.init?.body === '{"avatar_url":"/avatars/avatar-01.webp"}');
  check('uses this account credential', (write.init?.headers as Record<string,string>).Authorization === 'Bearer dummy-a');
  const before = calls.length;
  await fetchAuthMe(b); check('other account cache preserved', calls.length === before);
  await fetchAuthMe(cfg); check('saving account cache invalidated', calls.length === before + 1);
  for (const bad of [{ ok: true, user_id: 'other', avatar_url: null }, { ok: true, user_id: 'u1' }, { ok: true, user_id: 'u1', avatar_url: 'wrong' }, { ok: false, user_id: 'u1', avatar_url: null }, null]) {
    receipt = bad; await assert.rejects(putUserAvatar(cfg, 'u1', null)); count++;
  }
  receipt = { ok: true, user_id: 'u1', avatar_url: null };
  check('clear requires explicit null receipt', await putUserAvatar(cfg, 'u1', null) === null);
  status = 404; await assert.rejects(putUserAvatar(cfg, 'u1', null), e => (e as {status:number}).status === 404); count++;
  status = 403; await assert.rejects(putUserAvatar(cfg, 'u1', null)); count++;
  const n = calls.length; await assert.rejects(putUserAvatar(cfg, '', null)); check('missing identity never sends', calls.length === n);
  console.log(`${count}/${count} passed`);
} finally { globalThis.fetch = original; forgetAuthMe(); }
