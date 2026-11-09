import assert from 'node:assert/strict';
import type { HubNode, Session } from './api';
import { chatForkSource, describeForkSourceError } from './chat-fork-source';
import { chatInfoGroups } from './chat-info-model';
const node = { node_id: 'node_a', runtime: 'opencode-cli', opencode_generation: 'v2' } as HubNode;
const session = { node_id: 'node_a', alias: 'current', network_id: 'net_a', session_id: 'ses_REAL123', project_dir: '/project' } as Session;
const select = (rows = [session], nodes = [node], network: string | undefined = 'net_a') => chatForkSource(rows, nodes, network, 'current');
assert.deepEqual(select(), { ok: true, nodeId: 'node_a', sessionId: 'ses_REAL123', networkId: 'net_a', label: 'current', path: '/project' });
for (const rows of [[], [session, session], [{ ...session, node_id: undefined }], [{ ...session, network_id: 'other' }], [{ ...session, session_id: undefined }], [{ ...session, session_id: 'oses_fake' }]]) assert.equal(select(rows).ok, false);
assert.equal(select([session], []).ok, false);
assert.equal(select([session], [node, node]).ok, false);
assert.equal(select([session], [{ ...node, opencode_generation: 'v1' }]).ok, false);
assert.equal(chatForkSource([session], [node], undefined, 'current').ok, false);
const menu = { alias: 'current', canOpenNode: true, hasRulesTarget: false, skillsCapable: false };
assert.equal(chatInfoGroups({ ...menu, fork: true }).flat().filter(row => row.key === 'fork').length, 1);
assert.equal(chatInfoGroups(menu).flat().some(row => row.key === 'fork'), false);
console.log('PASS chat fork source: fresh scoped identity, no opaque/stale/ambiguous session; opt-in menu');

// The live Hub reports a co-presence v2 node as `opencode-sdk` (its OpenCode V2 server is
// attached) as well as `opencode-cli`. Pinning the exact string rejected a real node and the
// fork palette could only say "fork_requires_opencode_v2".
const sdkNode = { ...node, runtime: 'opencode-sdk' };
assert.equal(select([session], [sdkNode]).ok, true);
const v1Node = { ...node, opencode_generation: 'v1' };
assert.equal(select([session], [v1Node]).ok, false);
console.log('PASS chat fork source: opencode-sdk v2 accepted, v1 still refused');

// Hand-started node (no daemon created/adopted it): the Hub always 409s before any reason.
const unmanaged = select([session], [{ ...node, managed: 'none' } as HubNode]);
assert.deepEqual(unmanaged, { ok: false, error: 'fork_source_not_managed' });
assert.match(describeForkSourceError('fork_source_not_managed'), /daemon/);
assert.equal(select([session], [{ ...node, managed: 'created' } as HubNode]).ok, true);
assert.equal(select([session], [{ ...node, managed: 'adopted' } as HubNode]).ok, true);
assert.equal(select([session], [node]).ok, true); // older Hub: no `managed` field
assert.equal(describeForkSourceError('something_new'), 'something_new');
assert.doesNotMatch(describeForkSourceError('fork_requires_opencode_v2'), /fork_requires/);
console.log('PASS chat fork source: unmanaged source refused up front with readable text; old Hub unchanged');
