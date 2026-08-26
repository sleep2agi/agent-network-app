import { sendConfirmationFromResponse } from './actual-recipient';

const ck = (name: string, condition: boolean) => { if (!condition) throw new Error(`FAIL: ${name}`); };

const renamed = sendConfirmationFromResponse({
  ok: true, renamed_from: 'old-name', renamed_to: 'canonical-name',
  actual_to: { alias: 'canonical-name', to_node_id: 'node_real', network_id: 'net_a' },
});
ck('rename uses canonical actual alias, never the requested alias', renamed.actualRecipient?.alias === 'canonical-name');

const sameAliasA = sendConfirmationFromResponse({ actual_to: { alias: 'worker', to_node_id: 'node_a', network_id: 'net_a' } });
const sameAliasB = sendConfirmationFromResponse({ actual_to: { alias: 'worker', to_node_id: 'node_b', network_id: 'net_b' } });
ck('same alias remains distinguishable by scoped identity', sameAliasA.actualRecipient?.toNodeId !== sameAliasB.actualRecipient?.toNodeId && sameAliasA.actualRecipient?.networkId !== sameAliasB.actualRecipient?.networkId);

const queued = sendConfirmationFromResponse({ queued: true, actual_to: { alias: 'worker', to_node_id: 'node_a', network_id: 'net_a' } });
ck('offline queued acknowledgement retains actual target', queued.queued && queued.actualRecipient?.alias === 'worker');

const legacy = sendConfirmationFromResponse({ ok: true, task_id: 'task_old' });
ck('old Hub is explicit and does not infer identity', legacy.actualRecipient === null && !legacy.queued);

const hostile = sendConfirmationFromResponse({ token: 'utok_secret', actual_to: { alias: 'ok\nutok_secret', to_node_id: '', network_id: 'net_a' } });
ck('partial or hostile identity fails closed', hostile.actualRecipient === null && !JSON.stringify(hostile).includes('utok_secret'));

console.log('actual recipient response: 5/5 checks passed');
