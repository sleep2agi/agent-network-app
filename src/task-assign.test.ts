// 从看板直接指派(task-assign.ts):卡片菜单「指派负责人… / 设置参与人…」、点卡片上的参与人头像、批量「指派负责人…」、
// 详情里负责人立即保存 + 参与人挪出「更多」。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { assignAccess, bulkOwnerPlan, canAssignPeople, humanParticipants, ownerChange, participantsChange, revertAssign } from './task-assign';
import { saveRequirementAssignments } from './requirement-people-api';
import { updateRequirementOnHub } from './requirements-hub';
import { lockedMainRows, lockedRestRows } from './task-detail-locked';
import { setLanguagePreference, t } from './i18n';
import './i18n-tasks';
import type { Requirement } from './requirements-model';

let p = 0, n = 0;
const ck = (name: string, c: boolean, extra = '') => { n++; if (c) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const AMY = { kind: 'user' as const, id: 'u_amy' };
const BEN = { kind: 'user' as const, id: 'u_ben' };
const BOT = { kind: 'node' as const, id: 'node_demo_a' };
const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({ id, name: `示例任务${id}`, assignee: '', priority: 'normal', due: '', column: 'pool', createdAt: '', owner: null, participants: [], ...o } as Requirement);

console.log('# 权限:谁能从看板改人');
{
  ck('能改的卡 = on', assignAccess(R('a')) === 'on' && canAssignPeople(R('a')));
  ck('只读的卡(viewer_can.edit=false)= locked', assignAccess(R('b', { readOnly: true })) === 'locked' && !canAssignPeople(R('b', { readOnly: true })));
  ck('参与人的卡(edit_fields 只有状态和检查项)也是 locked —— Hub 不许参与人改人', assignAccess(R('c', { readOnly: true, editFields: ['column', 'checklist'] })) === 'locked');
  ck('旧 Hub 的卡(没有 owner / participants)= hidden,菜单不给入口', assignAccess(R('d', { owner: undefined, participants: undefined })) === 'hidden' && assignAccess(R('e', { participants: undefined })) === 'hidden');
}

console.log('# 只发改了的');
{
  ck('负责人没变 = 不发', ownerChange(R('a', { owner: AMY }), [AMY]) === null && ownerChange(R('a'), []) === null);
  ck('换负责人 = { owner }(只带 kind,id)', JSON.stringify(ownerChange(R('a', { owner: AMY }), [{ ...BEN, name: '显示名' } as never])) === JSON.stringify({ owner: BEN }));
  ck('清空负责人 = { owner: null }', JSON.stringify(ownerChange(R('a', { owner: AMY }), [])) === '{"owner":null}');
  ck('参与人选择器只带入人类', JSON.stringify(humanParticipants(R('a', { participants: [AMY, BOT, AMY] }))) === JSON.stringify([AMY]));
  ck('参与人同一组人(顺序不同)= 不发', participantsChange(R('a', { participants: [AMY, BEN] }), [BEN, AMY]) === null);
  const keep = participantsChange(R('a', { participants: [AMY, BOT] }), [BEN]);
  ck('改人类参与人时,原有的 Agent 参与人保留(选择器里看不到它,不能悄悄删掉)', JSON.stringify(keep) === JSON.stringify({ participants: [BEN, BOT] }), JSON.stringify(keep));
  ck('选择器塞进来的 Agent 不收', JSON.stringify(participantsChange(R('a'), [AMY, BOT])) === JSON.stringify({ participants: [AMY] }));
  const prev = R('a', { owner: AMY, participants: [AMY], agentOwner: BOT });
  const back = revertAssign({ ...prev, owner: BEN, name: '别处改的标题' }, prev, { owner: BEN });
  ck('失败只退回改的那个字段', back.owner === AMY && back.name === '别处改的标题' && back.participants === prev.participants);
}

console.log('# 批量指派负责人:跳过不能改的');
{
  const items = [R('a'), R('b', { readOnly: true }), R('c', { owner: undefined, participants: undefined }), R('d', { readOnly: true, editFields: ['column'] })];
  const plan = bulkOwnerPlan(items, ['a', 'b', 'c', 'd', 'gone']);
  ck('只改能改的,其余数进 skipped(不在看板上的不算)', JSON.stringify(plan) === JSON.stringify({ editable: ['a'], skipped: 3 }), JSON.stringify(plan));
  ck('全都不能改 = editable 空', bulkOwnerPlan(items, ['b']).editable.length === 0);
}

console.log('# 请求体(真函数 + 假 fetch)');
{
  const cfg = { serverUrl: 'http://hub.test', token: 't', networkId: 'net_demo' };
  const sent: { url: string; method: string; body: any }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url: String(input), method: init?.method || 'GET', body });
    const row = { id: 'r1', name: '示例任务', assignee: '', priority: 'normal', due: '', column: 'pool', owner: body?.owner ?? null, participants: body?.participants ?? [], agent_owner: body?.agent_owner ?? null };
    return Response.json({ requirement: row });
  }) as typeof fetch;
  try {
    await updateRequirementOnHub(cfg as never, 'r1', { owner: BEN });
    ck('指派负责人 = PATCH /api/requirements/r1,体正好是 {"owner":{kind,id}}', sent[0]?.method === 'PATCH' && /\/api\/requirements\/r1\?/.test(sent[0].url) && JSON.stringify(sent[0].body) === JSON.stringify({ owner: BEN }), JSON.stringify(sent[0]));
    await saveRequirementAssignments(cfg as never, 'r1', participantsChange(R('r1', { participants: [AMY, BOT] }), [BEN])!);
    ck('设置参与人 = PATCH,体正好是 {"participants":[…]}(没有 owner)', sent[1]?.method === 'PATCH' && JSON.stringify(sent[1].body) === JSON.stringify({ participants: [BEN, BOT] }), JSON.stringify(sent[1]));
  } finally { globalThis.fetch = orig; }
}

