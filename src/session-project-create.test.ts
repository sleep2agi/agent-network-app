// ck-style：#4150 新会话（现有项目）契约：五字段 / 旧快照不可用 / unknown 语义 / 注册回执不称健康
import { strict as assert } from 'node:assert';
import {
  buildProjectCreateBody, validateProjectCreateSelection, canUseSnapshotForNewSession,
  classifyProjectCreate, projectCreateLabel,
} from './session-project-create';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };
const sel = { selectionScope: 'srcdir_abc-1', snapshotId: 'snap_1', projectId: 'oprj_9', childName: 'new-child', intentId: 'intent_1' };

const body = buildProjectCreateBody(sel);
const attach = buildProjectCreateBody({ ...sel, projectId: undefined, sessionId: 'oses_1' } as any);
ck('attach body uses session_id only', !!attach.session_id && !('project_id' in attach));
ck('both provided rejected', validateProjectCreateSelection({ ...sel, sessionId: 'oses_1' }).ok === false);
ck('neither provided rejected', validateProjectCreateSelection({ ...sel, projectId: undefined }).ok === false);
ck('oses_ accepted in attach branch', validateProjectCreateSelection({ ...sel, projectId: undefined, sessionId: 'oses_1' }).ok === true);
ck('body has exactly 5 contract keys', Object.keys(body).length === 5
  && ['selection_scope', 'snapshot_id', 'project_id', 'child_name', 'intent_id'].every(k => k in body));
ck('no network/daemon/native/token fields', !/(network|daemon|server|url|path|token|model|session_id)/i.test(Object.keys(body).join(',')));
ck('valid selection ok', validateProjectCreateSelection(sel).ok === true);
ck('server-only scope rejected (must be srcdir_)', validateProjectCreateSelection({ ...sel, selectionScope: 'osrv_x' }).ok === false);
ck('oses_ session id never used here', validateProjectCreateSelection({ ...sel, projectId: 'oses_x' }).ok === false);
ck('bad intent rejected', validateProjectCreateSelection({ ...sel, intentId: 'a b' }).ok === false);

// 快照可用性：必须带 selection_expires_at 且未过期
const now = 1_700_000_000_000;
ck('legacy snapshot (no selection_expires_at) refused', !canUseSnapshotForNewSession({ snapshot: { expiresAt: now + 30_000 }, hasProjectCreateCapability: true, now }).ok);
ck('expired selection refused', !canUseSnapshotForNewSession({ snapshot: { expiresAt: now + 30_000, selectionExpiresAt: now - 1 }, hasProjectCreateCapability: true, now }).ok);
ck('fresh selection allowed', canUseSnapshotForNewSession({ snapshot: { expiresAt: now + 30_000, selectionExpiresAt: now + 600_000 }, hasProjectCreateCapability: true, now }).ok);
ck('missing capability refused', !canUseSnapshotForNewSession({ snapshot: { selectionExpiresAt: now + 600_000 }, hasProjectCreateCapability: false, now }).ok);

// 状态语义
ck('registration_confirmed → registered', classifyProjectCreate('registration_confirmed', 'confirmed', 'node_prjc_1').kind === 'registered');
ck('registration label never says online/healthy', !/online|healthy|TUI ready/i.test(projectCreateLabel(classifyProjectCreate('registration_confirmed', 'confirmed'))));
ck('unknown_rotation_required → unknown', classifyProjectCreate('unknown_rotation_required').kind === 'unknown');
ck('session_creation=unknown on pending → unknown', classifyProjectCreate('delivery_pending', 'unknown').kind === 'unknown');
ck('unknown label says no replay', /禁止自动重放/.test(projectCreateLabel(classifyProjectCreate('unknown_rotation_required'))));
ck('progress label keeps status', /create_pending/.test(projectCreateLabel(classifyProjectCreate('create_pending', 'not_started'))));

console.log(`${n}/${n} passed`);
process.exit(0);
