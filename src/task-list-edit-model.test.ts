// 列表就地编辑(task-list-edit-model.ts):哪些格能改、每次编辑发什么请求体、乐观更新 / 退回、键盘走格。
import { readFileSync } from 'node:fs';
import { applyCellEdit, cellEditable, cellKey, cellRequest, EDITABLE_CELLS, pickOwner, rollbackCellEdit, tagAddable, toggleParticipant, toggleTag } from './task-list-edit-model';
import { FIELD_IDS, defaultFields } from './task-list-fields';
import type { Requirement } from './requirements-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const json = (v: unknown) => JSON.stringify(v);

const me = { kind: 'user' as const, id: 'u_me' }, ua = { kind: 'user' as const, id: 'u_a' }, na = { kind: 'node' as const, id: 'node-a' };
const R = (o: Partial<Requirement> = {}): Requirement => ({ id: 'r1', name: '示例任务', priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-01T00:00:00Z', owner: ua, agentOwner: null, participants: [me], projectId: null, tags: ['前端'], ...o } as Requirement);
const ctx = { projects: true };

// ── 权限 ──
const all = (item: Requirement) => FIELD_IDS.filter(f => cellEditable(item, f, ctx));
ck('full-edit card: exactly the editable columns', json(all(R())) === json(FIELD_IDS.filter(f => EDITABLE_CELLS.includes(f))));
ck('ID / 时间 / Issue never editable', ['seq', 'created', 'updated', 'issues'].every(f => !cellEditable(R(), f as never, ctx)));
const participant = R({ readOnly: true, editFields: ['column', 'checklist'] });
ck('participant (edit_fields column): only 状态', json(all(participant)) === json(['status']));
ck('read-only card without edit_fields: nothing', all(R({ readOnly: true })).length === 0);
ck('archived: nothing', all(R({ archived: true })).length === 0);
ck('old Hub without owner/participants/tags/project: those cells locked', json(all(R({ owner: undefined, participants: undefined, tags: undefined, projectId: undefined }))) === json(['title', 'priority', 'due', 'status']));
ck('no projects capability: project locked', !cellEditable(R(), 'project', { projects: false }));

// ── 请求体:只带改的那一个字段 ──
const body = (e: Parameters<typeof cellRequest>[1], item = R()) => json(cellRequest(item, e));
ck('title → {name} trimmed', body({ field: 'title', name: '  新标题 ' }) === json({ kind: 'patch', patch: { name: '新标题' } }));
ck('title unchanged / blank → nothing sent', cellRequest(R(), { field: 'title', name: '示例任务' }) === null && cellRequest(R(), { field: 'title', name: '   ' }) === null);
ck('owner → {owner}', body({ field: 'owner', owner: me }) === json({ kind: 'patch', patch: { owner: me } }));
ck('owner cleared → {owner:null}', body({ field: 'owner', owner: null }) === json({ kind: 'patch', patch: { owner: null } }));
ck('agent → {agent_owner}', body({ field: 'agent', agentOwner: na }) === json({ kind: 'patch', patch: { agent_owner: na } }));
ck('priority → {priority}', body({ field: 'priority', priority: 'high' }) === json({ kind: 'patch', patch: { priority: 'high' } }));
ck('due → {due}; clear → {due:""}', body({ field: 'due', due: '2026-10-02' }) === json({ kind: 'patch', patch: { due: '2026-10-02' } }) && body({ field: 'due', due: '' }, R({ due: '2026-10-02' })) === json({ kind: 'patch', patch: { due: '' } }));
ck('status → move (PATCH {column})', body({ field: 'status', column: 'doing' }) === json({ kind: 'move', column: 'doing' }));
ck('project → {project_id}', body({ field: 'project', projectId: 'p1' }) === json({ kind: 'patch', patch: { project_id: 'p1' } }));
ck('tags → {tags}', body({ field: 'tags', tags: ['前端', '新标签'] }) === json({ kind: 'patch', patch: { tags: ['前端', '新标签'] } }));
ck('tags over the limit → nothing sent', cellRequest(R(), { field: 'tags', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }) === null);
ck('participants → assign full list', body({ field: 'participants', participants: [me, ua] }) === json({ kind: 'assign', participants: [me, ua] }));
ck('same value → nothing sent', [
  cellRequest(R(), { field: 'owner', owner: ua }), cellRequest(R(), { field: 'priority', priority: 'normal' }), cellRequest(R(), { field: 'status', column: 'pool' }),
  cellRequest(R(), { field: 'project', projectId: null }), cellRequest(R(), { field: 'tags', tags: ['前端'] }), cellRequest(R(), { field: 'participants', participants: [me] }),
].every(x => x === null));

// ── 切换 ──
ck('participants toggle off / on', json(toggleParticipant(R(), me)) === json({ field: 'participants', participants: [] }) && json(toggleParticipant(R(), ua)) === json({ field: 'participants', participants: [me, ua] }));
ck('two roles: human → owner, node → agent', pickOwner(R(), me, true).field === 'owner' && pickOwner(R(), na, true).field === 'agent');
ck('picking the current owner clears it', json(pickOwner(R(), ua, true)) === json({ field: 'owner', owner: null }));
ck('old Hub: a node is the single owner', json(pickOwner(R(), na, false)) === json({ field: 'owner', owner: na }));
ck('tag toggle off / on', json(toggleTag(R(), '前端')) === json({ field: 'tags', tags: [] }) && json(toggleTag(R(), '后端')) === json({ field: 'tags', tags: ['前端', '后端'] }));
ck('tagAddable: too long / 11th / blank are not', !tagAddable(R(), 'x'.repeat(21)) && !tagAddable(R({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) }), 'new') && !tagAddable(R(), '  ') && tagAddable(R(), '新'));

// ── 乐观更新 / 退回只动那一个字段 ──
const before = R();
const after = applyCellEdit(before, { field: 'priority', priority: 'high' });
ck('apply changes only that field', after.priority === 'high' && after.name === before.name && after.owner === before.owner);
const concurrent = { ...after, name: '别处改过的标题' };
const back = rollbackCellEdit(concurrent, before, { field: 'priority', priority: 'high' });
ck('rollback restores only that field', back.priority === 'normal' && back.name === '别处改过的标题');
ck('rollback status / project / tags / participants / agent', (() => {
  const b = R({ column: 'doing', projectId: 'p1', tags: ['a'], participants: [ua], agentOwner: na });
  const cur = R({ column: 'done', projectId: null, tags: [], participants: [], agentOwner: null });
  return rollbackCellEdit(cur, b, { field: 'status', column: 'done' }).column === 'doing'
    && rollbackCellEdit(cur, b, { field: 'project', projectId: null }).projectId === 'p1'
    && json(rollbackCellEdit(cur, b, { field: 'tags', tags: [] }).tags) === json(['a'])
    && json(rollbackCellEdit(cur, b, { field: 'participants', participants: [] }).participants) === json([ua])
    && rollbackCellEdit(cur, b, { field: 'agent', agentOwner: null }).agentOwner === na;
})());

// ── 键盘 ──
const rows = ['r1', 'r2', 'r3'], fields = ['seq', 'title', 'owner', 'status'] as const;
const go = (row: string, field: typeof fields[number], key: string, shift = false) => json(cellKey({ row, field }, key, shift, rows, fields));
ck('↓ next row', go('r1', 'title', 'ArrowDown') === json({ move: { row: 'r2', field: 'title' } }));
ck('↑ at top stays', go('r1', 'title', 'ArrowUp') === json({ move: { row: 'r1', field: 'title' } }));
ck('→ next column, ← previous', go('r2', 'title', 'ArrowRight') === json({ move: { row: 'r2', field: 'owner' } }) && go('r2', 'title', 'ArrowLeft') === json({ move: { row: 'r2', field: 'seq' } }));
ck('→ at the right edge stays', go('r3', 'status', 'ArrowRight') === json({ move: { row: 'r3', field: 'status' } }));
ck('Tab / Shift+Tab', go('r1', 'owner', 'Tab') === json({ move: { row: 'r1', field: 'status' } }) && go('r1', 'owner', 'Tab', true) === json({ move: { row: 'r1', field: 'title' } }));
ck('Enter / F2 open, Esc clears', go('r1', 'owner', 'Enter') === json({ open: true }) && go('r1', 'owner', 'F2') === json({ open: true }) && go('r1', 'owner', 'Escape') === json({ clear: true }));
ck('other keys are left alone', cellKey({ row: 'r1', field: 'title' }, 'a', false, rows, fields) === null);
ck('stale position is left alone', cellKey({ row: 'gone', field: 'title' }, 'ArrowDown', false, rows, fields) === null);

// ── 接线(源码):只在鼠标宽屏表格上;写之前过只读闸;手机行照旧进详情 ──
const table = src('TaskListTable.tsx'), board = src('RequirementBoard.tsx');
ck('table: editing only when not touch', /const live = !!edit && !touch;/.test(table));
ck('table: read-only cells are plain Views (no Pressable, no hover frame)', /if \(!canEdit\(item, f\.id\)\) return <View key=\{f\.id\}/.test(table) && /\{live \? frame\(false\) : null\}/.test(table));
ck('table: modifier clicks still multi-select rows', /if \(n\.ctrlKey \|\| n\.metaKey \|\| n\.shiftKey\) \{ if \(selection\) selection\.onPress\(item\.id, e\)/.test(table));
ck('table: Shift+arrows left to the board (status move)', /\(e\.shiftKey && e\.key !== 'Tab'\)/.test(table));
ck('board: editCell gates on readOnlyBlock with column for status', /const editCell = async[\s\S]*?readOnlyBlock\(id, edit\.field === 'status' \? 'column' : undefined\)[\s\S]*?updateTaskItems\(scope, rows => rows\.map\(row => \(row\.id === id \? applyCellEdit/.test(board));
ck('board: failure rolls back only that field', /rollbackCellEdit\(row, before, edit\)/.test(board));
ck('board: phone rows still open the detail', /testID=\{`req-row-\$\{item\.id\}`\}[\s\S]{0,200}onPress=\{\(\) => openDetail\(item\.id\)\}/.test(board));
ck('tags column exists, hidden by default, not sortable', FIELD_IDS.includes('tags') && defaultFields().find(f => f.id === 'tags')?.visible === false && /id !== 'tags';/.test(table));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
