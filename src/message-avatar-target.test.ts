import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { messageAvatarAuthor, messageAvatarTarget } from './message-avatar-target';

const nodes = [
  { networkId: 'a', nodeId: 'n1', alias: 'same' },
  { networkId: 'b', nodeId: 'n2', alias: 'same' },
  { networkId: 'a', nodeId: 'n3', alias: 'recipient' },
];
const users = [{ networkId: 'a', userId: 'u1', username: 'same' }];
const resolve = (author: Parameters<typeof messageAvatarTarget>[0]['author'], networkId = 'a') =>
  messageAvatarTarget({ networkId, author, nodes, users });

assert.deepEqual(resolve({ label: 'same' }), { kind: 'unresolved' });
assert.deepEqual(resolve({ nodeId: 'n1', label: 'renamed' }), { kind: 'node', ...nodes[0] });
assert.deepEqual(resolve({ userId: 'u1' }), { kind: 'user', ...users[0] });
assert.deepEqual(resolve({ nodeId: 'n2', label: 'same' }), { kind: 'unresolved' });
assert.deepEqual(resolve({ nodeId: 'deleted', label: 'recipient' }), { kind: 'unresolved' });
assert.deepEqual(resolve({ nodeId: 'n1', userId: 'u1' }), { kind: 'unresolved' });
assert.deepEqual(resolve({ label: 'same' }, 'b'), { kind: 'node', ...nodes[1] });
assert.deepEqual(resolve({ label: 'recipient' }), { kind: 'node', ...nodes[2] });
assert.deepEqual(resolve({}), { kind: 'unresolved' });
assert.deepEqual(resolve({ nodeId: 'n1' }, ''), { kind: 'unresolved' });
console.log('message-avatar-target: 10 identity cases passed');

const author = (part: 'sent' | 'reply', outgoing: boolean, row: Parameters<typeof messageAvatarAuthor>[0]['row'], currentUserId?: string) =>
  messageAvatarAuthor({ part, outgoing, row, currentAlias: 'same', currentUserId });
assert.deepEqual(resolve(author('reply', true, { to_name: 'recipient' })), { kind: 'node', ...nodes[2] });
assert.deepEqual(author('reply', true, { to_node_id: 'n3', to_name: 'same' }), { nodeId: 'n3' });
assert.deepEqual(resolve(author('reply', true, { to_node_id: 'n3', to_name: 'same' })), { kind: 'node', ...nodes[2] });
assert.deepEqual(author('reply', true, {}), {});
assert.deepEqual(author('reply', false, { to_name: 'recipient' }), { label: 'same' });
assert.deepEqual(author('reply', false, { to_node_id: 'n3', to_name: 'recipient' }), { label: 'same' });
assert.deepEqual(author('sent', false, { from_node_id: 'n1', from_name: 'wrong' }), { nodeId: 'n1' });
assert.deepEqual(author('sent', false, { _localId: 'optimistic', from_name: 'recipient' }), {});
assert.deepEqual(resolve(author('sent', false, { _localId: 'optimistic' }, 'u1')), { kind: 'user', ...users[0] });
assert.deepEqual(author('sent', false, { from_name: 'api' }), {});
assert.deepEqual(author('sent', false, { from_name: ' recipient ' }), { label: 'recipient' });
console.log('message-avatar-author: 11 message provenance cases passed');

// Source wiring assertions: networkId fallback on phone profiles, retry on failure, and avatar-to-chat entry points.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const chat = read('./ChatScreen.tsx');
const senderInfo = read('./MessageSenderInfo.tsx');
const infoPanel = read('./ChatInfoPanel.tsx');
const nodeDetail = read('./NodeDetailScreen.tsx');
const orgWorkspace = read('./OrgWorkspace.tsx');
const taskDetail = read('./TaskDetailScreen.tsx');
const dmChat = read('./DmChatScreen.tsx');
const app = read('../App.tsx');

assert.ok(chat.includes('controlSession?.network_id || fallbackNetworkId'), 'ChatScreen falls back networkId from session/authMe for MessageSenderInfo');
assert.ok(senderInfo.includes('fetchAuthMe(cfg)') && senderInfo.includes('setRetryTick'), 'MessageSenderInfo resolves empty networkId via authMe and supports retry');
assert.ok(infoPanel.includes('testID="chat-sender-message"') && infoPanel.includes('testID="chat-sender-retry"'), 'ChatInfoPanel exposes both message and retry actions');
assert.ok(nodeDetail.includes('testID="node-detail-avatar-chat"') && nodeDetail.includes('testID="node-detail-open-chat"'), 'NodeDetailScreen supports avatar/button jump to chat');
assert.ok(orgWorkspace.includes('onOpenAgentChat'), 'OrgWorkspace forwards chat navigation into NodeDetailScreen');
assert.ok(taskDetail.includes('testID="task-detail-from-chat"') && taskDetail.includes('testID="task-detail-to-chat"'), 'TaskDetailScreen makes sender/recipient avatars jump to chat');
assert.ok(dmChat.includes('testID="group-sender-avatar"'), 'DmChatScreen makes group sender avatars jump to DM');
assert.ok(app.includes('onOpenAgentChat={target => setScreen'), 'App wires OrgWorkspace chat navigation');
console.log('avatar-to-chat wiring: 8 checks passed');
