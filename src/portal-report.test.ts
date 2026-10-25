// 门户上报的纯逻辑:脱敏、两种鉴权、条数/体积上限。run: bun src/portal-report.test.ts
import { buildBody, capItems, clientInfo, describeFailure, headersFor, MAX_ITEMS_PER_BATCH, redactLog, redactSkill } from './portal-report';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

// ── 脱敏 ──
ck('log: token-shaped strings are redacted', !redactLog({ message: 'ntok_abcdef123456789 leaked' }).message.includes('abcdef123456789'));
ck('log: bearer header is redacted', !redactLog({ message: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x' }).message.includes('eyJhbGciOiJIUzI1NiJ9'));
ck('log: unknown level falls back to info', redactLog({ level: 'debug' as never }).level === 'info');
ck('log: message is capped to 500 chars', redactLog({ message: 'x'.repeat(2000) }).message.length === 500);
ck('skill: only whitelisted fields survive', (() => {
  const out = redactSkill({ name: 'deploy', source: 'skillhub', enabled: true, version: '1.2.3', secret: 'nope' } as never) as Record<string, unknown>;
  return Object.keys(out).sort().join(',') === 'enabled,name,source,version';
})());
ck('skill: enabled is strict boolean', redactSkill({ enabled: 'yes' as never }).enabled === false);

// ── 鉴权 ──
ck('anonymous: no authorization header', !('authorization' in headersFor({ mode: 'anonymous' })));
ck('pat: bearer header carries the token', headersFor({ mode: 'pat', token: 'abc123' }).authorization === 'Bearer abc123');
ck('pat: blank token degrades to anonymous', !('authorization' in headersFor({ mode: 'pat', token: '   ' })));

// ── 上限 ──
ck('cap: over-limit items are dropped and counted', (() => { const r = capItems(Array.from({ length: MAX_ITEMS_PER_BATCH + 5 }, (_, i) => i)); return r.items.length === MAX_ITEMS_PER_BATCH && r.dropped === 5; })());
ck('cap: under-limit keeps everything', capItems([1, 2, 3]).dropped === 0);
ck('body: carries client info, batch id and drop count', (() => {
  const { body } = buildBody('logs', clientInfo('android', 'zh'), [{ a: 1 }], 1_700_000_000_000);
  return body.kind === 'logs' && body.batch_id.startsWith('b') && body.client.app === 'anet-client' && typeof body.dropped === 'number';
})());
ck('body: oversized payload is flagged, not silently sent', buildBody('logs', clientInfo('android', 'zh'), Array.from({ length: 200 }, () => ({ m: 'x'.repeat(5000) }))).tooBig);

// ── 错误文案 ──
ck('401/403 → bad PAT copy', describeFailure(401) === 'portalReport.badPat' && describeFailure(403) === 'portalReport.badPat');
ck('413 → too big copy', describeFailure(413) === 'portalReport.tooBig');
ck('429 → rate limited copy', describeFailure(429) === 'portalReport.rateLimited');
ck('5xx → server copy', describeFailure(503) === 'portalReport.server');

console.log(`portal report: ${p}/${t}`);
if (p !== t) process.exit(1);
