// 从看板直接指派(task-assign.ts):卡片菜单「指派负责人… / 设置参与人…」、点卡片上的参与人头像、批量「指派负责人…」、
// 详情里负责人立即保存 + 参与人挪出「更多」。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { assignAccess, bulkOwnerPlan, canAssignPeople, openedParticipants, ownerChange, participantsChange, revertAssign } from './task-assign';
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
  // owner 10-07:看板「设置参与人」也能选 Agent(和详情 / 新建一样),读-改-写。
  ck('参与人选择器带入现有全部参与人(人类 + Agent,去重)', JSON.stringify(openedParticipants(R('a', { participants: [AMY, BOT, AMY] }))) === JSON.stringify([AMY, BOT]));
  ck('参与人同一组人(顺序不同)= 不发', participantsChange(R('a', { participants: [AMY, BEN] }), [AMY, BEN], [BEN, AMY]) === null);
  const keep = participantsChange(R('a', { participants: [AMY, BOT] }), [AMY, BOT], [BEN, BOT]);
  ck('换人类、Agent 留着', JSON.stringify(keep) === JSON.stringify({ participants: [BOT, BEN] }), JSON.stringify(keep));
  ck('看板选 Agent:收,存 {kind:node,id}', JSON.stringify(participantsChange(R('a', { participants: [AMY] }), [AMY], [AMY, BOT])) === JSON.stringify({ participants: [AMY, BOT] }));
  ck('去掉 Agent:只去它', JSON.stringify(participantsChange(R('a', { participants: [AMY, BOT] }), [AMY, BOT], [AMY])) === JSON.stringify({ participants: [AMY] }));
  const raced = participantsChange(R('a', { participants: [AMY, BEN] }), [AMY], [AMY, BOT]);
  ck('读-改-写:选择器开着时别人加的 BEN 不被冲掉', JSON.stringify(raced) === JSON.stringify({ participants: [AMY, BEN, BOT] }), JSON.stringify(raced));
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
    await saveRequirementAssignments(cfg as never, 'r1', participantsChange(R('r1', { participants: [AMY] }), [AMY], [BEN, BOT])!);
    ck('设置参与人 = PATCH,体正好是 {"participants":[…]}(人类 + {kind:node,id},没有 owner)', sent[1]?.method === 'PATCH' && JSON.stringify(sent[1].body) === JSON.stringify({ participants: [BEN, BOT] }), JSON.stringify(sent[1]));
  } finally { globalThis.fetch = orig; }
}

console.log('# 接线(源码)');
{
  const menu = src('./TaskCardMenu.tsx');
  ck('菜单:查看详情之后是 指派负责人… / 设置参与人…', menu.indexOf("item('open'") < menu.indexOf("(['owner', 'participants'] as const).map") && menu.includes("`assign-${mode}`"));
  ck('菜单:旧 Hub 的卡不画、只读的卡灰掉', menu.includes("target.assign !== 'hidden' ?") && menu.includes("disabled: target.assign === 'locked'"));
  // 审计 M2 起桌面菜单还列优先级各档(priorityRows),H2 起末尾还有「归档」(archiveRow),高度一并算进去。
  ck('菜单高度算上这两行(放不下时照样翻边)', menu.includes('const count = 1 + assignRows + (touch ? 2 : columns.length) + priorityRows + archiveRow;'));
  const board = src('./RequirementBoard.tsx');
  // 右键 / 长按 / 列表行 ⋯ 都经 menuTarget(审计 M2 合成一个),它带 assign 权限。
  ck('右键 / 长按的目标都带 assign 权限', /const menuTarget = \(item: Requirement, x: number, y: number\): TaskMenuTarget => \(\{[\s\S]*?assign: assignAccess\(item\)/.test(board) && (board.match(/setMenu\(menuTarget\(item, x, y\)\)/g) ?? []).length === 2);
  ck('卡片菜单打开的是同一个 RequirementPeoplePicker(新建 / 详情用的那个)', board.includes('<RequirementPeoplePicker') && board.includes("onAssign={(id, mode) => { void openAssign(id, mode); }}"));
  ck('负责人选择器:分两个角色的 Hub 上只列人类(roleKinds);参与人人类 + Agent(不限种类)', board.includes("kinds={assignFor.mode === 'owner' ? roleKinds('owner', hasRoles(assignItem)) : undefined}"));
  ck('看板参与人:打开时记下 opened,确认时 participantsChange(item, target.opened, picked)', board.includes('const opened = openedParticipants(item);') && board.includes('participantsChange(item, target.opened, picked)') && board.includes(': assignFor.opened}'));
  ck('参与人头像:能改 = 设置参与人,不能改 = 打开详情', board.includes("canAssignPeople(item) ? (stack?: any) => { void openAssign(item.id, 'participants', stack); } : () => openDetail(item.id)"));
  ck('看板和手机列表的卡片底部都接上', (board.match(/onParticipants=\{onParticipants\(item\)\}/g) ?? []).length === 2);
  ck('写入前先挡只读(兜底)', /const assign = async[\s\S]*?const blocked = readOnlyBlock\(id\);\s*if \(blocked\) return blocked;/.test(board));
  ck('批量:指派负责人按钮 + 跳过数', board.includes("btn('owner', tr('bulk.owner')") && board.includes('bulkOwnerPlan(items, ids)') && board.includes("tr('bulk.skipped'"));
  const parts = src('./TaskBoardParts.tsx');
  ck('参与人头像可点(onPress),点的范围放大', /export function ParticipantStack[\s\S]*?onPress=\{onPress \? \(\) => onPress\(stackEl\.current\) : undefined\}[\s\S]*?hitSlop=/.test(parts));
  const detail = src('./TaskDetailPanel.tsx');
  // #701:属性(负责人 … 标签 + 更多)是右栏的一块 `const properties = (`,在 `const banners = (` 之前。
  const body = detail.slice(detail.indexOf('const properties = ('), detail.indexOf('const banners = ('));
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
