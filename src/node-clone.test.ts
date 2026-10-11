// Hub req #938 — clone a node on the same daemon. Contract: agent-network 5f8961c8.
import { readFileSync } from 'node:fs';
import { setLanguagePreference, t } from './i18n';
import { nodeCloneTranslations } from './i18n-node-clone';
import {
  CLONE_NODE_TOOL,
  CLONE_NOTE_KEYS,
  cloneAvailability,
  cloneDraft,
  cloneErrorKey,
  cloneNoticeMessage,
  interpretCloneReply,
  isCloneToolMissing,
  suggestCloneName,
  type CloneDialogResult,
  type CloneNodeArgs,
  type CloneSource,
} from './node-clone';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) passed++;
  else console.log('❌', name);
};

const source: CloneSource = { nodeId: 'node_src', alias: 'planner', name: 'planner', daemonNodeId: 'node_daemon' };
const taken = ['planner', 'planner-copy'];

ck('tool name is clone_node', CLONE_NODE_TOOL === 'clone_node');
ck('chinese source suggests 副本', suggestCloneName('测试', ['测试']) === '测试副本');
ck('ascii source suggests -copy and skips a taken suffix', suggestCloneName('planner', taken) === 'planner-copy-2');
ck('64-char name is trimmed so the suffix still fits', [...suggestCloneName('a'.repeat(64), [])].length <= 64 && suggestCloneName('a'.repeat(64), []).endsWith('-copy'));
ck('han name at the cap still validates', [...suggestCloneName('测'.repeat(64), [])].length <= 64 && suggestCloneName('测'.repeat(64), []).endsWith('副本'));

const draft = cloneDraft({ source, name: 'planner-copy-2', copySession: true, taken });
ck('draft sends daemon_node_id, source_node_id, name, copy_session, and workdir_policy', draft.ok && JSON.stringify(Object.keys(draft.request).sort()) === JSON.stringify(['copy_session', 'daemon_node_id', 'name', 'source_node_id', 'workdir_policy']) && draft.request.copy_session === true && draft.request.daemon_node_id === 'node_daemon' && draft.request.source_node_id === 'node_src' && draft.request.name === 'planner-copy-2' && draft.request.workdir_policy === 'new_empty');
ck('copy session can be turned off and share_source is explicit', cloneDraft({ source, name: 'planner-copy-2', copySession: false, workdirPolicy: 'share_source', taken }).ok && cloneDraft({ source, name: 'planner-copy-2', copySession: false, workdirPolicy: 'share_source', taken }).request?.copy_session === false && cloneDraft({ source, name: 'planner-copy-2', copySession: false, workdirPolicy: 'share_source', taken }).request?.workdir_policy === 'share_source');
ck('empty, same, taken, and illegal names are refused', !cloneDraft({ source, name: '  ', copySession: true, taken }).ok && cloneDraft({ source, name: 'planner', copySession: true, taken }).error === 'same' && cloneDraft({ source, name: 'planner-copy', copySession: true, taken }).error === 'taken' && cloneDraft({ source, name: 'a/b', copySession: true, taken }).error === 'invalid');

ck('managed child can be cloned', cloneAvailability({ nodeId: 'node_src', daemonNodeId: 'node_daemon' }).enabled);
ck('daemon itself, hand-started node, missing id, and loading stay closed', !cloneAvailability({ nodeId: 'node_d', daemonNodeId: 'node_d', hostSupervisor: true }).enabled && cloneAvailability({ nodeId: 'node_d', daemonNodeId: 'node_d', hostSupervisor: true }).reasonKey === 'nodeClone.reason.daemonSelf' && cloneAvailability({ nodeId: 'node_h', daemonNodeId: null }).reasonKey === 'nodeClone.reason.needsDaemon' && cloneAvailability({ nodeId: '', daemonNodeId: 'node_d' }).reasonKey === 'nodeClone.reason.noNode' && cloneAvailability({ pending: true, nodeId: 'node_src', daemonNodeId: 'node_daemon' }).reasonKey === 'nodeClone.reason.loading');

