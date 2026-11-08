import { strict as assert } from 'node:assert';
import { lastUpdateApplied as judge } from './node-model-change';
// Preserve the full-tree diagnostic result API while asserting identical strict outcomes.
const lastUpdateApplied = (...args: Parameters<typeof judge>) => judge(...args).applied;
let checks = 0;
const ck = (name: string, ok: boolean) => { assert.ok(ok, name); checks++; };
const ack = { update_id: 'u_fixture', status: 'applied', terminal: true, requested_model: 'p/m' };
ck('matching terminal ack', lastUpdateApplied(ack, 'u_fixture', 'p/m'));
ck('wrong update id rejected', !lastUpdateApplied(ack, 'u_other', 'p/m'));
ck('missing receipt id rejected', !lastUpdateApplied(ack, undefined, 'p/m'));
ck('missing observed id rejected', !lastUpdateApplied({ ...ack, update_id: null }, 'u_fixture', 'p/m'));
ck('request_id is not update_id', !lastUpdateApplied({ status: 'applied', terminal: true, ...({ request_id: 'u_fixture' } as object) }, 'u_fixture', 'p/m'));
ck('wrong model rejected', !lastUpdateApplied(ack, 'u_fixture', 'p/other'));
ck('nonterminal rejected', !lastUpdateApplied({ ...ack, terminal: false }, 'u_fixture', 'p/m'));
ck('unknown terminal rejected', !lastUpdateApplied({ ...ack, terminal: undefined }, 'u_fixture', 'p/m'));
ck('pending rejected', !lastUpdateApplied({ ...ack, status: 'pending' }, 'u_fixture', 'p/m'));
ck('failed rejected', !lastUpdateApplied({ ...ack, status: 'failed' }, 'u_fixture', 'p/m'));
ck('missing rejected', !lastUpdateApplied(null, 'u_fixture', 'p/m'));
console.log(`${checks} composer variant ack checks passed`);
