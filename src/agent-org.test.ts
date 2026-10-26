// Agent 组织架构:点设置入口必须打开页面;部门树和负责人是 Hub 数据;调整结构写 Hub(PUT),失败回滚。
import { existsSync, readFileSync } from 'node:fs';
import { agentCount, agentsDirectlyIn, placeAgents, type AgentOrgData, type OrgOwner } from './agent-org-model';
import { DIRECTORY_MAX_PAGES, loadAgentOrg, moveAgentDepartment, parseDirectoryPage } from './agent-org-api';
import { agentOrgTranslations } from './i18n-agent-org';
import type { Department } from './org-model';
import { createDepartment, updateDepartment, OrgRequestError } from './org-api';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const code = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const dept = (id: string, name: string, parent: string | null = null, sort = 0): Department => ({
  id, name, parent_id: parent, leader_user_id: null, sort, member_count: 0,
});
const owner = (userId: string, departmentId: string | null, agents: OrgOwner['agents'], displayName = ''): OrgOwner => ({
  userId, username: userId, displayName, departmentId, agents,
});
// #1976 —— 现在的 Hub 支持显式 Agent 部门(agentDepartmentSupported: true):
// Agent 只认**显式**归属,不再从「负责人在哪个部门」推断。老 Hub 没有这一格,
// 客户端保留旧的推断口径(legacyData)。
const data = (patch: Partial<AgentOrgData> = {}): AgentOrgData => ({
  departments: [dept('eng', '工程'), dept('fe', '前端', 'eng', 1)],
  owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法' }], '爱丽丝')],
  unowned: [{ nodeId: 'n2', alias: '孤岛' }],
  directory: true,
  departmentsApi: true,
  agentDepartmentSupported: true,
  ...patch,
});
const legacyData = (patch: Partial<AgentOrgData> = {}): AgentOrgData =>
  data({ agentDepartmentSupported: false, ...patch });

{
  const placed = placeAgents(data(), []);
  // #1976 —— Agent 归属与人类部门是两个独立的:负责人属于「工程」并不会把它的 Agent 带进「工程」。
  ck('🔴 有负责人的 Agent 也不会自动进负责人的部门', placed.find(a => a.nodeId === 'n1')?.departmentId === null && placed.find(a => a.nodeId === 'n1')?.ownerName === '爱丽丝');
  ck('老 Hub（不支持显式归属）仍按负责人部门推断', (() => {
    const legacy = placeAgents(legacyData(), []).find(a => a.nodeId === 'n1');
    return legacy?.departmentId === 'eng' && legacy?.demo === false;
  })());
  ck('显式归属的 Agent 落在它自己的部门', (() => {
    const explicit = placeAgents(data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'fe' }], '爱丽丝')] }), []);
    return explicit.find(a => a.nodeId === 'n1')?.departmentId === 'fe';
  })());
  ck('没有负责人的 Agent 未归属', placed.find(a => a.nodeId === 'n2')?.departmentId === null && placed.find(a => a.nodeId === 'n2')?.ownerName === null);
  ck('显式归属算在本部门', (() => {
    const d = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'eng' }], '爱丽丝')] });
    const pl = placeAgents(d, []);
    return agentCount(pl, d, 'eng') === 1 && agentsDirectlyIn(pl, 'eng').length === 1 && agentCount(pl, d, 'fe') === 0;
  })());
  const nested = data({ owners: [owner('u1', 'fe', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'fe' }])] });
  const nestedPlaced = placeAgents(nested, []);
  ck('父部门计入下级 Agent', agentCount(nestedPlaced, nested, 'eng') === 1 && agentsDirectlyIn(nestedPlaced, 'eng').length === 0 && agentsDirectlyIn(nestedPlaced, 'fe').length === 1);
  // #1976 —— 没有显式归属的 Agent,它的「原部门」就是未归属;把它移进某个部门是一次真实的改动。
  const movedUnknown = placeAgents(data(), [{ nodeId: 'n1', departmentId: 'missing' }]).find(a => a.nodeId === 'n1')!;
  ck('未知的演示目标算未归属', movedUnknown.departmentId === null && movedUnknown.ownerName === '爱丽丝' && movedUnknown.sourceDepartmentId === null);
  const movedReal = placeAgents(data(), [{ nodeId: 'n1', departmentId: 'fe' }]).find(a => a.nodeId === 'n1')!;
  ck('移进真实部门算一次改动(演示),并记下原部门是未归属', movedReal.departmentId === 'fe' && movedReal.demo === true && movedReal.sourceDepartmentId === null);
  const explicitSame = placeAgents(
    data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'eng' }], '爱丽丝')] }),
    [{ nodeId: 'n1', departmentId: 'eng' }],
  ).find(a => a.nodeId === 'n1')!;
  ck('移回原部门不算演示', explicitSame.departmentId === 'eng' && explicitSame.demo === false);
  const owned = placeAgents(data({ unowned: [{ nodeId: 'n1', alias: '不该赢' }, { nodeId: 'n2', alias: '孤岛' }] }), []);
  ck('同一节点负责人优先于未归属名单', owned.filter(a => a.nodeId === 'n1').length === 1 && owned.find(a => a.nodeId === 'n1')?.alias === '阿尔法');
  const foreign = placeAgents(data({ owners: [owner('u9', 'gone', [{ nodeId: 'n9', alias: '外部门' }])] }), []);
  ck('通讯录部门不在树里则未归属', foreign.find(a => a.nodeId === 'n9')?.departmentId === null && foreign.find(a => a.nodeId === 'n9')?.demo === false);
  const blank = placeAgents(data({ owners: [owner('u1', 'eng', [{ nodeId: '  ', alias: '空' }, { nodeId: 'n3', alias: '  ' }])] }), []);
  ck('空节点丢掉,空别名回落到节点 id', !blank.some(a => a.alias === '空') && blank.find(a => a.nodeId === 'n3')?.alias === 'n3');
}

