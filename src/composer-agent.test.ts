import assert from 'node:assert/strict';
import { composerAgents, composerAgentSwitchable, composerAgentCurrent, composerAgentSectionVisible, confirmComposerAgentSwitch } from './composer-agent';
import type { NodeConfigRead } from './api';
let checks = 0;
const ck = (ok: unknown) => { assert.ok(ok); checks++; };
const ids = ['build', 'general', 'explore', 'compaction', 'title', 'summary', 'plan'];
// The list is real information and must not be gated on the switch capability.
assert.deepEqual(composerAgents({ opencode_agent_config_capable: true, agents: [...ids, 'build'] }), ids); checks++;
assert.deepEqual(composerAgents({ agents: ids }), ids); checks++;
for (const cfg of [undefined, null, {}, { agents: [] }, { agents: 'nope' as unknown as string[] }]) {
  ck(composerAgents(cfg).length === 0);
}
// Switchability is the capability AND a non-empty list.
ck(composerAgentSwitchable({ opencode_agent_config_capable: true, agents: ids }));
ck(!composerAgentSwitchable({ agents: ids }));
ck(!composerAgentSwitchable({ opencode_agent_config_capable: true, agents: [] }));
// Current value is never guessed.
ck(composerAgentCurrent({ agent: 'build' }) === 'build');
for (const cfg of [undefined, null, {}, { agent: '' }, { agent: '  ' }, { agent: 7 as unknown as string }]) ck(composerAgentCurrent(cfg) === undefined);
// Section visibility: switchable, or a real current value (read-only). Absent ⇒ hidden.
ck(composerAgentSectionVisible({ opencode_agent_config_capable: true, agents: ids, agent: 'build' } as NodeConfigRead));
ck(composerAgentSectionVisible({ agent: 'build' } as NodeConfigRead));
ck(composerAgentSectionVisible({ agents: ids, agent: 'build' } as NodeConfigRead));
ck(!composerAgentSectionVisible({} as NodeConfigRead));
ck(!composerAgentSectionVisible(null));
const after: NodeConfigRead = { node_id: 'n_A', config_revision: 1, model: null, config_update_capable: true, agent: 'plan', last_update: { update_id: 'u1', status: 'applied', terminal: true } };
const confirm = (value: NodeConfigRead | null, updateId: string | undefined = 'u1') => confirmComposerAgentSwitch({ after: value, updateId, requested: 'plan' });
ck(confirm(after).confirmed);
ck(!confirm(null).confirmed);
ck(!confirm(after, '').confirmed);
ck(!confirm({ ...after, last_update: { update_id: 'old', status: 'applied' } }).confirmed);
ck(!confirm({ ...after, agent: undefined }).confirmed);
ck(!confirm({ ...after, agent: 'build' }).confirmed);
ck(!confirm({ ...after, last_update: { update_id: 'u1', status: 'pending' } }).confirmed);
ck(confirm({ ...after, last_update: { update_id: 'u1', status: 'failed', error: 'agent_unsupported' } }).reason === 'agent_unsupported');
ck(confirm({ ...after, last_update: { update_id: 'u1', status: 'timeout' } }).reason === 'timeout');
console.log(`${checks}/${checks} composer agent checks passed`);
