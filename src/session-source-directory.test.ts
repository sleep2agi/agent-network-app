// ck-style：#46bf69cd 目录只读契约（body 三字段/白名单/oses_ 不可当 fork session/unknown 标注/失败不发空目录）
import { strict as assert } from 'node:assert';
import {
  buildDirectoryBody, buildDirectorySelectBody, validateDirectoryRequest, pickSnapshot,
  parseDirectoryResponse, canUseAsForkSession, sessionBadge, gateClosedDirectoryMessage,
} from './session-source-directory';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };
const req = { networkId: 'net-sweep', sourceNodeId: 'n_src', daemonNodeId: 'd_1' };

// body 恰好三字段
const body = buildDirectoryBody(req);
ck('body keys exactly 3', JSON.stringify(Object.keys(body)) === JSON.stringify(['network_id', 'source_node_id', 'daemon_node_id']));
ck('select body adds server_id + selection_scope', JSON.stringify(Object.keys(buildDirectorySelectBody(req, 'osrv_00000000-0000-4000-8000-000000000000', 'srcdir_00000000-0000-4000-8000-000000000000'))) === JSON.stringify(['network_id', 'source_node_id', 'daemon_node_id', 'server_id', 'selection_scope']));
ck('no url/path/token in body', !/(url|path|token|secret)/i.test(Object.keys(body).join(',')));

// 校验
ck('valid request ok', validateDirectoryRequest(req).ok === true);
ck('missing daemon rejected', validateDirectoryRequest({ ...req, daemonNodeId: '' }).ok === false);

// 白名单：丢弃私有/原生字段
const snap = pickSnapshot({
  snapshot_id: 'snap_1', expires_at: 123, lease_kind: 'process_local', completeness: 'authorized_scope_only',
  servers: [{ server_id: 'osrv_1', title: 'S', raw_url: 'http://x' }],
  projects: [{ project_id: 'oprj_1', server_id: 'osrv_1', title: 'P', canonical: '/secret/path' }],
  sessions: [{ session_id: 'oses_1', project_id: 'oprj_1', title: 'T', activity: 'running', binding: 'unknown', attach_authorized: false, native_id: 'abc' }],
  native_cursor: 'zzz',
});
ck('snapshot parsed', !!snap && snap!.snapshotId === 'snap_1');
ck('server drops raw_url', !('raw_url' in (snap!.servers[0] as any)));
ck('project drops canonical path', !('canonical' in (snap!.projects[0] as any)));
ck('session drops native id', !('native_id' in (snap!.sessions[0] as any)));
ck('session binding forced unknown', snap!.sessions[0].binding === 'unknown');
ck('attach never authorized', snap!.sessions[0].attachAuthorized === false);

// 解析：ready 才有 snapshot；failed 不给空目录
const ready = parseDirectoryResponse({ ok: true, status: 'ready', snapshot: { snapshot_id: 'snap_2', sessions: [] } }, 'srcdir_1');
ck('ready parsed', ready.kind === 'ready');
const failed = parseDirectoryResponse({ ok: true, status: 'failed', error: 'directory_read_failed' }, 'srcdir_2');
ck('failed is failed not empty', failed.kind === 'failed');
const pending = parseDirectoryResponse({ ok: true, status: 'pending' }, 'srcdir_3');
ck('pending parsed', pending.kind === 'pending');
const unavailable = parseDirectoryResponse({ ok: false, error: 'source_directory_unavailable' }, 'srcdir_4');
ck('unavailable parsed', unavailable.kind === 'unavailable');

// 红线：oses_ 永远不能当 fork session
ck('oses_ rejected as fork session', canUseAsForkSession('oses_123') === false);
ck('ses_ accepted as fork session', canUseAsForkSession('ses_Abc123') === true);

// 展示口径
ck('running badge says binding unknown', /binding unknown/.test(sessionBadge({ sessionId: 'oses_1', projectId: 'p', title: 't', activity: 'running', binding: 'unknown', attachAuthorized: false })));
ck('unknown badge says candidate', /candidate/.test(sessionBadge({ sessionId: 'oses_2', projectId: 'p', title: 't', activity: 'unknown', binding: 'unknown', attachAuthorized: false })));

// gate 关闭
ck('gate message no fallback', /未开放/.test(gateClosedDirectoryMessage()) && /不会退回普通创建/.test(gateClosedDirectoryMessage()));

console.log(`${n}/${n} passed`);
process.exit(0);