{
  const junk = parseDirectoryPage({
    people: [null, { username: 'no-id' }, { user_id: 'u', username: 'alice', display_name: '', agents: [{ node_id: '' }, { node_id: 'n', alias: 'Bot' }, 'x', { node_id: 'n', alias: 'dup' }], department: { id: 'd', name: '' } }, { user_id: 'u2', username: 'bob', department: { id: 'd2', name: '销售' }, agents: [] }],
    agents_without_owner: [{ alias: 'nope' }, { node_id: 'z' }],
    has_more: 'yes',
    next_offset: '3',
  });
  ck('垃圾项丢掉,缺名字的部门不算', junk.people.length === 2 && junk.people[0].agents.length === 1 && junk.people[0].departmentId === null && junk.people[1].departmentName === '销售');
  ck('没有 node_id 的未归属丢掉,分页字段不合法则停', junk.unowned.length === 1 && junk.unowned[0].alias === 'z' && junk.hasMore === false && junk.nextOffset === null);
  ck('非对象页是空页', parseDirectoryPage(null).people.length === 0 && parseDirectoryPage('x').unowned.length === 0);
}

const original = globalThis.fetch;
const cfg = { serverUrl: 'https://hub.example', token: 'tok', networkId: 'net 1' };
type Call = { url: string; method: string; body?: string };
async function withFetch(handler: (url: string, method: string) => Response, body: () => Promise<void>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    return handler(url, method);
  }) as typeof fetch;
  try { await body(); } finally { globalThis.fetch = original; }
  return calls;
}
const json = (status: number, body: unknown) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

{
  const calls = await withFetch(url => json(url.includes('departments') ? 404 : 405, ''), async () => {
    ck('两边都没有则是旧 Hub', await loadAgentOrg(cfg, 'net 1') === null);
  });
  ck('旧 Hub 也只发 GET', calls.length === 2 && calls.every(c => c.method === 'GET') && calls.some(c => c.url.includes('/departments')) && calls.some(c => c.url.includes('/api/requirements/people/directory')));
}
{
  await withFetch(url => url.includes('departments') ? json(404, '') : new Response('<html>missing</html>', { status: 404 }), async () => {
    ck('通讯录 404 的 HTML 也算没有这个接口', await loadAgentOrg(cfg, 'net 1') === null);
  });
}

