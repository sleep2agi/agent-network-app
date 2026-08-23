import { runNodeLifecycleAction, type HubConfig } from './api';

let passed = 0;
const ck = (label: string, ok: boolean) => {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++; console.log(`PASS: ${label}`);
};
const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_secret', networkId: 'net_a' };
const calls: Array<{ url: string; init: RequestInit }> = [];
(globalThis as any).fetch = async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  const body = JSON.stringify({ ok: true, request_id: 'req_1', lifecycle_state: 'stopping' });
  return new Response(JSON.stringify({ result: { content: [{ text: body }] } }), { status: 200 });
};

await runNodeLifecycleAction(cfg, 'restart_node', { node_id: 'n_1', alias: 'worker' });
let call = calls.at(-1)!;
let envelope = JSON.parse(String(call.init.body));
ck('restart uses public MCP tool', call.url.endsWith('/mcp') && envelope.params.name === 'restart_node');
ck('restart targets stable node id and network', envelope.params.arguments.node_id === 'n_1' && envelope.params.arguments.network_id === 'net_a');

await runNodeLifecycleAction(cfg, 'stop_node', { node_id: 'n_1', alias: 'worker' });
call = calls.at(-1)!; envelope = JSON.parse(String(call.init.body));
ck('stop defaults safe (no force)', envelope.params.name === 'stop_node' && envelope.params.arguments.child_node_id === 'n_1' && !('force' in envelope.params.arguments));

await runNodeLifecycleAction(cfg, 'delete_node', { node_id: 'n_1', alias: 'worker' }, { force: true, deleteConfig: true });
call = calls.at(-1)!; envelope = JSON.parse(String(call.init.body));
ck('delete carries exact alias confirmation', envelope.params.name === 'delete_node' && envelope.params.arguments.confirm_alias === 'worker');
ck('destructive options are explicit', envelope.params.arguments.force === true && envelope.params.arguments.delete_config === true);
ck('token remains header-only', (call.init.headers as any).Authorization === 'Bearer utok_secret' && !String(call.init.body).includes('utok_secret') && !call.url.includes('utok_secret'));

console.log(`node lifecycle api: ${passed} checks passed`);
