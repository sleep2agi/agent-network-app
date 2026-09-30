// @ts-nocheck -- repository test scripts run directly under Bun.
// One /api/auth/me per hub + token: in-flight requests are shared, a success is reused for a
// minute, a failure is never cached. Every「我是谁」caller goes through it.
import { readFileSync } from 'node:fs';
import { fetchAuthMe, forgetAuthMe, AUTH_ME_TTL_MS } from './user-admin-api';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const orig = globalThis.fetch;
const origNow = Date.now;
let calls = 0;
let status = 200;
globalThis.fetch = (async (url: string, init: any) => {
  calls++;
  await sleep(10);
  return new Response(JSON.stringify(status === 200 ? { ok: true, user: { username: 'tester', user_id: 'u1' }, auth: init?.headers?.Authorization } : { ok: false, error: 'boom' }), { status, headers: { 'content-type': 'application/json' } });
}) as any;
try {
  const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_a' };
  forgetAuthMe();
  const [a, b, c] = await Promise.all([fetchAuthMe(cfg), fetchAuthMe(cfg), fetchAuthMe({ ...cfg })]);
  ck('three concurrent callers share one request', calls === 1 && a === b && b === c && a.user.username === 'tester');
  await fetchAuthMe(cfg);
  ck('a later caller within the TTL reuses the answer', calls === 1);
  await fetchAuthMe({ ...cfg, token: 'utok_b' });
  ck('another token asks the hub itself (identity is per token)', calls === 2);
  await fetchAuthMe({ ...cfg, serverUrl: 'http://other.invalid' });
  ck('another hub asks the hub itself', calls === 3);

  let now = origNow();
  Date.now = () => now;
  forgetAuthMe(); calls = 0;
  await fetchAuthMe(cfg);
  now += AUTH_ME_TTL_MS + 1;
  await fetchAuthMe(cfg);
  ck('after the TTL the next caller asks again', calls === 2);
  Date.now = origNow;

  forgetAuthMe(); calls = 0; status = 500;
  let failed = 0;
  await fetchAuthMe(cfg).catch(() => { failed++; });
  await fetchAuthMe(cfg).catch(() => { failed++; });
  ck('a failure is never cached: each caller asks again and sees the error', calls === 2 && failed === 2);
  status = 200;
  const ok = await fetchAuthMe(cfg);
  ck('…and the first success after it is used', calls === 3 && ok.user.user_id === 'u1');
} finally {
  globalThis.fetch = orig;
  Date.now = origNow;
}

// Every in-app「我是谁」read goes through the shared one (saved-session-probe checks OTHER accounts' tokens on purpose and stays direct).
const direct = ['ChatScreen.tsx', 'SettingsScreen.tsx', 'requirements-hub.ts', 'api.ts', 'AgentsScreen.tsx']
  .filter(f => /appFetch\([^)]*\/api\/auth\/me/.test(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')));
ck('no screen calls /api/auth/me directly any more', direct.length === 0);
for (const f of ['ChatScreen.tsx', 'SettingsScreen.tsx', 'requirements-hub.ts', 'api.ts', 'AgentsScreen.tsx']) {
  ck(`${f} uses the shared fetchAuthMe`, /fetchAuthMe\(cfg\)/.test(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')));
}

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
