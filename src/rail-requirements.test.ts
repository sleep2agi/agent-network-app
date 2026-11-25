import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requirementsForAgent } from './rail-requirements';

const base = { due: '', assignee: '', priority: 'P2', column: 'pool' } as const;
const rows: any[] = [
  { ...base, id: '1', name: 'agent owner by node id', column: 'doing', agentOwner: { kind: 'node', id: 'n_a' } },
  { ...base, id: '2', name: 'participant by alias', participants: [{ kind: 'node', id: 'A' }] },
  { ...base, id: '3', name: 'old hub assignee', assignee: 'A', column: 'done' },
  { ...base, id: '4', name: 'someone else', agentOwner: { kind: 'node', id: 'n_b' } },
  { ...base, id: '5', name: 'archived', agentOwner: { kind: 'node', id: 'n_a' }, archived: true },
  { ...base, id: '6', name: 'abandoned', agentOwner: { kind: 'node', id: 'n_a' }, column: 'abandoned' },
];
const r = requirementsForAgent(rows, { alias: 'A', nodeId: 'n_a' });
assert.deepEqual(r.doing.map(x => x.id), ['1']);
assert.deepEqual(r.pool.map(x => x.id), ['2']);
assert.deepEqual(r.done.map(x => x.id), ['3']);
// 没有 node_id 时只按 alias
assert.deepEqual(requirementsForAgent(rows, { alias: 'A', nodeId: null }).doing.map(x => x.id), []);

// admin 2026-11-25 截图：右侧「任务 → 项管」卡片重做（独立卡片 + 优先级/截止/短号/标签胶囊），点进去弹任务详情窗（回退 onOpenTask）。
const panel = readFileSync(new URL('./RailTasksPanel.tsx', import.meta.url), 'utf8');
assert.match(panel, /openTaskWindow\(/, 'clicking a rail requirement opens the task detail window');
assert.match(panel, /if \(!opened\) onOpenTask\?\.\(req\.id, cfg\.networkId \?\? null\)/, 'falls back to onOpenTask when popout window unavailable');
assert.match(panel, /shortIdLabel\(req\)/, 'renders short task seq #N');
assert.match(panel, /PRIORITY_CODE\[req\.priority\]/, 'renders priority badge');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.match(chat, /<ChatToolRail[^>]*onOpenTask=\{onOpenTask\}/, 'ChatScreen forwards onOpenTask to ChatToolRail');
console.log('rail-requirements: ok');