console.log('# 接线(源码)');
{
  const menu = src('./TaskCardMenu.tsx');
  ck('菜单:查看详情之后是 指派负责人… / 设置参与人…', menu.indexOf("item('open'") < menu.indexOf("(['owner', 'participants'] as const).map") && menu.includes("`assign-${mode}`"));
  ck('菜单:旧 Hub 的卡不画、只读的卡灰掉', menu.includes("target.assign !== 'hidden' ?") && menu.includes("disabled: target.assign === 'locked'"));
  ck('菜单高度算上这两行(放不下时照样翻边)', menu.includes('const count = 1 + assignRows + REQ_COLUMNS.length;'));
  const board = src('./RequirementBoard.tsx');
  ck('右键 / 长按的目标都带 assign 权限', (board.match(/assign: assignAccess\(item\)/g) ?? []).length === 2);
  ck('卡片菜单打开的是同一个 RequirementPeoplePicker(新建 / 详情用的那个)', board.includes('<RequirementPeoplePicker') && board.includes("onAssign={(id, mode) => { void openAssign(id, mode); }}"));
  ck('负责人选择器:分两个角色的 Hub 上只列人类(roleKinds);参与人只列人类', board.includes("kinds={assignFor.mode === 'owner' ? roleKinds('owner', hasRoles(assignItem)) : ['user']}"));
  ck('参与人头像:能改 = 设置参与人,不能改 = 打开详情', board.includes("canAssignPeople(item) ? () => { void openAssign(item.id, 'participants'); } : () => openDetail(item.id)"));
  ck('看板和手机列表的卡片底部都接上', (board.match(/onParticipants=\{onParticipants\(item\)\}/g) ?? []).length === 2);
  ck('写入前先挡只读(兜底)', /const assign = async[\s\S]*?const blocked = readOnlyBlock\(id\);\s*if \(blocked\) return blocked;/.test(board));
  ck('批量:指派负责人按钮 + 跳过数', board.includes("btn('owner', tr('bulk.owner')") && board.includes('bulkOwnerPlan(items, ids)') && board.includes("tr('bulk.skipped'"));
  const parts = src('./TaskBoardParts.tsx');
  ck('参与人头像可点(onPress),点的范围放大', /export function ParticipantStack[\s\S]*?onPress=\{onPress\}[\s\S]*?hitSlop=/.test(parts));
  const detail = src('./TaskDetailPanel.tsx');
  const body = detail.slice(detail.indexOf('const body: ReactNode = ('), detail.indexOf('const footer = ('));
  const at = (s: string) => body.indexOf(s);
  ck('详情:参与人紧跟负责人 / 负责 Agent,在项目 / 预计完成 / 「更多」之前', at('<RoleFields') < at('testID="req-participants-row"') && at('testID="req-participants-row"') < at('<ProjectSelect') && at('testID="req-participants-row"') < at('testID="req-more"'));
  ck('详情:「更多」里不再有参与人', !body.slice(at('testID="req-more"')).includes("tr('tasks.copy.53')"));
  ck('详情:负责人 / 负责 Agent 选完立即保存(不进草稿)', body.includes('onChange={p => { void assignRole(p); }}') && !body.includes('onChange={p => set(p)}'));
  ck('详情:保存中 / 已保存 / 失败 有一行', body.includes('testID="req-assign-status"') && body.includes('testID="req-assign-error"'));
}

console.log('# 只读详情:参与人那一行跟着挪');
{
  const item = R('a', { owner: AMY, participants: [AMY], readOnly: true });
  const people = [{ ...AMY, networkId: 'n', name: '示例成员甲' }];
  ck('锁住的常显区:优先级、负责人、参与人', lockedMainRows(item, people, null).map(r => r.key).slice(0, 3).join() === 'priority,owner,participants');
  ck('锁住的其余里没有参与人', !lockedRestRows(item, people).some(r => r.key === 'participants'));
}

console.log('# 文案');
{
  setLanguagePreference('zh');
  ck('中文', t('assign.owner') === '指派负责人…' && t('assign.participants') === '设置参与人…' && t('bulk.owner') === '指派负责人…' && t('bulk.skipped', { n: 2 }) === '跳过 2 个(无权修改)');
  setLanguagePreference('en');
  ck('English', t('assign.owner') === 'Assign owner…' && t('bulk.skipped', { n: 2 }) === '2 skipped (no permission)');
  setLanguagePreference('system');
}

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