ck('tool-missing phrases are not business not-found errors', isCloneToolMissing('MCP error -32602: Tool clone_node not found') && isCloneToolMissing('unknown tool') && !isCloneToolMissing('source not found') && !isCloneToolMissing('node_not_found') && !isCloneToolMissing('cross_daemon_refused'));

const preview: CloneNodeArgs = { daemon_node_id: 'node_daemon', source_node_id: 'node_src', name: 'planner-copy-2', copy_session: true, workdir_policy: 'new_empty', network_id: 'net_1' };
const missing = interpretCloneReply({ kind: 'unsupported' }, preview);
const ok = interpretCloneReply({ kind: 'payload', payload: { ok: true, request_id: 'req_1', child_name: 'planner-copy-2', copy_session: true, workdir_policy: 'new_empty', session_contract: { mode: 'transcript_when_present', detail: 'copy the transcript if the file is still there' } } }, preview);
const bareOk = interpretCloneReply({ kind: 'payload', payload: { ok: true } }, preview);
const collision = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'node_name_conflict', reason: 'alias_taken', name: 'planner-copy-2' } }, preview);
const same = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'node_name_conflict', reason: 'same_as_source' } }, preview);
const inflight = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'node_name_conflict', reason: 'inflight_create' } }, preview);
const cross = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'cross_daemon_refused', source_daemon_node_id: 'node_other', requested_daemon_node_id: 'node_daemon' } }, preview);
const role = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'insufficient_role_for_create_node', required_role: 'admin' } }, preview);
const invented = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'name_taken' } }, preview);
const rpcMissing = interpretCloneReply({ kind: 'error', error: 'Tool clone_node not found' }, preview);
const business = interpretCloneReply({ kind: 'error', error: 'source not found' }, preview);
ck('missing tool is a demo and keeps the preview', missing.demo === true && missing.ok === false && missing.preview.copy_session === true && missing.preview.workdir_policy === 'new_empty' && missing.preview.name === 'planner-copy-2');
ck('json-rpc tool missing is the same demo', rpcMissing.demo === true && rpcMissing.ok === false);
ck('a real not-found string is not marked demo', business.ok === false && business.demo === false && business.error === 'source not found');
ck('ok true with request_id is pending, not a registered node', ok.ok === true && ok.demo === false && ok.pending === true && ok.request_id === 'req_1' && ok.child_name === 'planner-copy-2' && ok.sessionDetail === 'copy the transcript if the file is still there');
ck('ok true without request_id is a real error, not a demo and not success', bareOk.ok === false && bareOk.demo === false && bareOk.errorKey === 'nodeClone.error.unconfirmed');
ck('alias collision, same name, and inflight create stay real errors', collision.ok === false && collision.demo === false && collision.errorKey === 'nodeClone.error.taken' && same.errorKey === 'nodeClone.error.same' && inflight.errorKey === 'nodeClone.error.inflight');
ck('cross_daemon_refused and the create_node role code map, invented codes do not', cross.errorKey === 'nodeClone.error.crossDaemon' && role.errorKey === 'nodeClone.error.role' && cloneErrorKey('insufficient_role_for_create_node') === 'nodeClone.error.role' && invented.errorKey === null && cloneErrorKey('name_taken') === null && cloneErrorKey('copy_session_unavailable') === null && cloneErrorKey('cannot_clone_daemon') === 'nodeClone.error.daemonSelf' && cloneErrorKey('source_not_daemon_child') === 'nodeClone.error.notChild' && cloneErrorKey('workdir_policy_invalid') === 'nodeClone.error.workdir');
setLanguagePreference('zh');
const pendingNotice = cloneNoticeMessage({ demo: false, name: 'planner-copy-2', workdirPolicy: 'new_empty', sessionDetail: 'copy the transcript if the file is still there' }, t);
const shareNotice = cloneNoticeMessage({ demo: false, name: 'planner-copy-2', workdirPolicy: 'share_source', sessionDetail: null }, t);
ck('pending notice says the row was submitted and the node is not created yet', pendingNotice.includes('已提交，等待 Daemon 创建') && pendingNotice.includes('节点还没有注册') && pendingNotice.includes('copy the transcript if the file is still there') && shareNotice.includes('共用源节点的目录') && cloneNoticeMessage({ demo: true, name: 'planner-copy-2', workdirPolicy: 'new_empty', sessionDetail: null }, t) === t('nodeClone.demoAck'));
ck('three short notes are part of the dialog', CLONE_NOTE_KEYS.length === 3);

