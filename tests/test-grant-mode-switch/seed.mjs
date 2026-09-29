// RFC-038 第 1 步的端到端种子:对一个**一次性** hub(HOME=$(mktemp -d)、非 9200 端口、临时库)造出
//   admin(首个注册用户)+ 3 个真注册的 Agent(节点令牌 + MCP report_status)+ 一个「升级前」成员(agent_access='all')。
// 然后用旧 app 的 body 形状(只有 grants)演示 G1:授权写进去了,成员仍然不受限。最后把授权清掉,留给 UI 去修。
//
//   HUB=http://127.0.0.1:<port> node tests/test-grant-mode-switch/seed.mjs > seed.json
//
// 拒绝对 9200 运行。
const HUB = process.env.HUB;
if (!HUB) throw new Error('need HUB');
if (new URL(HUB).port === '9200') throw new Error('refusing to run against 9200');
const PW = 'e2e-Passw0rd!x';

const call = async (token, method, path, body) => {
  const res = await fetch(`${HUB}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data };
};
const mcp = async (token, name, args) => {
  const res = await fetch(`${HUB}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const lines = raw.split('\n').filter(x => x.startsWith('data:'));
  const payload = lines.length ? JSON.parse(lines.at(-1).slice(5).trim()) : JSON.parse(raw);
  return JSON.parse(payload.result.content[0].text);
};
const must = (cond, msg) => { if (!cond) { console.error(`SEED FAIL: ${msg}`); process.exit(1); } };
const log = (...a) => console.error(...a);

const admin = await call('', 'POST', '/api/auth/register', { username: 'e2e_admin', password: PW });
must(admin.status === 200 && admin.body.user?.role === 'admin', `admin register ${JSON.stringify(admin.body)}`);
const A = admin.body.token;
const me = await call(A, 'GET', '/api/auth/me');
const NET = (me.body.networks ?? []).find(n => n.member_role === 'owner')?.network_id;
must(NET, `no owned network ${JSON.stringify(me.body)}`);

const agents = [];
// hostname / agent 让 /api/nodes 有 hostname / runtime(按机器 / 按类型分组用;占位名,不是真机)。
const SHAPE = { 'e2e-alpha': { hostname: 'host-a', agent: 'codex' }, 'e2e-beta': { hostname: 'host-a', agent: 'claude-code' }, 'e2e-gamma': { hostname: 'host-b', agent: 'codex' } };
for (const alias of ['e2e-alpha', 'e2e-beta', 'e2e-gamma']) {
  const nodeId = `node-${alias}-${Math.random().toString(36).slice(2, 8)}`;   // agent-node 自己生成 node_id 并带上
  const t = await call(A, 'POST', '/api/auth/node-token', { network_id: NET, node_name: alias, node_id: nodeId });
  must(t.status === 200 && t.body.token, `node-token ${alias} ${JSON.stringify(t.body)}`);
  const r = await mcp(t.body.token, 'report_status', { resume_id: `resume-${alias}`, alias, status: 'idle', node_id: t.body.node_id, node_name: alias, agent: SHAPE[alias].agent, hostname: SHAPE[alias].hostname });
  must(r && r.ok !== false, `report_status ${alias} ${JSON.stringify(r)}`);
  agents.push({ alias, node_id: t.body.node_id });
}

// 「升级前」成员:自己注册,再由 owner 以 agent_access='all' 加进网络(= 升级前行在 ALTER DEFAULT 'all' 下的状态)。
const bob = await call('', 'POST', '/api/auth/register', { username: 'legacy_bob', password: PW });
must(bob.status === 200, `bob register ${JSON.stringify(bob.body)}`);
const B = bob.body.token, BOB = bob.body.user.user_id;
const add = await call(A, 'POST', `/api/networks/${NET}/members`, { user_id: BOB, role: 'member', agent_access: 'all' });
must(add.status === 200, `add bob ${JSON.stringify(add.body)}`);

const statusAliases = async () => {
  const r = await call(B, 'GET', `/api/status?network_id=${NET}`);
  return (r.body.sessions ?? []).map(s => s.alias).filter(a => a.startsWith('e2e-')).sort();
};
const grantsPath = `/api/networks/${NET}/members/${BOB}/agent-grants`;
const out = { hub: HUB, network_id: NET, admin_user: 'e2e_admin', password: PW, admin_token: A, bob_token: B, bob_user_id: BOB, agents, evidence: {} };

out.evidence.before = { bob_status: await statusAliases(), bob_grants: (await call(A, 'GET', grantsPath)).body };
log('before: bob sees', out.evidence.before.bob_status, 'agent_access=', out.evidence.before.bob_grants.agent_access);

// G1 复现:旧 app 发的 body 只有 grants。
const old = await call(A, 'PUT', grantsPath, { grants: [{ node_id: agents[0].node_id, can_message: true }] });
out.evidence.old_app_body = { status: old.status, error: old.body.error, detail: old.body.detail, agent_access: old.body.agent_access, restricted: old.body.restricted, grant_count: old.body.grants?.length, bob_status_after: await statusAliases() };
log('old-shape PUT:', JSON.stringify(out.evidence.old_app_body));
must(old.body.restricted === false && out.evidence.old_app_body.bob_status_after.length === 3, 'G1 did not reproduce');
// 清掉,留给 UI(UI 预填/勾选从空开始)。
await call(A, 'PUT', grantsPath, { grants: [] });

console.log(JSON.stringify(out, null, 2));
