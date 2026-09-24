import { parseRouteHeader, priorityPill, relativeTime, splitStale, STALE_AFTER_MS, stripInlineMarkdown, stripRouteHeader, taskPreview } from './node-task-view';
import { latestActivity, type NodeTaskRow } from './node-tasks';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

// 1. markdown 语法不进预览
check('加粗去星号', stripInlineMarkdown('**一个问件**:看这里') === '一个问件:看这里');
check('行内代码去反引号', stripInlineMarkdown('回你 `ba1d2931` 被拒') === '回你 ba1d2931 被拒');
check('链接只留文字', stripInlineMarkdown('补上 [升级命令](https://example.invalid/docs) 一节') === '补上 升级命令 一节');
check('标题/列表/引用前缀去掉', stripInlineMarkdown('## 背景\n- 读数 1\n> 引用') === '背景\n读数 1\n引用');
check('装饰星标去掉,⚠️ 保留', stripInlineMarkdown('⭐ 结论 ⚠️ 注意') === ' 结论 ⚠️ 注意');
check('未闭合的 ** 也不露出', !stripInlineMarkdown('一半**加粗').includes('*'));
check('snake_case 不被当斜体吃掉', stripInlineMarkdown('no_live_subscriber') === 'no_live_subscriber');

// 2. 抬头与「来自 X」重复时去掉
const h = parseRouteHeader('【节点A → demo-node】正文');
check('解析 【A → B】', !!h && h.from === '节点A' && h.to === 'demo-node' && h.extra === '' && h.rest === '正文');
const hx = parseRouteHeader('【节点B → demo-node｜admin 指派:评估约定】UTC 12:02Z');
check('解析 【A → B｜补充】', !!hx && hx.from === '节点B' && hx.extra === 'admin 指派:评估约定' && hx.rest === 'UTC 12:02Z');
check('没有抬头 → null', parseRouteHeader('普通一句话') === null && parseRouteHeader('【只是括号】正文') === null);
check('发件人一致 → 去掉抬头', stripRouteHeader('【节点A → demo-node】正文', '节点A') === '正文');
check('有补充 → 只留补充', stripRouteHeader('【节点B → demo-node｜admin 指派:评估】UTC', '节点B') === 'admin 指派:评估 UTC');
check('发件人不一致(转发)→ 保留整段', stripRouteHeader('【节点C → demo-node】正文', '节点A') === '【节点C → demo-node】正文');
check('-> 也认', stripRouteHeader('【节点A -> demo-node】正文', '节点A') === '正文');

// 预览:去抬头 + 去 markdown + 合并空白 + 截断
check('预览合成', taskPreview('【节点A → demo-node】**一个问件**:\n\n`send_desktop_message` 连续 7 条', '节点A') === '一个问件: send_desktop_message 连续 7 条');
check('预览截断带省略号', taskPreview('字'.repeat(300), 'x').length === 160 && taskPreview('字'.repeat(300), 'x').endsWith('…'));
check('空内容占位', taskPreview('', 'x') === '(空任务)' && taskPreview('【节点A → demo-node】', '节点A') === '(空任务)');

// 3. 相对时间
const now = new Date('2026-09-25T06:00:00Z');
check('刚刚', relativeTime('2026-09-25 05:59:40', now) === '刚刚');
check('分钟前', relativeTime('2026-09-25 05:48:00', now) === '12 分钟前');
check('小时前', relativeTime('2026-09-25 03:00:00', now) === '3 小时前');
check('天前', relativeTime('2026-09-20 05:00:00', now) === '5 天前');
check('未来/空 → 空串', relativeTime('2026-09-26 00:00:00', now) === '' && relativeTime(undefined, now) === '');

// 4. 「可能卡住」:最后一次动静超过 24 小时
const row = (id: string, last?: string, since?: string): NodeTaskRow => ({ taskId: id, status: 'acked', from: 'x', summary: '', content: '', lastActivity: last, since });
const sp = splitStale([
  row('fresh', '2026-09-25 04:00:00'),
  row('old', '2026-09-20 04:00:00'),
  row('edge-in', '2026-09-24 06:00:01'),
  row('edge-out', '2026-09-24 05:59:59'),
  row('since-only-old', undefined, '2026-09-19 00:00:00'),
  row('no-time'),
], now);
check('24h 内 → 进行中', sp.active.map(r => r.taskId).join(',') === 'fresh,edge-in,no-time');
check('超过 24h → 可能卡住(含只有 since 的)', sp.stale.map(r => r.taskId).join(',') === 'old,edge-out,since-only-old');
check('阈值是 24 小时', STALE_AFTER_MS === 86_400_000);
check('latestActivity 取最晚一格', latestActivity({ created_at: '2026-09-20 00:00:00', delivered_at: '2026-09-20 00:00:05', consumed_at: '2026-09-24 10:00:00' }) === '2026-09-24 10:00:00');
check('latestActivity 全空 → undefined', latestActivity({}) === undefined);

// 5. 优先级标签只给非常态
check('normal/空 无标签', priorityPill('normal') === null && priorityPill(undefined) === null);
check('urgent/high/low 有标签', priorityPill('urgent')?.tone === 'danger' && priorityPill('HIGH')?.label === '高优先' && priorityPill('low')?.tone === 'muted');

console.log(`node task view: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
