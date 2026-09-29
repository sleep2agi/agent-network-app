// @ts-nocheck -- repository test scripts run directly under Bun.
// Conditional GET for the 任务 list: remember the hub's ETag, send If-None-Match, reuse the body on
// 304. An old hub (no ETag) must see exactly the old requests.
import { listRequirementsFull, __resetRequirementsConditionalCache } from './requirements-hub';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_a', networkId: 'net-a' };
const rowsV1 = [{ id: 'r1', name: '卡片一', column: 'pool', priority: 'normal', createdAt: '2026-09-30T00:00:00Z' }];
const rowsV2 = [{ id: 'r1', name: '卡片一(改)', column: 'doing', priority: 'normal', createdAt: '2026-09-30T00:00:00Z' }];

const orig = globalThis.fetch;
const seen: { url: string; inm: string | null }[] = [];
let server: (inm: string | null) => Response;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const inm = new Headers(init?.headers).get('if-none-match');
  seen.push({ url: String(url), inm });
  return server(inm);
}) as any;
const json = (rows: unknown[], etag?: string) => new Response(JSON.stringify({ ok: true, requirements: rows, capabilities: ['projects'] }), { status: 200, headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) } });

try {
  // ── new hub ──
  __resetRequirementsConditionalCache();
  let current = { etag: 'W/"v1"', rows: rowsV1 };
  server = (inm) => inm === current.etag ? new Response(null, { status: 304, headers: { etag: current.etag } }) : json(current.rows, current.etag);

  const first = await listRequirementsFull(cfg);
  ck('first read has no If-None-Match and returns the list', seen[0].inm === null && first.rows[0]?.name === '卡片一');
  const second = await listRequirementsFull(cfg);
  ck('next read sends the remembered ETag', seen[1].inm === 'W/"v1"');
  ck('304 → the remembered list, capabilities included', second.rows[0]?.name === '卡片一' && second.capabilities.includes('projects'));

  current = { etag: 'W/"v2"', rows: rowsV2 };
  const third = await listRequirementsFull(cfg);
  ck('changed list → full 200 with the new rows', seen[2].inm === 'W/"v1"' && third.rows[0]?.name === '卡片一(改)' && third.rows[0]?.column === 'doing');
  await listRequirementsFull(cfg);
  ck('…and the new ETag is remembered', seen[3].inm === 'W/"v2"');

  // Separate accounts / hubs never share a remembered body.
  await listRequirementsFull({ ...cfg, token: 'utok_b' });
  ck('another token starts without If-None-Match', seen[4].inm === null);

  // ── old hub: no ETag at all ──
  __resetRequirementsConditionalCache();
  seen.length = 0;
  server = () => json(rowsV1);
  await listRequirementsFull(cfg);
  await listRequirementsFull(cfg);
  ck('old hub (no ETag): never sends If-None-Match', seen.length === 2 && seen.every(s => s.inm === null));

  // A hub that stops sending ETag (downgrade) drops the remembered one.
  __resetRequirementsConditionalCache();
  seen.length = 0;
  server = () => json(rowsV1, 'W/"v1"');
  await listRequirementsFull(cfg);
  server = () => json(rowsV2);
  await listRequirementsFull(cfg);
  await listRequirementsFull(cfg);
  ck('hub downgraded (ETag gone) → stops sending If-None-Match', seen[2].inm === null);

  // An unexpected 304 without a remembered body is an error, not an empty board.
  __resetRequirementsConditionalCache();
  server = () => new Response(null, { status: 304 });
  let err = null;
  try { await listRequirementsFull(cfg); } catch (e) { err = e; }
  ck('304 with nothing remembered surfaces as an error', !!err && /304/.test(String(err?.message)));
} finally {
  globalThis.fetch = orig;
}

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