setLanguagePreference('zh');
ck('dialog title is 复制节点 and copy session defaults in the hint', nodeCloneTranslations['nodeClone.title'][0] === '复制节点' && nodeCloneTranslations['nodeClone.copySession'][0] === '复制会话' && nodeCloneTranslations['nodeClone.copySessionHint'][0].includes('默认开') && nodeCloneTranslations['nodeClone.submitted.pending'][0].includes('已提交，等待 Daemon 创建'));
ck('zh and en both have the demo mark, workdir modes, and the three notes', nodeCloneTranslations['nodeClone.demoBadge'][0] === '演示' && nodeCloneTranslations['nodeClone.demoBadge'][1] === 'Demo' && nodeCloneTranslations['nodeClone.workdir.new_empty'][0] === '新的空目录' && nodeCloneTranslations['nodeClone.workdir.share_source'][1] === 'Share the source directory' && CLONE_NOTE_KEYS.every(key => nodeCloneTranslations[key][0].length > 0 && nodeCloneTranslations[key][1].length > 0));
setLanguagePreference('en');

const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const daemon = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('./CloneNodeDialog.tsx', import.meta.url), 'utf8');
ck('node detail overview has the clone card and dialog', detail.includes('testID="node-clone-card"') && detail.includes('testID="node-clone-open"') && detail.includes('<CloneNodeDialog') && detail.includes('!readOnly') && detail.includes('cloneNoticeMessage'));
ck('daemon node list and selected node both open the same dialog', daemon.includes('testID={`daemon-mgmt-clone-${row.nodeId}`}') && daemon.includes('testID="daemon-mgmt-clone"') && daemon.includes('<CloneNodeDialog') && daemon.includes('daemonNodeId: daemon.node_id') && daemon.includes('outcome.pending'));
ck('list row still opens chat from its own press', daemon.includes('onOpenManagedChat?.(row.alias)'));
ck('client calls clone_node with the preview and only a missing tool is a demo', api.includes("params: { name: 'clone_node', arguments: preview }") && api.includes('workdir_policy: req.workdir_policy') && api.includes('isCloneToolMissing') && api.includes('interpretCloneReply') && api.includes("if (parsed.kind === 'malformed') return interpretCloneReply({ kind: 'error', error: 'clone_node response was not a tool result' }, preview);"));
ck('dialog shows the name, the session switch defaulting on, workdir modes, and the notes', dialog.includes('testID="clone-node-name"') && dialog.includes('useState(true)') && dialog.includes("useState<CloneWorkdirPolicy>('new_empty')") && dialog.includes('testID="clone-node-copy-session"') && dialog.includes('testID="clone-node-workdir"') && dialog.includes('testID={`clone-node-workdir-${policy}`}') && dialog.includes('testID="clone-node-notes"') && dialog.includes('testID="clone-node-demo"') && dialog.includes('colors.card') && dialog.includes('colors.accent') && dialog.includes('colors.tonalBg') && dialog.includes('pending: true'));

const sample: CloneDialogResult = { demo: false, pending: true, name: 'planner-copy-2', copySession: true, workdirPolicy: 'new_empty', sessionDetail: null };
ck('dialog result type stays pending until the daemon creates the node', sample.pending === true && sample.demo === false);

setLanguagePreference('system');
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
