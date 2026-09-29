// 任务看板纯逻辑:分组 / 筛选 / 排序、拖动状态机、新建校验、负责人请求体、状态 PATCH、详情编辑。
// ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import {
  applyFilter, applyMove, boardColumns, checkDraft, createInput, DRAG_IDLE, dragReduce, dropIndex, dueInfo, editDraftOf,
  editPatch, emptyDraft, localToday, neighbourColumn, nextSort, ownerCounts, ownerKeyOf, ownerLabel, ownersForScope,
  patchApplied, revertMove, scopeOf, sortRows, statusPatch, toggleIn, UNASSIGNED, type DragState,
  hasRoles, roleAvatars, roleKeysOf, roleKinds,
  addChecklistItem, checklistDropIndex, checklistProgress, hasDetails, moveChecklistItem, newChecklistId, removeChecklistItem, setChecklistDone,
} from './task-board-model';
import { createRequirementBody } from './requirements-hub';
import type { Requirement } from './requirements-model';
import type { RequirementPerson } from './requirement-people';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
// 源码断言读规范化副本:Windows 检出是 CRLF,路径按 POSIX 拼。
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name: `任务${id}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: `2026-09-2${id.length}T00:00:00Z`, owner: null, participants: [], ...o,
});
const NODE_A = { kind: 'node' as const, id: 'node_demo_a' };
const NODE_B = { kind: 'node' as const, id: 'node_demo_b' };
const ME = { kind: 'user' as const, id: 'u_me' };
const people: RequirementPerson[] = [
  { ...NODE_A, name: 'demo-node-a', networkId: 'n' },
  { ...NODE_B, name: 'demo-node-b', networkId: 'n' },
  { ...ME, name: '测试者', networkId: 'n' },
];
const items: Requirement[] = [
  R('a', { priority: 'high', owner: NODE_A, due: '2026-09-20' }),
  R('b', { priority: 'low', owner: NODE_B, column: 'doing' }),
  R('c', { priority: 'normal', owner: ME, due: '2026-10-05', column: 'doing' }),
  R('d', { priority: 'high', owner: null, column: 'done' }),
  R('e', { priority: 'normal', owner: NODE_A, due: '2026-10-01' }),
];

console.log('# 分组 / 筛选');
{
  const cols = boardColumns(items, { owners: [], priorities: [] });
  ck('三列固定顺序', cols.map(c => c.column).join() === 'pool,doing,done');
  ck('列内按优先级 → 期限排', cols[0].items.map(i => i.id).join() === 'a,e', cols[0].items.map(i => i.id).join());
  ck('列的数目 = 卡片数', cols.map(c => c.items.length).join() === '2,2,1');
  const byNode = boardColumns(items, { owners: ['node:node_demo_a'], priorities: [] });
  ck('按负责人筛后列数跟着变', byNode.map(c => c.items.length).join() === '2,0,0');
  ck('未分配是一个可筛的负责人', applyFilter(items, { owners: [UNASSIGNED], priorities: [] }).map(i => i.id).join() === 'd');
  ck('负责人 × 优先级是「且」', applyFilter(items, { owners: ['node:node_demo_a'], priorities: ['normal'] }).map(i => i.id).join() === 'e');
  ck('多个负责人是「或」', applyFilter(items, { owners: ['node:node_demo_a', 'node:node_demo_b'], priorities: [] }).length === 3);
  ck('旧 Hub 卡片(owner undefined)按未分配算', ownerKeyOf({ owner: undefined }) === UNASSIGNED);
  ck('toggleIn 加 / 去', toggleIn(['a'], 'b').join() === 'a,b' && toggleIn(['a', 'b'], 'a').join() === 'b');
  const counts = ownerCounts(items, people);
  const shape = counts.map(c => `${c.name}:${c.count}`).join();
  ck('负责人列表:数目降序,同数按名字(zh 排序),未分配在最后', shape === 'demo-node-a:2,测试者:1,demo-node-b:1,未分配:1', shape);
  ck('名字取不到就用 id', ownerLabel(R('x', { owner: { kind: 'node', id: 'node_gone' } }), people) === 'node_gone');
  ck('旧 Hub 显示旧的 assignee 文本', ownerLabel({ owner: undefined, assignee: '旧节点' }, people) === '旧节点');
}

console.log('# 左栏 ↔ 头部筛选是同一份状态');
{
  ck('全部 = 不筛', ownersForScope('all', 'u_me').length === 0 && scopeOf([], 'u_me') === 'all');
  ck('我负责的 = user:<我>', ownersForScope('mine', 'u_me').join() === 'user:u_me' && scopeOf(['user:u_me'], 'u_me') === 'mine');
  ck('不知道我是谁时「我负责的」不筛成空', ownersForScope('mine', null).length === 0);
  ck('按节点', scopeOf(['node:node_demo_a'], null) === 'node:node_demo_a');
  ck('头部多选时左栏一项都不亮', scopeOf(['node:node_demo_a', 'node:node_demo_b'], null) === null);
  ck('未分配', scopeOf([UNASSIGNED], null) === 'unassigned');
}

console.log('# 列表排序');
{
  const byDue = sortRows(items, { key: 'due', dir: 'asc' }).map(i => i.id).join();
  ck('期限升序,空期限在最后', byDue === 'a,e,c,d,b', byDue);
  const byDueDesc = sortRows(items, { key: 'due', dir: 'desc' }).map(i => i.id).join();
  ck('期限降序,空期限仍在最后', byDueDesc === 'c,e,a,d,b', byDueDesc);
  ck('优先级升序 = 高在前', sortRows(items, { key: 'priority', dir: 'asc' })[0].priority === 'high');
  ck('状态排序按 需求池 → 进行中 → 完成', sortRows(items, { key: 'status', dir: 'asc' }).map(i => i.column).join() === 'pool,pool,doing,doing,done');
  const byOwner = sortRows(items, { key: 'owner', dir: 'asc' }, people).map(i => i.id).join();
  ck('负责人按名字排(zh),同名按看板顺序,未分配在最后', byOwner === 'c,a,e,b,d', byOwner);
  ck('再点同一列反向,换列从升序开始', nextSort({ key: 'due', dir: 'asc' }, 'due').dir === 'desc' && nextSort({ key: 'due', dir: 'desc' }, 'title').dir === 'asc');
  ck('排序不改原数组', items[0].id === 'a');
}

console.log('# 期限');
{
  ck('逾期(红)', JSON.stringify(dueInfo('2026-09-20', '2026-09-29')) === JSON.stringify({ label: '逾期 9 天', tone: 'overdue' }));
  ck('今天 / 明天', dueInfo('2026-09-29', '2026-09-29').label === '今天' && dueInfo('2026-09-30', '2026-09-29').label === '明天');
  ck('同年只写月日,跨年带年', dueInfo('2026-10-05', '2026-09-29').label === '10月5日' && dueInfo('2027-01-02', '2026-09-29').label === '2027年1月2日');
  ck('已完成不算逾期', dueInfo('2026-09-20', '2026-09-29', 'done').tone === 'normal');
  ck('无期限不显示', dueInfo('', '2026-09-29').tone === 'none');
  ck('跨月天数按日历算', dueInfo('2026-08-31', '2026-09-01').label === '逾期 1 天');
  ck('localToday 用本地日期(不是 UTC)', localToday(new Date(2026, 0, 1, 0, 30)) === '2026-01-01');
}

console.log('# 拖动状态机');
{
  let st: DragState = DRAG_IDLE;
  const run = (ev: Parameters<typeof dragReduce>[1]) => { const step = dragReduce(st, ev); st = step.state; return step; };
  run({ type: 'down', id: 'a', from: 'pool', x: 100, y: 100 });
  ck('按下 = pressing', st.phase === 'pressing');
  run({ type: 'move', x: 102, y: 102, over: 'pool' });
  ck('没过 5px 还是点击', st.phase === 'pressing');
  const upClick = dragReduce(st, { type: 'up', over: 'pool' });
  ck('没拖就松手:不提交、不吞点击', !upClick.commit && !upClick.swallowClick && upClick.state.phase === 'idle');
  run({ type: 'move', x: 140, y: 100, over: 'doing' });
  ck('过了阈值 = dragging,记下悬停列', st.phase === 'dragging' && st.over === 'doing');
  const drop = run({ type: 'up', over: 'doing' });
  ck('落到别的列 = 提交 {id,from,to}', JSON.stringify(drop.commit) === JSON.stringify({ id: 'a', from: 'pool', to: 'doing' }) && !!drop.swallowClick && st.phase === 'idle');
  run({ type: 'down', id: 'a', from: 'pool', x: 0, y: 0 });
  run({ type: 'move', x: 50, y: 0, over: 'pool' });
  const same = run({ type: 'up', over: 'pool' });
  ck('落回原列:不写 Hub,但吞掉点击', !same.commit && !!same.swallowClick);
  run({ type: 'down', id: 'a', from: 'pool', x: 0, y: 0 });
  run({ type: 'move', x: 50, y: 0, over: 'done' });
  const outside = run({ type: 'up', over: null });
  ck('落在列外:取消', !outside.commit);
  run({ type: 'down', id: 'a', from: 'pool', x: 0, y: 0 });
  run({ type: 'move', x: 50, y: 0, over: 'done' });
  const esc = run({ type: 'cancel' });
  ck('Esc:取消且回到 idle', !esc.commit && st.phase === 'idle' && !!esc.swallowClick);
  ck('idle 时的 move / up 什么都不做', !dragReduce(DRAG_IDLE, { type: 'move', x: 1, y: 1, over: 'doing' }).commit && dragReduce(DRAG_IDLE, { type: 'up' }).state.phase === 'idle');
  const doing = boardColumns(items, { owners: [], priorities: [] })[1].items;
  ck('落点:高优先级落在进行中第一位', dropIndex(doing, items[0], 'doing') === 0);
  ck('落点:低优先级落在最后', dropIndex(boardColumns(items, { owners: [], priorities: [] })[0].items, items[1], 'pool') === 2);
  ck('键盘换列到头不动', neighbourColumn('pool', -1) === null && neighbourColumn('pool', 1) === 'doing' && neighbourColumn('done', 1) === null);
}

console.log('# 乐观移动 + 状态 PATCH');
{
  const moved = applyMove(items, 'a', 'doing');
  ck('本地立刻换列(数目立刻变)', boardColumns(moved, { owners: [], priorities: [] }).map(c => c.items.length).join() === '1,3,1');
  ck('失败退回原列', revertMove(moved, 'a', 'pool', 'doing').find(i => i.id === 'a')!.column === 'pool');
  ck('期间被别处改过就不覆盖', revertMove(applyMove(moved, 'a', 'done'), 'a', 'pool', 'doing').find(i => i.id === 'a')!.column === 'done');
  ck('状态 PATCH 只带 column', JSON.stringify(statusPatch('done')) === '{"column":"done"}');
}

console.log('# 新建校验 + 负责人请求体');
{
  ck('空标题', !checkDraft({ name: '  ', due: '' }).ok);
  ck('超长标题', !checkDraft({ name: 'x'.repeat(81), due: '' }).ok);
  const bad = checkDraft({ name: '甲', due: '2026-02-30' });
  ck('坏日期指向 due 字段', !bad.ok && bad.field === 'due');
  ck('日期可空', checkDraft({ name: '甲', due: '' }).ok);
  ck('坏草稿不产生请求', createInput({ ...emptyDraft(), name: '' }) === null);
  const withOwner = createInput({ ...emptyDraft('doing'), name: ' 新任务 ', owner: { kind: 'node', id: 'node_demo_a', name: '显示名', networkId: 'n' } as never, due: '2026-10-01', priority: 'high' })!;
  ck('负责人只带 {kind,id}', JSON.stringify(withOwner.owner) === '{"kind":"node","id":"node_demo_a"}');
  ck('assignee 永远空串', withOwner.assignee === '');
  ck('列尾添加带着那一列', withOwner.column === 'doing' && withOwner.name === '新任务');
  ck('不选负责人就不带 owner 字段', !('owner' in createInput({ ...emptyDraft(), name: '甲' })!));
  const body = createRequirementBody({ serverUrl: 'http://hub.test', token: 't', networkId: 'n' }, { ...withOwner, owner: { kind: 'node', id: 'node_demo_a', name: 'x' } as never });
  ck('POST 请求体:owner {kind,id}、assignee 空、带 network_id', JSON.stringify(body.owner) === '{"kind":"node","id":"node_demo_a"}' && body.assignee === '' && body.network_id === 'n' && body.column === 'doing');
}

console.log('# 详情编辑(#488 + 负责人)');
{
  const item = items[0];
  ck('没改就没有 patch(保存按钮不可用)', editPatch(item, editDraftOf(item)) === null);
  ck('只提交改过的字段', JSON.stringify(editPatch(item, { ...editDraftOf(item), name: '新标题 ' })) === '{"name":"新标题"}');
  ck('改负责人:{kind,id}', JSON.stringify(editPatch(item, { ...editDraftOf(item), owner: NODE_B })) === '{"owner":{"kind":"node","id":"node_demo_b"}}');
  ck('清空负责人 = null', JSON.stringify(editPatch(item, { ...editDraftOf(item), owner: null })) === '{"owner":null}');
  const legacy = R('z', { owner: undefined, participants: undefined });
  ck('旧 Hub 不提交负责人', editPatch(legacy, { ...editDraftOf(legacy), owner: NODE_A }) === null);
  ck('Hub 带回了改动 = 生效', patchApplied({ ...item, name: '新' }, { name: '新' }));
  ck('Hub 忽略了字段 = 没生效(老 Hub 回 200)', !patchApplied(item, { name: '新' }) && !patchApplied(item, { owner: NODE_B }));
}


console.log('# 负责人(人类)/ 负责 Agent 两个角色');
{
  const two = [
    R('p', { owner: ME, agentOwner: NODE_A }),
    R('q', { owner: null, agentOwner: NODE_B }),
    R('r', { owner: ME, agentOwner: null }),
    R('s', { owner: null, agentOwner: null }),
  ];
  ck('行里有 agent_owner 字段 = 分两个角色', hasRoles(two[0]) && !hasRoles(R('legacy', { agentOwner: undefined })));
  ck('卡片头像:人类在前、Agent 在后', roleAvatars(two[0], people).map(a => `${a.role}:${a.name}`).join() === 'owner:测试者,agent:demo-node-a');
  ck('只有 Agent 时只画 Agent', roleAvatars(two[1], people).map(a => a.role).join() === 'agent');
  ck('两个角色都没有 = 未分配', roleKeysOf(two[3]).join() === UNASSIGNED && roleKeysOf(two[0]).join() === 'user:u_me,node:node_demo_a');
  ck('「我负责的」只看负责人', applyFilter(two, { owners: ['user:u_me'], priorities: [] }).map(i => i.id).join() === 'p,r');
  ck('「按 Agent」只看负责 Agent', applyFilter(two, { owners: ['node:node_demo_a'], priorities: [] }).map(i => i.id).join() === 'p');
  ck('未分配 = 两个都空', applyFilter(two, { owners: [UNASSIGNED], priorities: [] }).map(i => i.id).join() === 's');
  const c = ownerCounts(two, people);
  ck('计数:一张卡同时算进负责人和负责 Agent', c.find(x => x.key === 'user:u_me')?.count === 2 && c.find(x => x.key === 'node:node_demo_a')?.count === 1 && c.find(x => x.key === UNASSIGNED)?.count === 1);
  ck('文字:负责人 · 负责 Agent', ownerLabel(two[0], people) === '测试者 · demo-node-a');
  ck('选择器种类:负责人只列人类,负责 Agent 只列节点,旧 Hub 两种都列', roleKinds('owner', true).join() === 'user' && roleKinds('agent', true).join() === 'node' && roleKinds('owner', false).join() === 'user,node');
  const d = { ...emptyDraft(), name: '两个角色', owner: ME, agentOwner: NODE_A };
  const both = createInput(d, true)!;
  ck('新建:owner {user}、agentOwner {node} 都只带 {kind,id}', JSON.stringify(both.owner) === '{"kind":"user","id":"u_me"}' && JSON.stringify(both.agentOwner) === '{"kind":"node","id":"node_demo_a"}');
  ck('新建:两个角色的 Hub 上节点不能当负责人(不发)', !('owner' in createInput({ ...d, owner: NODE_B }, true)!));
  ck('新建:旧 Hub 不发负责 Agent,单一负责人照旧', !('agentOwner' in createInput(d, false)!) && JSON.stringify(createInput({ ...d, owner: NODE_B }, false)!.owner) === '{"kind":"node","id":"node_demo_b"}');
  const body = createRequirementBody({ serverUrl: 'http://hub.test', token: 't', networkId: 'n' }, both);
  ck('POST 请求体带 agent_owner {kind,id}', JSON.stringify(body.agent_owner) === '{"kind":"node","id":"node_demo_a"}' && JSON.stringify(body.owner) === '{"kind":"user","id":"u_me"}');
  ck('POST 请求体:没选负责 Agent 就没有这个字段', createRequirementBody({ serverUrl: 'x', token: 't' }, createInput({ ...d, agentOwner: null }, true)!).agent_owner === undefined);
  const item = two[0];
  ck('详情:只改负责 Agent → {agent_owner}', JSON.stringify(editPatch(item, { ...editDraftOf(item), agentOwner: NODE_B })) === '{"agent_owner":{"kind":"node","id":"node_demo_b"}}');
  ck('详情:清空负责 Agent = null', JSON.stringify(editPatch(item, { ...editDraftOf(item), agentOwner: null })) === '{"agent_owner":null}');
  const legacy = R('old', { owner: NODE_A, agentOwner: undefined });
  ck('详情:旧 Hub 不发 agent_owner', editPatch(legacy, { ...editDraftOf(legacy), agentOwner: NODE_B }) === null);
  ck('Hub 忽略了 agent_owner = 没生效', !patchApplied(item, { agent_owner: NODE_B }) && patchApplied({ ...item, agentOwner: NODE_B }, { agent_owner: NODE_B }));
}


console.log('# 描述 / 子任务');
{
  const list = [{ id: 'a', text: '一', done: true }, { id: 'b', text: '二', done: false }, { id: 'c', text: '三', done: false }];
  ck('进度 1/3', JSON.stringify(checklistProgress(list)) === JSON.stringify({ done: 1, total: 3, ratio: 1 / 3 }));
  ck('没有子任务 = 0/0,不画', checklistProgress(undefined).total === 0 && checklistProgress([]).ratio === 0);
  ck('Hub 带两个字段才算支持', hasDetails({ description: '', checklist: [] }) && !hasDetails({ description: undefined, checklist: undefined }));
  const added = addChecklistItem(list, '  四\n行  ', 'd')!;
  ck('添加:折成一行、去空白、默认未完成', JSON.stringify(added[3]) === '{"id":"d","text":"四 行","done":false}');
  ck('添加:空文字 / 超长 / 满 100 项被拒', addChecklistItem(list, '  ') === null && addChecklistItem(list, 'x'.repeat(501)) === null && addChecklistItem(Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, text: 't', done: false })), 'x') === null);
  ck('生成的 id 满足 Hub 的格式', /^ck_[0-9a-f]{16}$/.test(newChecklistId()));
  ck('勾选只动那一项', setChecklistDone(list, 'b', true).map(i => i.done).join() === 'true,true,false');
  ck('删除', removeChecklistItem(list, 'b').map(i => i.id).join() === 'a,c');
  ck('排序:把第一项挪到最后', moveChecklistItem(list, 0, 2).map(i => i.id).join() === 'b,c,a');
  ck('排序:越界 / 不动返回同一个数组', moveChecklistItem(list, 0, 0) === list && moveChecklistItem(list, 0, 9) === list);
  const rows = [{ top: 0, bottom: 36 }, { top: 36, bottom: 72 }, { top: 72, bottom: 108 }];
  ck('拖动落点:拖第一项到第三行下半 → 2', checklistDropIndex(rows, 100, 0) === 2);
  ck('拖动落点:拖第三项到第一行上半 → 0', checklistDropIndex(rows, 5, 2) === 0);
  ck('拖动落点:在自己那一行里不动', checklistDropIndex(rows, 50, 1) === 1);
  const item = R('m', { description: '旧描述', checklist: list });
  ck('描述跟「保存修改」一起走,只发改过的', JSON.stringify(editPatch(item, { ...editDraftOf(item), description: '新\r\n描述' })) === '{"description":"新\\n描述"}');
  ck('旧 Hub 不发描述', editPatch(R('n'), { ...editDraftOf(R('n')), description: 'x' }) === null);
  ck('Hub 带回描述 = 生效', patchApplied({ ...item, description: '新' }, { description: '新' }) && !patchApplied(item, { description: '新' }));
  ck('清单替换:Hub 回来的顺序对得上 = 生效', patchApplied({ ...item, checklist: [list[2], list[0], list[1]] }, { checklist: [list[2], list[0], list[1]] }) && !patchApplied(item, { checklist: [list[2], list[0], list[1]] }));
}

console.log('# 界面接线(源码)');
{
  const board = src('./RequirementBoard.tsx');
  const dom = src('./task-board-dom.ts');
  ck('不再有常驻输入框和开发说明', !board.includes('存在 Hub 上，手机和电脑是同一份。') && !board.includes('新建一条需求'));
  ck('卡片没有「查看详情」文字链接', !board.includes('>查看详情<'));
  ck('长按只在触屏(phone-only 守卫的形状)', /onLongPress=\{pointer \? undefined :/.test(board));
  ck('拖动只在鼠标界面启用', /useTaskCardDom\(pointer && /.test(board));
  ck('拖动 / 右键 / 键盘挂在 document 捕获阶段', /addEventListener\('pointerdown', down, true\)/.test(dom) && /addEventListener\('contextmenu', context, true\)/.test(dom) && /addEventListener\('keydown', key, true\)/.test(dom));
  ck('三列等分:flex 1 + flexBasis 0', /column: \{ flex: 1, flexBasis: 0, minWidth: 0/.test(src('./TaskBoardParts.tsx')));
  ck('新建 / 编辑 / 换列都走 Hub', board.includes('createRequirementOnHub(') && board.includes('updateRequirementOnHub(') && board.includes('moveRequirementOnHub('));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
