// 手机快捷改状态 / 优先级(task-quick-status.ts):左滑露出哪几个按钮、谁能滑、长按菜单的两个选择器、请求体只带一个字段、
// 撤销改回原状态。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { quickMenuAccess, SWIPE_ACTION_W, swipeActions, swipeFollow, swipeSettle, UNDO_MS } from './task-quick-status';
import { cellRequest } from './task-list-edit-model';
import { moveRequirementOnHub, updateRequirementOnHub } from './requirements-hub';
import type { Requirement } from './requirements-model';

let p = 0, n = 0;
const ck = (name: string, c: boolean, extra = '') => { n++; if (c) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const R = (o: Partial<Requirement> = {}): Requirement => ({ id: 'r1', name: '示例任务', assignee: '', priority: 'normal', due: '', column: 'pool', createdAt: '', owner: null, participants: [], ...o } as Requirement);
const PART: Partial<Requirement> = { readOnly: true, editFields: ['column', 'checklist'] };

console.log('# 左滑按钮');
{
  ck('需求池的卡:进行中 + 完成 + 更多', JSON.stringify(swipeActions(R())) === '["doing","done","more"]');
  ck('进行中的卡:不出「进行中」', JSON.stringify(swipeActions(R({ column: 'doing' }))) === '["done","more"]');
  ck('完成的卡:不出「完成」', JSON.stringify(swipeActions(R({ column: 'done' }))) === '["doing","more"]');
  ck('参与人的卡(edit_fields 含 column)也能滑', JSON.stringify(swipeActions(R(PART))) === '["doing","done","more"]');
  ck('只读的卡(没放开 column)一个按钮都没有 = 不能滑', swipeActions(R({ readOnly: true })).length === 0 && swipeActions(R({ readOnly: true, editFields: ['checklist'] })).length === 0);
}

console.log('# 手势落点');
{
  const W = 3 * SWIPE_ACTION_W;
  ck('拖过一半 = 整排打开', swipeSettle(-W / 2 - 1, false, W) === -W);
  ck('拖不到一半 = 收回', swipeSettle(-W / 2 + 10, false, W) === 0);
  ck('开着往右拉过一半 = 收回', swipeSettle(W / 2 + 1, true, W) === 0);
  ck('跟手不超出按钮宽、不往右拉出空白', swipeFollow(-999, false, W) === -W && swipeFollow(80, false, W) === 0);
  ck('按钮至少 44 宽', SWIPE_ACTION_W >= 44);
}

console.log('# 长按菜单的两个选择器');
{
  ck('能改的卡:改状态 + 改优先级都能点', JSON.stringify(quickMenuAccess(R())) === '{"status":"on","priority":"on"}');
  ck('参与人的卡:只能改状态', JSON.stringify(quickMenuAccess(R(PART))) === '{"status":"on","priority":"locked"}');
  ck('只读的卡:两个都灰', JSON.stringify(quickMenuAccess(R({ readOnly: true }))) === '{"status":"locked","priority":"locked"}');
}

console.log('# 请求体(真函数 + 假 fetch)');
{
  const cfg = { serverUrl: 'http://hub.test', token: 't', networkId: 'net_demo' };
  const sent: { url: string; method: string; body: any }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url: String(input), method: init?.method || 'GET', body });
    return Response.json({ requirement: { id: 'r1', name: '示例任务', assignee: '', priority: body?.priority ?? 'normal', due: '', column: body?.column ?? 'pool' } });
  }) as typeof fetch;
  try {
    const st = cellRequest(R(), { field: 'status', column: 'done' });
    ck('快捷改状态 = move 请求', st?.kind === 'move' && st.column === 'done');
    await moveRequirementOnHub(cfg as never, 'r1', 'done');
    ck('改状态 = PATCH,体正好是 {"column":"done"}', sent[0]?.method === 'PATCH' && /\/api\/requirements\/r1(\?|$)/.test(sent[0].url) && JSON.stringify(sent[0].body) === '{"column":"done"}', JSON.stringify(sent[0]));
    const back = cellRequest(R({ column: 'done' }), { field: 'status', column: 'pool' });
    await moveRequirementOnHub(cfg as never, 'r1', back?.kind === 'move' ? back.column : 'doing');
    ck('撤销 = 同样只发 {"column":<原状态>}', JSON.stringify(sent[1]?.body) === '{"column":"pool"}', JSON.stringify(sent[1]));
    const pr = cellRequest(R(), { field: 'priority', priority: 'high' });
    if (pr?.kind === 'patch') await updateRequirementOnHub(cfg as never, 'r1', pr.patch);
    ck('改优先级 = PATCH,体正好是 {"priority":"high"}', JSON.stringify(sent[2]?.body) === '{"priority":"high"}', JSON.stringify(sent[2]));
    ck('优先级没变 = 不发', cellRequest(R(), { field: 'priority', priority: 'normal' }) === null);
  } finally { globalThis.fetch = orig; }
}

console.log('# 接线');
{
  const board = src('./RequirementBoard.tsx');
  const menu = src('./TaskCardMenu.tsx');
  const row = src('./TaskSwipeRow.tsx');
  ck('只有手机(窄屏 + 触屏)挂左滑', /const swipeable = narrow && !pointer;/.test(board));
  ck('看板卡片和手机列表行都包了 swipeWrap', /return swipeWrap\(item, \(\s*<Pressable\s+key=\{item\.id\}\s+testID=\{`req-card-/.test(board) && /col\.items\.map\(\(item, i\) => swipeWrap\(item,/.test(board));
  ck('快捷改状态走 editCell(只读挡、乐观、失败退回)', /const quickStatus = [\s\S]*?editCell\(id, \{ field: 'status', column: to \}\)/.test(board));
  ck('撤销改回 from', /const undoQuick = [\s\S]*?editCell\(u\.id, \{ field: 'status', column: u\.from \}\)/.test(board));
  ck(`撤销提示 ${UNDO_MS / 1000} 秒后消失`, UNDO_MS === 5000 && /setTimeout\(\(\) => setUndo\(u => \(u === undo \? null : u\)\), UNDO_MS\)/.test(board));
  ck('改优先级走 editCell priority', /editCell\(it\.id, \{ field: 'priority'/.test(board));
  ck('菜单:手机换成改状态 / 改优先级,锁住的灰掉', /touch \? \(\['status', 'priority'\] as const\)\.map/.test(menu) && /disabled: busy \|\| target\.quick\[kind\] === 'locked'/.test(menu));
  ck('没有按钮就不挂手势', /if \(!actions\.length\) return <View style=\{style\}>\{children\}<\/View>;/.test(row));
}

console.log(`\n${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