{
  const calls = await withFetch(url => {
    if (url.includes('departments')) return json(200, { departments: [dept('eng', '工程'), dept('fe', '前端', 'eng')], members: [] });
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) return json(200, { ok: true, agent_department_supported: true, people: [{ user_id: 'u1', username: 'alice', display_name: '爱丽丝', department: { id: 'eng', name: '工程' }, agents: [{ node_id: 'n1', alias: '阿尔法' }] }], agents_without_owner: [{ node_id: 'n0', alias: '第一页' }], has_more: true, next_offset: 200 });
    return json(200, { ok: true, people: [{ user_id: 'u2', username: 'bob', display_name: '', department: { id: 'missing', name: '不在树上' }, agents: [{ node_id: 'n2', alias: '贝塔' }] }, { user_id: 'u1', username: 'alice', agents: [{ node_id: 'n9', alias: '不合并' }] }], agents_without_owner: [{ node_id: 'n8', alias: '后页不收' }], has_more: false, next_offset: null });
  }, async () => {
    const org = await loadAgentOrg(cfg, 'net 1');
    const placed = org ? placeAgents(org, []) : [];
    ck('翻页合并负责人,未归属只取第一页', !!org && org.owners.length === 2 && org.unowned.length === 1 && org.unowned[0].nodeId === 'n0' && org.departmentsApi && org.directory);
  // #1976 —— 顶层能力位决定用哪套口径。
  ck('通讯录声明支持显式 Agent 部门时,按独立口径', !!org && org.agentDepartmentSupported === true);
  ck('通讯录没声明时,按老的推断口径', parseDirectoryPage({ people: [], agents_without_owner: [], has_more: false, next_offset: null }).agentDepartmentSupported === false);
    // #1976 —— 独立口径下,没有显式归属的 Agent 一律未归属(负责人/通讯录里的部门不再决定它)。
    ck('不在树上的部门按未归属', placed.find(a => a.nodeId === 'n2')?.departmentId === null && placed.find(a => a.nodeId === 'n1')?.departmentId === null);
    ck('重复的人保留先读到的 Agent', !placed.some(a => a.nodeId === 'n9'));
  });
  ck('只 GET 部门树和通讯录', calls.every(c => c.method === 'GET' && !c.url.includes('POST')) && calls.filter(c => c.url.includes('directory')).length === 2 && calls.every(c => c.url.startsWith('https://hub.example/')));
}

{
  await withFetch(url => {
    if (url.includes('departments')) return json(404, '');
    return json(200, { ok: true, people: [{ user_id: 'u', username: 'sam', display_name: '', department: { id: 'sales', name: '销售' }, agents: [{ node_id: 'n', alias: '销售助手' }] }], has_more: false, next_offset: null });
  }, async () => {
    const org = await loadAgentOrg(cfg, 'net 1');
    ck('没有部门树时按通讯录平铺', !!org && org.departmentsApi === false && org.departments.length === 1 && org.departments[0].parent_id === null && org.departments[0].name === '销售');
    ck('平铺部门上能看到 Agent', !!org && placeAgents(org, [])[0].departmentId === 'sales');
  });
}

{
  await withFetch(url => url.includes('departments') ? json(200, { departments: [dept('eng', '工程')], members: [] }) : json(404, ''), async () => {
    const org = await loadAgentOrg(cfg, 'net 1');
    ck('没有通讯录时仍给出部门树', !!org && org.directory === false && org.owners.length === 0 && org.departments[0].id === 'eng');
  });
}

{
  let threw = false;
  await withFetch(() => json(500, { ok: false, error: 'boom' }), async () => {
    try { await loadAgentOrg(cfg, 'net 1'); } catch { threw = true; }
  });
  ck('非 404 的失败留给页面重试', threw);
  let bad = false;
  await withFetch(url => url.includes('directory') ? new Response('nope', { status: 200 }) : json(200, { departments: [], members: [] }), async () => {
    try { await loadAgentOrg(cfg, 'net 1'); } catch { bad = true; }
  });
  ck('通讯录不是 JSON 则失败', bad);
}

{
  const calls = await withFetch(url => {
    if (url.includes('departments')) return json(200, { departments: [], members: [] });
    const offset = Number(new URL(url).searchParams.get('offset'));
    return json(200, { ok: true, people: [], has_more: true, next_offset: offset + 200 });
  }, async () => { await loadAgentOrg(cfg, 'net 1'); });
  ck('通讯录翻页有上限', calls.filter(c => c.url.includes('directory')).length === DIRECTORY_MAX_PAGES);
}

