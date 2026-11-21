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
assert.deepEqual(author('reply', true, {}), {});
assert.deepEqual(author('reply', false, { to_name: 'recipient' }), { label: 'same' });
assert.deepEqual(author('sent', false, { from_node_id: 'n1', from_name: 'wrong' }), { nodeId: 'n1' });
assert.deepEqual(author('sent', false, { _localId: 'optimistic', from_name: 'recipient' }), {});
assert.deepEqual(resolve(author('sent', false, { _localId: 'optimistic' }, 'u1')), { kind: 'user', ...users[0] });
assert.deepEqual(author('sent', false, { from_name: 'api' }), {});
assert.deepEqual(author('sent', false, { from_name: ' recipient ' }), { label: 'recipient' });
console.log('message-avatar-author: 8 message provenance cases passed');
