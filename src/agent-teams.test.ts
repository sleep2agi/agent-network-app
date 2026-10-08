// Agent 团队(看板 #766)接口 + 树 + 权限 + 接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  childTeams, createTeam, deleteTeam, fetchAgentTeams, flattenTeams, patchTeam, setNodeTeam, subtree, teamErrorText, teamOfNode, teamPerms, unassigned, HUB_MIN, type AgentTeam,
} from './agent-teams';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const N = (id: string) => ({ node_id: id, alias: `a_${id}`, display_name: null });
const T = (id: string, name: string, parent_id: string | null, sort = 0, extra: Partial<AgentTeam> = {}): AgentTeam => ({ id, name, parent_id, sort, lead: null, owner: null, members: [], ...extra });
const teams: AgentTeam[] = [
  T('plat', '平台', null, 0, { owner: { user_id: 'u_a', display_name: '平台负责人' }, members: [N('n1')], lead: N('n1') }),
  T('ops', '运维', null, 1, { owner: { user_id: 'u_b', display_name: '' }, members: [N('n3')] }),
  T('web', '前端', 'plat', 1), T('api', '接口', 'plat', 0, { members: [N('n2')] }),
];
const nodes = ['n1', 'n2', 'n3', 'n4', 'n5'].map(N);
const me = (role: string, uid = 'u_me', hubAdmin = false) => ({ user: { user_id: uid, role: hubAdmin ? 'admin' : 'user' }, networks: [{ network_id: 'net', member_role: role as never }] });

console.log('# 树');
ck('根按 sort', childTeams(teams, null).map(t => t.id).join() === 'plat,ops');
ck('展开(先序,带层级)', flattenTeams(teams).map(r => `${r.team.id}:${r.depth}`).join() === 'plat:0,api:1,web:1,ops:0');
ck('子树', [...subtree(teams, 'plat')].sort().join() === 'api,plat,web');
ck('Agent 所在团队', teamOfNode(teams, 'n2') === 'api' && teamOfNode(teams, 'n4') === null);
ck('未分组 = 没归任何团队的', unassigned(teams, nodes).map(x => x.node_id).join() === 'n4,n5');
ck('成环的数据不死循环', flattenTeams([T('x', 'x', 'y'), T('y', 'y', 'x')]).length === 0);

console.log('# 权限');
const own = teamPerms(teams, me('owner'), 'net');
ck('网络 owner:全部', !own.readOnly && own.canCreateRoot && own.canRelocate('plat') && own.canAssign('ops', 'plat') && own.canAssign(null, 'api'));
ck('Hub 管理员 = 全部', teamPerms(teams, me('member', 'u_x', true), 'net').canCreateRoot);
const a = teamPerms(teams, me('member', 'u_a'), 'net');
ck('团队 owner:子树里能改名 / 建子团队 / 设 lead', !a.readOnly && a.canEdit('plat') && a.canEdit('api') && !a.canEdit('ops'));
ck('团队 owner:不能建顶层、不能挪 / 删 / 换自己那个团队的 owner', !a.canCreateRoot && !a.canRelocate('plat') && a.canRelocate('api'));
ck('团队 owner:Agent 只能在子树里进出', a.canAssign('api', null) && a.canAssign('web', 'api') && a.canAssign(null, 'api') && !a.canAssign('api', 'ops') && !a.canAssign('ops', null));
ck('团队 owner:移动目标只在子树内(不含自己的下级)、没有顶层', (() => { const m = a.moveTargets('api'); return !m.root && m.allowed.has('web') && m.allowed.has('plat') && !m.allowed.has('ops') && !m.allowed.has('api'); })());
const ro = teamPerms(teams, me('member', 'u_z'), 'net');
ck('普通成员只读:什么都不能做', ro.readOnly && !ro.canCreateRoot && !ro.canEdit('plat') && !ro.canRelocate('api') && !ro.canAssign('plat', null));
ck('viewer 当了 owner 也只读', teamPerms(teams, me('viewer', 'u_a'), 'net').readOnly);
ck('没登录信息 → 只读', teamPerms(teams, null, 'net').readOnly);
ck('原地不动不算一个动作', !own.canAssign('api', 'api') && !own.canAssign(null, null));

