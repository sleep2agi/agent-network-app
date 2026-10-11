// Hub req #938 — clone a node on the same daemon.
import { readFileSync } from 'node:fs';
import { setLanguagePreference } from './i18n';
import { nodeCloneTranslations } from './i18n-node-clone';
import {
  CLONE_NODE_TOOL,
  CLONE_NOTE_KEYS,
  cloneAvailability,
  cloneDraft,
  cloneErrorKey,
  cloneResultMessageKey,
  interpretCloneReply,
  isCloneToolMissing,
  suggestCloneName,
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
ck('draft sends the expected clone_node fields and copy_session defaults on', draft.ok && JSON.stringify(Object.keys(draft.request).sort()) === JSON.stringify(['copy_session', 'daemon_node_id', 'name', 'source_node_id']) && draft.request.copy_session === true && draft.request.daemon_node_id === 'node_daemon' && draft.request.source_node_id === 'node_src' && draft.request.name === 'planner-copy-2');
ck('copy session can be turned off', cloneDraft({ source, name: 'planner-copy-2', copySession: false, taken }).ok && cloneDraft({ source, name: 'planner-copy-2', copySession: false, taken }).request?.copy_session === false);
ck('empty, same, taken, and illegal names are refused', !cloneDraft({ source, name: '  ', copySession: true, taken }).ok && cloneDraft({ source, name: 'planner', copySession: true, taken }).error === 'same' && cloneDraft({ source, name: 'planner-copy', copySession: true, taken }).error === 'taken' && cloneDraft({ source, name: 'a/b', copySession: true, taken }).error === 'invalid');

ck('managed child can be cloned', cloneAvailability({ nodeId: 'node_src', daemonNodeId: 'node_daemon' }).enabled);
ck('daemon itself, hand-started node, missing id, and loading stay closed', !cloneAvailability({ nodeId: 'node_d', daemonNodeId: 'node_d', hostSupervisor: true }).enabled && cloneAvailability({ nodeId: 'node_d', daemonNodeId: 'node_d', hostSupervisor: true }).reasonKey === 'nodeClone.reason.daemonSelf' && cloneAvailability({ nodeId: 'node_h', daemonNodeId: null }).reasonKey === 'nodeClone.reason.needsDaemon' && cloneAvailability({ nodeId: '', daemonNodeId: 'node_d' }).reasonKey === 'nodeClone.reason.noNode' && cloneAvailability({ pending: true, nodeId: 'node_src', daemonNodeId: 'node_daemon' }).reasonKey === 'nodeClone.reason.loading');

ck('tool-missing phrases are not business not-found errors', isCloneToolMissing('MCP error -32602: Tool clone_node not found') && isCloneToolMissing('unknown tool') && !isCloneToolMissing('source not found') && !isCloneToolMissing('source_not_found') && !isCloneToolMissing('node not found'));

const preview: CloneNodeArgs = { daemon_node_id: 'node_daemon', source_node_id: 'node_src', name: 'planner-copy-2', copy_session: true, network_id: 'net_1' };
const missing = interpretCloneReply({ kind: 'unsupported' }, preview);
const ok = interpretCloneReply({ kind: 'payload', payload: { ok: true, request_id: 'req_1' } }, preview);
const takenReply = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'name_taken', field: 'name' } }, preview);
const sessionReply = interpretCloneReply({ kind: 'payload', payload: { ok: false, error: 'copy_session_unavailable' } }, preview);
const rpcMissing = interpretCloneReply({ kind: 'error', error: 'Tool clone_node not found' }, preview);
const business = interpretCloneReply({ kind: 'error', error: 'source not found' }, preview);
ck('missing tool is a demo and keeps the preview', missing.demo === true && missing.ok === false && missing.preview.copy_session === true && missing.preview.name === 'planner-copy-2');
ck('json-rpc tool missing is the same demo', rpcMissing.demo === true && rpcMissing.ok === false);
ck('a real not-found string is not marked demo', business.ok === false && business.demo === false && business.error === 'source not found');
ck('accepted clone returns request_id and is not a demo', ok.ok === true && ok.demo === false && ok.request_id === 'req_1');
ck('name_taken maps to the taken copy', takenReply.ok === false && takenReply.demo === false && takenReply.errorKey === 'nodeClone.error.taken' && takenReply.field === 'name' && cloneErrorKey('copy_session_unavailable') === 'nodeClone.error.noSession' && sessionReply.errorKey === 'nodeClone.error.noSession');
ck('result copy differs for demo, copied session, and empty session', cloneResultMessageKey({ demo: true, copySession: true }) === 'nodeClone.demoAck' && cloneResultMessageKey({ demo: false, copySession: true }) === 'nodeClone.submitted.copy' && cloneResultMessageKey({ demo: false, copySession: false }) === 'nodeClone.submitted.fresh');
ck('three short notes are part of the dialog', CLONE_NOTE_KEYS.length === 3);

setLanguagePreference('zh');
ck('dialog title is 复制节点 and copy session defaults in the hint', nodeCloneTranslations['nodeClone.title'][0] === '复制节点' && nodeCloneTranslations['nodeClone.copySession'][0] === '复制会话' && nodeCloneTranslations['nodeClone.copySessionHint'][0].includes('默认开'));
ck('zh and en both have the demo mark and the three notes', nodeCloneTranslations['nodeClone.demoBadge'][0] === '演示' && nodeCloneTranslations['nodeClone.demoBadge'][1] === 'Demo' && CLONE_NOTE_KEYS.every(key => nodeCloneTranslations[key][0].length > 0 && nodeCloneTranslations[key][1].length > 0));
setLanguagePreference('en');

const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const daemon = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('./CloneNodeDialog.tsx', import.meta.url), 'utf8');
ck('node detail overview has the clone card and dialog', detail.includes('testID="node-clone-card"') && detail.includes('testID="node-clone-open"') && detail.includes('<CloneNodeDialog') && detail.includes('!readOnly'));
ck('daemon node list and selected node both open the same dialog', daemon.includes('testID={`daemon-mgmt-clone-${row.nodeId}`}') && daemon.includes('testID="daemon-mgmt-clone"') && daemon.includes('<CloneNodeDialog') && daemon.includes('daemonNodeId: daemon.node_id'));
ck('list row still opens chat from its own press', daemon.includes('onOpenManagedChat?.(row.alias)'));
ck('client calls the clone_node tool and marks a missing tool as demo', api.includes("params: { name: 'clone_node', arguments: preview }") && api.includes('isCloneToolMissing') && api.includes('interpretCloneReply'));
ck('dialog shows the name, the session switch defaulting on, and the notes', dialog.includes('testID="clone-node-name"') && dialog.includes('useState(true)') && dialog.includes('testID="clone-node-copy-session"') && dialog.includes('testID="clone-node-notes"') && dialog.includes('testID="clone-node-demo"') && dialog.includes('colors.card') && dialog.includes('colors.accent'));

setLanguagePreference('system');
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
