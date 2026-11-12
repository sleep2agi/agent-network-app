import { setLanguagePreference } from './i18n';
// 节点管理授权模型:显示文案、增删(同能力同范围替换级别)、草稿完整性、错误人话。
import { addGrant, capabilityOffered, draftComplete, GRANT_CAPABILITIES, grantErrorText, grantLine, removeGrant, type GrantDraft } from './node-grants-model';

setLanguagePreference('zh');
let n = 0;
const ck = (name: string, ok: boolean) => { if (!ok) { console.error('FAIL', name); process.exit(1); } n++; };
const depts = [{ id: 'd_tm', path: 'TMAI / TMWork' }];
const nodes = [{ key: 'n_a', node_id: 'n_a', alias: '神明' } as any];
const net: GrantDraft = { capability: 'schedules', scope_kind: 'network', scope_id: '', level: 'edit' };
const dep: GrantDraft = { capability: 'schedules', scope_kind: 'department', scope_id: 'd_tm', level: 'read' };
const nod: GrantDraft = { capability: 'schedules', scope_kind: 'node', scope_id: 'n_a', level: 'edit' };

ck('全网显示', grantLine(net, depts, nodes) === '定时任务 · 整个网络 · 可编辑');
ck('部门显示路径', grantLine(dep, depts, nodes) === '定时任务 · 部门 TMAI / TMWork · 只读');
ck('节点显示别名', grantLine(nod, depts, nodes) === '定时任务 · 节点 神明 · 可编辑');
ck('不认识的部门显示 id', grantLine({ ...dep, scope_id: 'd_x' }, depts, nodes).includes('d_x'));
ck('同能力同范围再加一次 = 替换级别,不重复', (() => { const l = addGrant([dep], { ...dep, level: 'edit' }); return l.length === 1 && l[0].level === 'edit'; })());
ck('不同范围各一条', addGrant([net], dep).length === 2);
ck('撤销只删那一条', (() => { const l = removeGrant([net, dep, nod], dep); return l.length === 2 && !l.some(x => x.scope_kind === 'department'); })());
ck('部门 / 节点范围没选对象不能提交', draftComplete(net) && !draftComplete({ ...dep, scope_id: '' }) && !draftComplete({ ...nod, scope_id: '' }));
ck('403 说清楚谁能授', grantErrorText({ status: 403, error: 'permission_denied' }).includes('节点主人不能'));
ck('能力未开放', grantErrorText({ status: 400, error: 'capability_not_supported' }).includes('还不支持'));
// 第二期·任务看板：Hub 侧 GRANT_CAPABILITIES_PLANNED 已清空 ⇒ 本端必须同步开闸，
// 否则用户看到「即将支持」而 Hub 其实已经接受 board 授权（#4616 二期）。
ck('board 可选（与 Hub 同步开闸）', GRANT_CAPABILITIES.find(c => c.key === 'board')?.available === true);
ck('schedules 仍可选', GRANT_CAPABILITIES.find(c => c.key === 'schedules')?.available === true);
ck('board 授权行显示任务看板', grantLine({ ...net, capability: 'board' }, depts, nodes) === '任务看板 · 整个网络 · 可编辑');
ck('board 只读行', grantLine({ ...dep, capability: 'board' }, depts, nodes) === '任务看板 · 部门 TMAI / TMWork · 只读');
// 兼容：服务器能力清单（GET /grants 的 capabilities）。没给 = 老 Hub = 未知 ⇒ 放行；
// 一期 Hub 只报 ["schedules"] ⇒ board 必须显示「即将支持」，不能让用户点下去才吃 400。
ck('老 Hub 没给清单 ⇒ 未知放行', capabilityOffered(undefined, 'board') && capabilityOffered(undefined, 'schedules'));
ck('一期 Hub 只报 schedules ⇒ board 不可选', capabilityOffered(['schedules'], 'board') === false && capabilityOffered(['schedules'], 'schedules') === true);
ck('新 Hub 报两个 ⇒ 都可选', capabilityOffered(['schedules', 'board'], 'board') && capabilityOffered(['schedules', 'board'], 'schedules'));
console.log(`node grants model: ${n}/${n}`);