console.log('# 接口');
{
  const sent: { url: string; method: string; body: unknown }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  const real = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_sample', networkId: 'net' } as never;
  const last = () => sent[sent.length - 1];
  const body = () => JSON.stringify(last().body);
  try {
    reply = { status: 404, body: { error: 'not found' } };
    ck('旧 Hub(404)→ null', (await fetchAgentTeams(cfg, 'net')) === null);
    reply = { status: 405, body: {} };
    ck('旧 Hub(405)→ null', (await fetchAgentTeams(cfg, 'net')) === null);
    reply = { status: 404, body: { ok: false, error: 'network_not_found' } };
    let threw = false;
    try { await fetchAgentTeams(cfg, 'net'); } catch { threw = true; }
    ck('新 Hub 的「网络不存在」不当旧 Hub', threw);
    reply = { status: 200, body: { ok: true, teams } };
    const got = await fetchAgentTeams(cfg, 'net x');
    ck('读:GET …/agent-teams', got?.length === 4 && last().method === 'GET' && last().url === 'http://hub.invalid/api/networks/net%20x/agent-teams');
    reply = { status: 201, body: { ok: true } };
    await createTeam(cfg, 'net', '网关', 'api');
    ck('建:POST {name, parent_id}', last().method === 'POST' && last().url.endsWith('/networks/net/agent-teams') && body() === '{"name":"网关","parent_id":"api"}');
    await createTeam(cfg, 'net', '顶层', null);
    ck('建顶层:parent_id null', body() === '{"name":"顶层","parent_id":null}');
    reply = { status: 200, body: { ok: true } };
    await patchTeam(cfg, 'net', 'api', { name: '接口组' });
    ck('改名:PATCH …/agent-teams/:id {name}', last().method === 'PATCH' && last().url.endsWith('/agent-teams/api') && body() === '{"name":"接口组"}');
    await patchTeam(cfg, 'net', 'api', { parent_id: 'ops' });
    ck('移动:PATCH {parent_id}', body() === '{"parent_id":"ops"}');
    await patchTeam(cfg, 'net', 'api', { lead_node_id: 'n2' });
    ck('设 lead:PATCH {lead_node_id}', body() === '{"lead_node_id":"n2"}');
    await patchTeam(cfg, 'net', 'api', { owner_user_id: 'u_a' });
    ck('设负责人:PATCH {owner_user_id}', body() === '{"owner_user_id":"u_a"}');
    await deleteTeam(cfg, 'net', 'web');
    ck('删:DELETE …/agent-teams/:id 无体', last().method === 'DELETE' && last().url.endsWith('/agent-teams/web') && last().body === null);
    await setNodeTeam(cfg, 'net', 'n 4', 'api');
    ck('归团队:PUT …/nodes/:id/agent-team {team_id}', last().method === 'PUT' && last().url.endsWith('/nodes/n%204/agent-team') && body() === '{"team_id":"api"}');
    await setNodeTeam(cfg, 'net', 'n4', null);
    ck('移出:PUT {team_id:null}', body() === '{"team_id":null}');
    let msg = '';
    reply = { status: 403, body: { ok: false, error: 'agent_team_scope_denied' } };
    try { await setNodeTeam(cfg, 'net', 'n4', 'ops'); } catch (e) { msg = (e as Error).message; }
    ck('403 → 一句人话', msg === teamErrorText('agent_team_scope_denied') && !msg.includes('403') && !msg.includes('agent_team'), msg);
    reply = { status: 403, body: { ok: false, error: 'not a member of this network' } };
    try { await createTeam(cfg, 'net', 'x', null); } catch (e) { msg = (e as Error).message; }
    ck('别的 403 也是这句人话', msg === teamErrorText('agent_team_scope_denied'), msg);
    reply = { status: 409, body: { ok: false, error: 'team_has_children', children: 2 } };
    try { await deleteTeam(cfg, 'net', 'plat'); } catch (e) { msg = (e as Error).message; }
    ck('有子团队不能删:按 Hub 的原因说', msg === '先删掉或移走子团队,才能删除这个团队', msg);
  } finally { (globalThis as any).fetch = real; }
}

console.log('# 接线');
const ui = src('./AgentTeams.tsx'), um = src('./UserManagementPanel.tsx');
ck('入口:用户管理里紧跟「组织架构」之后', um.indexOf('<AgentTeamsSection') > um.indexOf('<OrgDesktopPanel') && um.includes("import { AgentTeamsSection } from './AgentTeams'"));
ck('人的组织架构照旧(OrgDesktopPanel / OrgPhoneModal 仍在)', um.includes('<OrgDesktopPanel cfg={cfg}') && um.includes('<OrgPhoneModal cfg={cfg}'));
ck('旧 Hub:只一行版本提示', ui.includes("teams === null ? <SettingsRow label={`需要 Hub ≥ ${HUB_MIN}`}") && HUB_MIN === '0.9.0-preview.116');
ck('不碰部门接口', !/departments|setMemberDepartment|org-api/.test(ui + src('./agent-teams.ts')));
ck('删除:有子团队就灰掉并说原因', ui.includes("'team-delete', 'danger', kids.length > 0)") && ui.includes('team-delete-reason'));
ck('删除先确认', ui.includes("kind: 'delete'") && ui.includes('team-delete-confirm'));
ck('按钮按权限出现', ['perms.canCreateRoot ?', 'perms.canEdit(team.id) ?', 'perms.canRelocate(team.id) ?', 'perms.canAssign(null, team.id) ?'].every(s => ui.includes(s)));
ck('手机是逐层点进 + 底部面板', ui.includes('push({ at: k.id })') && ui.includes('testID="team-sheet"') && ui.includes('presentationStyle="fullScreen"'));

console.log(`\n${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
