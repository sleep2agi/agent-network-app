// 2026-11-20 排查「侧栏预览变了、聊天面板没变」的守护：
// 侧栏第二行有两种来源 —— 最后一条消息，或 hub 的 session.task（当前在做的事）。
// 二者必须看得出区别，否则 session.task 一变就被误读成「来了新消息但面板没显示」。
import { readFileSync } from 'node:fs';
import { agentRowModel, latestMessageByAgent } from './agent-row-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

// 1) 模型层：消息优先于任务文本，且能区分来源。
const now = Date.parse('2026-11-20T07:00:00Z');
const withMsg = agentRowModel({ alias: 'A', status: 'working', task: '在做某件事' }, { latest: { at: now, text: '新消息' }, taskAt: now - 1000 });
ck('有消息时预览取消息、来源 message', withMsg.preview === '新消息' && withMsg.source === 'message', withMsg);
const taskOnly = agentRowModel({ alias: 'A', status: 'working', task: '在做某件事' }, { taskAt: now });
ck('没消息时不回传 session.task 正文（来源仍标 task）', taskOnly.preview === '' && taskOnly.source === 'task' && taskOnly.showingTask === true, taskOnly);
const taskNoTime = agentRowModel({ alias: 'A', status: 'working', task: '在做某件事' });
ck('任务没有时间时来源 null，正文同样不回传', taskNoTime.preview === '' && taskNoTime.source === null && taskNoTime.showingTask === true, taskNoTime);
ck('有消息时不算「在做」', withMsg.showingTask === false, withMsg);

// 2) 渲染层：任务来源要加「任务：」前缀（手机行 + 桌面紧凑行）。
const screen = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
ck('手机行不再画 session.task 正文', !/showingTask \?/.test(screen) && /\{model\.preview\}/.test(screen) && !/'chat\.taskPreview'/.test(screen));
ck('桌面紧凑行只画状态词', /rowStatus\(item\.status\)\.label/.test(screen) && !/text: item\.task/.test(screen));
const i18n = readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8');
ck('「任务：{text}」文案已移除', !/'chat\.taskPreview'/.test(i18n));
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('节点详情也不渲染 s.task 正文', !/selectable>\{s\.task\}</.test(detail) && /node-task-hidden/.test(detail));

// 3) 主动消息（user_inbox，agent 主动发的）必须进侧栏「最新消息」，否则面板有、侧栏没有。
const latest = latestMessageByAgent({ serverBody: { messages: [
  { message_id: 'dm_1', from_session: 'A', content: '主动消息', created_at: '2026-11-20 06:00:00' },
] } });
ck('user_inbox 主动消息进入侧栏 latest', latest.A?.text === '主动消息', latest);

console.log(`chat-preview-source: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