{
  // 显式 department_id 优先于负责人部门,未设置才推断;null = 明确清空(未归属)。
  const explicit = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'fe' }], '爱丽丝')] });
  const explicitPlaced = placeAgents(explicit, []).find(a => a.nodeId === 'n1')!;
  ck('显式部门优先于负责人部门', explicitPlaced.departmentId === 'fe' && explicitPlaced.sourceDepartmentId === 'fe' && explicitPlaced.ownerName === '爱丽丝');
  const cleared = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: null }])] });
  ck('显式 null 覆盖负责人部门(未归属)', placeAgents(cleared, []).find(a => a.nodeId === 'n1')?.departmentId === null);
  const unknown = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'gone' }])] });
  ck('显式部门不在树里按未归属', placeAgents(unknown, []).find(a => a.nodeId === 'n1')?.departmentId === null);
}

{
  const d = parseDirectoryPage({ people: [{ user_id: 'u', username: 'alice', agents: [
    { node_id: 'a', alias: 'A', department_id: 'fe' },
    { node_id: 'b', alias: 'B', department_id: null },
    { node_id: 'c', alias: 'C' },
  ] }] });
  const byId = new Map(d.people[0].agents.map(a => [a.nodeId, a]));
  ck('通讯录保留显式 department_id', byId.get('a')?.departmentId === 'fe' && byId.get('b')?.departmentId === null && byId.get('c')?.departmentId === undefined);
}

