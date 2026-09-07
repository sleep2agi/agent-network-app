import { elapsedLabel, partitionNodeTasks, summarizeTask } from './node-tasks';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

const tasks = [
  { task_id: 'q2', status: 'pending', content: '第二条排队', created_at: '2026-09-07 06:02:00' },
  { task_id: 'r1', status: 'delivered', content: '先送达的\n第二行不算摘要', from_name: 'admin', created_at: '2026-09-07 05:00:00', delivered_at: '2026-09-07 05:01:00' },
  { task_id: 'done', status: 'replied', content: '已回复的不显示', created_at: '2026-09-07 04:00:00' },
  { task_id: 'q1', status: 'created', content: '第一条排队', created_at: '2026-09-07 06:01:00' },
  { task_id: 'r0', status: 'in_progress', content: '更早开始的', created_at: '2026-09-07 04:30:00', started_at: '2026-09-07 04:31:00' },
  { task_id: 'x', status: 'failed', content: '失败的不显示' },
  { status: 'pending', content: '没有 task_id 的行丢弃' },
  { task_id: 'up', status: 'RUNNING', content: '大写状态也认' },
];
const p = partitionNodeTasks(tasks as any);
check('running = delivered/in_progress/running(不含终态), 按开始时间升序', p.running.map(r => r.taskId).join(',') === 'r0,r1,up');
check('queue = created/pending 按创建时间升序 = 执行顺序', p.queue.map(r => r.taskId).join(',') === 'q1,q2');
check('摘要取第一行', p.running[1].summary === '先送达的' && p.running[1].from === 'admin');
check('running.since 优先 started_at, 其次 delivered_at', p.running[0].since === '2026-09-07 04:31:00' && p.running[1].since === '2026-09-07 05:01:00');
check('queue.since = created_at', p.queue[0].since === '2026-09-07 06:01:00');
check('空/undefined 输入 → 两组都空', partitionNodeTasks(undefined).running.length === 0 && partitionNodeTasks([]).queue.length === 0);
check('摘要截断到 140 字带省略号', summarizeTask('a'.repeat(200)).length === 140 && summarizeTask('a'.repeat(200)).endsWith('…'));
check('空内容摘要为占位', summarizeTask('') === '(空任务)' && summarizeTask('\n\n  ') === '(空任务)');
const now = new Date('2026-09-07T06:10:00Z');
check('elapsedLabel 分钟', elapsedLabel('2026-09-07 06:07:00', now) === '3 分钟');
check('elapsedLabel 小时+分钟', elapsedLabel('2026-09-07 04:58:00', now) === '1 小时 12 分钟');
check('elapsedLabel 刚刚/未来/空', elapsedLabel('2026-09-07 06:09:40', now) === '刚刚' && elapsedLabel('2026-09-07 07:00:00', now) === '' && elapsedLabel(undefined, now) === '');
check('elapsedLabel 天', elapsedLabel('2026-09-05 05:10:00', now) === '2 天 1 小时');
// 接线契约:节点详情页挂了任务区,按 alias 取 to_name 的任务。
import { readFileSync } from 'node:fs';
const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
check('NodeDetailScreen 渲染 NodeTasksSection(cfg, alias)', /<NodeTasksSection cfg=\{cfg\} alias=\{alias\}/.test(screen));
const section = readFileSync(new URL('./NodeTasksSection.tsx', import.meta.url), 'utf8');
check('NodeTasksSection 按 to_name=alias 拉任务并分组', section.includes('fetchTasks(cfg, { to_name: alias') && section.includes('partitionNodeTasks('));
console.log(`node tasks: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
