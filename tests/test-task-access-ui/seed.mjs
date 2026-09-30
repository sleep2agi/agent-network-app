// 任务权限(RFC-038 §9)端到端的种子:对一个**一次性** hub(HOME=$(mktemp -d)、非 9200 端口、临时库,
// hub 取自 agent-network#2163)造出 admin + 成员 bob(显式设成「仅相关任务」)+ 两个项目 + 五张卡。
// Hub 的新成员默认值会变(agent-network#2174 暂时改成 'all'),所以 bob 的 scoped 由种子经授权接口显式设,不靠默认值。
//   HUB=http://127.0.0.1:<port> node tests/test-task-access-ui/seed.mjs > seed.json
// 拒绝对 9200 运行。
const HUB = process.env.HUB;
if (!HUB) throw new Error('need HUB');
if (new URL(HUB).port === '9200') throw new Error('refusing to run against 9200');
const PW = 'e2e-Passw0rd!x';
const call = async (token, method, path, body) => {
  const res = await fetch(`${HUB}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, body: data };
};
const must = (c, m) => { if (!c) { console.error(`SEED FAIL: ${m}`); process.exit(1); } };
const admin = await call('', 'POST', '/api/auth/register', { username: 'e2e_admin', password: PW });
must(admin.status === 200, 'admin');
const A = admin.body.token;
const me = await call(A, 'GET', '/api/auth/me');
const NET = me.body.networks.find(n => n.member_role === 'owner').network_id;
const bob = await call(A, 'POST', '/api/admin/users', { username: 'scoped_bob', password: PW, network_id: NET, role: 'member' });
must(bob.status === 200, `bob ${JSON.stringify(bob.body)}`);
const BOB = bob.body.user.user_id;
const scoped = await call(A, 'PUT', `/api/networks/${NET}/members/${BOB}/task-grants`, { task_access: 'scoped' });
must(scoped.status === 200 || scoped.status === 404, `bob scoped ${scoped.status} ${JSON.stringify(scoped.body)}`);
const proj = {};
for (const name of ['官网改版', '安卓发布']) {
  const r = await call(A, 'POST', `/api/requirements/projects?network_id=${NET}`, { name });
  must(r.status === 201, `project ${name}`);
  proj[name] = r.body.project.id;
}
const cards = {};
const card = async (name, extra = {}) => {
  const r = await call(A, 'POST', '/api/requirements', { network_id: NET, name, ...extra });
  must(r.status === 201, `card ${name} ${JSON.stringify(r.body)}`);
  cards[name] = r.body.requirement.id;
};
const u = (id) => ({ kind: 'user', id });
await card('bob负责的卡', { owner: u(BOB) });
await card('bob参与的卡', { participants: [u(BOB)], description: '只读说明' });
await card('官网的卡', { project_id: proj['官网改版'] });
await card('安卓的卡', { project_id: proj['安卓发布'] });
await card('无关的卡');
const g = await call(A, 'GET', `/api/networks/${NET}/members/${BOB}/task-grants`);
console.error('bob task-grants before:', JSON.stringify(g.body && { task_access: g.body.task_access, project_grants: g.body.project_grants }));
console.log(JSON.stringify({ hub: HUB, network_id: NET, password: PW, admin_user: 'e2e_admin', admin_token: A, bob_user: 'scoped_bob', bob_user_id: BOB, projects: proj, cards, supported: g.status === 200 }, null, 2));