{
  const cfgMove = { serverUrl: 'https://hub.example', token: 'tok', networkId: 'net 1' };
  const okCalls = await withFetch(() => json(200, { ok: true, node_id: 'n1', department_id: 'd1' }), async () => {
    ck('保存部门 200 = ok', (await moveAgentDepartment(cfgMove, 'net 1', 'n 1', 'd1')).ok === true);
  });
  ck('PUT 到节点部门接口并编码路径', okCalls.length === 1 && okCalls[0].method === 'PUT' && okCalls[0].url === 'https://hub.example/api/networks/net%201/nodes/n%201/department');
  await withFetch(() => json(200, { ok: false }), async () => {
    ck('200 但 ok:false 不算成功', (await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1')).ok === false);
  });
  await withFetch(() => json(403, {}), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('403 = forbidden', r.ok === false && r.reason === 'forbidden');
  });
  await withFetch(() => json(400, { ok: false, error: 'department_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('400 error=department_not_found(Hub .140) = department', r.ok === false && r.reason === 'department');
  });
  await withFetch(() => json(400, { code: 'department_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('400 code=department_not_found(旧草案) = department', r.ok === false && r.reason === 'department');
  });
  await withFetch(() => json(404, { ok: false, error: 'node_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('404 error=node_not_found(Hub .140) = node', r.ok === false && r.reason === 'node');
  });
  await withFetch(() => json(404, { code: 'node_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('404 code=node_not_found(旧草案) = node', r.ok === false && r.reason === 'node');
  });
  await withFetch(() => new Response('<html>not found</html>', { status: 404 }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('旧 Hub 无此路由(404 非 JSON) = unsupported', r.ok === false && r.reason === 'unsupported');
  });
  await withFetch(() => json(501, {}), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('501 = unsupported', r.ok === false && r.reason === 'unsupported');
  });
  await withFetch(() => { throw new Error('offline'); }, async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', null);
    ck('网络错误 = error,且 null 目标合法', r.ok === false && r.reason === 'error');
  });
}

{
  const screen = code(read('./AgentOrgScreen.tsx'));
  const settings = code(read('./SettingsScreen.tsx'));
  const phone = code(read('./SettingsPhonePages.tsx'));
  const forbidden = ['setMemberDepartment', 'deleteDepartment', 'appFetch', 'fetchOrg', 'listRequirementPeople', "method: 'POST'", "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'", 'AgentTeamsEntry'];
  ck('department edits reuse shared APIs, never move people or delete', forbidden.every(s => !screen.includes(s)) && screen.includes('await createDepartment(') && screen.includes('await updateDepartment('));
  // admin 2026-10-24「agent 跟人共用一个组织架构，好像不太好」:这一页不再改部门结构,
  // 只调 Agent 归属;增删改统一在「用户管理 → 成员与部门」。
  ck('department create/rename/reparent actions are gone from the agent page', ['agent-org-new-department', 'agent-org-new-child', 'agent-org-rename-department', 'agent-org-reparent-department'].every(id => !screen.includes(`testID="${id}"`)));
  ck('the page points at 用户管理 → 成员与部门 instead', screen.includes('testID="agent-org-departments-elsewhere"') && /agentOrg\.departmentsElsewhere/.test(screen));
  ck('editor uses bounded keyboard-safe frame with pinned save and shared-tree warning', screen.includes('testID="agent-org-department-editor"') && screen.includes('footer={<SettingsButton') && screen.includes('testID="agent-org-shared-tree-note"'));
  ck('editor validates Unicode name length and excludes entire subtree', screen.includes('[...name.trim()].length <= 40') && screen.includes('subtreeIds(tree, p.editor.dept.id)') && screen.includes('filter(row => !excluded.has(row.dept.id))'));
  ck('patches preserve leader and sort by omission', screen.includes("? { name: name.trim() } : { parent_id: parent }") && !screen.includes('leader_user_id:') && !screen.includes('sort:'));
  // 这一页不再做部门写操作,所以也不需要 viewer_can 门;门与写入口一起挪到了「成员与部门」。
  ck('the agent page no longer mutates departments (no viewer_can gates left here)', !screen.includes('viewer_can?.manage') && !screen.includes('viewer_can?.create_child'));
  ck('confirmed saves refresh real data and focus returned department', screen.includes('await loadAgentOrg(p.cfg, p.networkId)') && screen.includes('setFocus(department.id)') && screen.includes('result.id !== p.editor.dept.id') && screen.includes('setSaved(result)'));
  ck('refresh retry does not repeat a confirmed mutation', screen.includes('let confirmed = saved') && screen.includes('if (!confirmed)') && screen.includes('await p.onSaved(confirmed)'));
  ck('department errors and shared warning have both languages', ['sharedTree', 'departmentForbidden', 'departmentUnsupported', 'departmentConflict', 'departmentHierarchyInvalid', 'departmentRefreshFailed'].every(key => (agentOrgTranslations as Record<string, readonly string[]>)[`agentOrg.${key}`]?.length === 2));
  ck('调整按钮调用真实写接口,失败回滚', screen.includes('moveAgentDepartment(p.cfg, p.networkId, nodeId, pickDept)') && screen.includes('previous ? [...rest, previous] : rest'));
  ck('页面根始终在,且不再有演示条', screen.includes('testID="agent-org-page"') && !screen.includes('return null') && !screen.includes('agent-org-demo-banner'));
  ck('桌面和手机都挂这页,并带上已保存的网络', settings.includes('<AgentOrgScreen cfg={cfg} networkId={me.networkId || cfg.networkId} phone={false} />') && settings.includes('renderAgentOrg: () => <AgentOrgScreen cfg={cfg} networkId={me.networkId || cfg.networkId} phone />') && phone.includes("case 'agentTeams': return <>{ctx.renderAgentOrg()}</>"));
  ck('设置里不再挂会点空的团队入口', !settings.includes('AgentTeamsEntry') && !phone.includes('renderAgentTeams') && !existsSync(new URL('./AgentTeamsEntry.tsx', import.meta.url)));
  ck('手机列表行会进入子页', settings.includes('onPress={() => openPage(cat.key)}'));
  ck('不再有演示文案,标题/hint 指向真实保存', !('agentOrg.demoBanner' in agentOrgTranslations) && agentOrgTranslations['agentOrg.demoTitle'][0] === '调整结构' && agentOrgTranslations['agentOrg.demoHint'][0].includes('写入 Hub'));
  ck('失败态有 403/400/404/旧Hub 可读文案', ['agentOrg.saveForbidden', 'agentOrg.saveNoDepartment', 'agentOrg.saveNoNode', 'agentOrg.saveUnsupported'].every(k => (agentOrgTranslations as Record<string, readonly string[]>)[k]?.length === 2));
}

{
  const returned = { ...dept('new 1', 'New department', 'eng'), leader_user_id: 'leader', sort: 9 };
  const calls = await withFetch(() => json(201, { ok: true, department: returned }), async () => {
    ck('create returns authoritative department', (await createDepartment(cfg, 'net 1', { name: 'New department', parent_id: 'eng' })).id === returned.id);
    ck('rename returns preserved leader and sort', (await updateDepartment(cfg, 'net 1', 'new 1', { name: 'Renamed' })).leader_user_id === 'leader');
    ck('reparent returns authoritative sort', (await updateDepartment(cfg, 'net 1', 'new 1', { parent_id: null })).sort === 9);
  });
  ck('create uses exact department POST contract', calls[0].method === 'POST' && calls[0].url.endsWith('/networks/net%201/departments') && calls[0].body === JSON.stringify({ name: 'New department', parent_id: 'eng' }));
  ck('rename PATCH does not overwrite leader, sort or parent', calls[1].method === 'PATCH' && calls[1].url.endsWith('/departments/new%201') && calls[1].body === JSON.stringify({ name: 'Renamed' }));
  ck('root reparent PATCH sends explicit null only', calls[2].method === 'PATCH' && calls[2].body === JSON.stringify({ parent_id: null }));
  for (const [status, error] of [[403, 'department_scope_denied'], [409, 'department_name_taken'], [405, 'unsupported'], [400, 'department_cycle']] as const) {
    await withFetch(() => json(status, { ok: false, error }), async () => {
      let caught: unknown;
      try { await updateDepartment(cfg, 'net 1', 'eng', { parent_id: 'fe' }); } catch (e) { caught = e; }
      ck(`department failure ${status} preserves status/code, never succeeds`, caught instanceof OrgRequestError && caught.status === status && caught.code === error);
    });
  }
}

// #1894 —— 未归属几百个时，靠人手一个个点不现实。这里锁住「批量归入」的接线：
// 按钮只在未归属详情出现、只列真实部门、归入时走的是既有 PUT /nodes/:id/department。
{
  const screen = readFileSync(new URL('./AgentOrgScreen.tsx', import.meta.url), 'utf8');
  ck('bulk assign only shows on the unassigned detail', screen.includes("p.focus === null && filtered.length > 0 && p.onBulkAssign"));
  ck('bulk assign respects the current search filter', /t\('agentOrg\.bulkAssign', \{ count: filtered\.length \}\)/.test(screen));
  ck('bulk picker lists real departments only', /options=\{flattenTree\(orgTree\(p\.data\)\)\.map\(row => \(\{ id: row\.dept\.id/.test(screen));
  ck('bulk assign reuses the per-node department PUT', /moveAgentDepartment\(p\.cfg, p\.networkId, nodeId, departmentId\)/.test(screen));
  ck('bulk assign is bounded to 4 in flight', /\[0, 1, 2, 3\]\.map\(\(\) => worker\(\)\)/.test(screen));
  ck('bulk assign reports how many moved and failed', /t\('agentOrg\.bulkDone', \{ ok, fail \}\)/.test(screen));

// #2596 —— 同 alias 多节点：Hub 里这是**真实数据**（重装/换机后旧 node 行还在）。
// 以前全部显示成同名 Agent；现在按活跃度折叠成一个，并把被合并的 nodeId 保留下来。
{
  const NOW = Date.parse('2026-10-26T12:00:00Z');
  const day = 86_400_000;
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  // 同 alias（大小写不同也算同一个）、三个 nodeId，一个活跃、一个 3 天前、一个 30 天前
  const dup = placeAgents(data({
    owners: [owner('u1', 'eng', [
      { nodeId: 'n-old', alias: '通信欧', updatedAt: iso(30 * day), lifecycleState: 'active' },
      { nodeId: 'n-new', alias: '通信欧', updatedAt: iso(60_000), lifecycleState: 'active' },
      { nodeId: 'n-mid', alias: '通信欧', updatedAt: iso(3 * day), lifecycleState: 'active' },
    ], '爱丽丝')],
    unowned: [],
  }), [], { now: NOW });
  ck('🔴 同 alias 只留一行（最活跃的那个）', dup.filter(a => a.alias === '通信欧').length === 1);
  ck('留下的是 updated_at 最新的 nodeId', dup.find(a => a.alias === '通信欧')?.nodeId === 'n-new');
  ck('被合并的 nodeId 不丢，按活跃度排序', JSON.stringify(dup.find(a => a.alias === '通信欧')?.duplicateNodeIds) === JSON.stringify(['n-mid', 'n-old']));

  // 近 7 天默认过滤：30 天前的**独立** alias 应该被隐藏
  const stale = placeAgents(data({
    owners: [owner('u1', 'eng', [
      { nodeId: 'n-fresh', alias: '新节点', updatedAt: iso(2 * day) },
      { nodeId: 'n-stale', alias: '老节点', updatedAt: iso(30 * day) },
    ], '爱丽丝')],
    unowned: [],
  }), [], { now: NOW });
  ck('🔴 超过 7 天没动的 Agent 默认不显示', !stale.some(a => a.alias === '老节点') && stale.some(a => a.alias === '新节点'));
  ck('recentDays: 0 表示不过滤', placeAgents(data({
    owners: [owner('u1', 'eng', [{ nodeId: 'n-stale', alias: '老节点', updatedAt: iso(400 * day) }], '爱丽丝')],
    unowned: [],
  }), [], { now: NOW, recentDays: 0 }).some(a => a.alias === '老节点'));

  // 向后兼容：老 Hub 没有 updated_at ⇒ 既不过滤也不过早去重
  const legacy = placeAgents(data({
    owners: [owner('u1', 'eng', [
      { nodeId: 'n-a', alias: '旧节点' }, { nodeId: 'n-b', alias: '旧节点' },
    ], '爱丽丝')],
    unowned: [],
  }), [], { now: NOW });
  ck('🔴 老 Hub（无 updated_at）不过滤：两条同名都保留', legacy.filter(a => a.alias === '旧节点').length === 2);

  // 混合：只有一条有 updated_at 时，按“有时间的优先”，且没有时间的那条不被过滤掉
  const mixed = placeAgents(data({
    owners: [owner('u1', 'eng', [
      { nodeId: 'n-time', alias: '混合', updatedAt: iso(day) },
      { nodeId: 'n-untimed', alias: '混合' },
      { nodeId: 'n-noTime-old-alias', alias: '只有时间未知' },
    ], '爱丽丝')],
    unowned: [],
  }), [], { now: NOW });
  ck('有 updated_at 的行赢得折叠', mixed.find(a => a.alias === '混合')?.nodeId === 'n-time');
  ck('update_at 未知的行不会被当成“很久没动”而隐藏', mixed.some(a => a.alias === '只有时间未知'));

  // 大小写/空白不同的 alias 视为同一组
  const casey = placeAgents(data({
    owners: [owner('u1', 'eng', [
      { nodeId: 'n-x', alias: 'Bob', updatedAt: iso(day) },
      { nodeId: 'n-y', alias: 'bob', updatedAt: iso(2 * day) },
    ], '爱丽丝')],
    unowned: [],
  }), [], { now: NOW });
  ck('alias 大小写不同也折叠成一组', casey.filter(a => a.alias.toLowerCase() === 'bob').length === 1);
}

// #2596 —— 目录 JSON 解析：新字段只在存在时带上，老形状不受影响。
{
  const page = parseDirectoryPage({
    people: [{
      user_id: 'u1', username: 'alice', display_name: '爱丽丝', department: null,
      agents: [
        { node_id: 'n1', alias: '甲', updated_at: '2026-10-26 14:01:21', lifecycle_state: 'active' },
        { node_id: 'n2', alias: '乙' },
      ],
    }],
    has_more: false,
    agent_department_supported: true,
  });
  const a1 = page.people[0].agents[0];
  const a2 = page.people[0].agents[1];
  ck('解析 updated_at', a1.updatedAt === '2026-10-26 14:01:21');
  ck('解析 lifecycle_state', a1.lifecycleState === 'active');
  ck('老形状（无这两格）不塞 undefined 值以外的东西', a2.updatedAt === undefined && a2.lifecycleState === undefined);
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);

}
