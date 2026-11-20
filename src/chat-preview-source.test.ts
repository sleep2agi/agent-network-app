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
ck('没消息时退回任务文本、来源 task', taskOnly.preview === '在做某件事' && taskOnly.source === 'task', taskOnly);
const taskNoTime = agentRowModel({ alias: 'A', status: 'working', task: '在做某件事' });
ck('任务文本但没有时间时来源 null（仍显示文本）', taskNoTime.preview === '在做某件事' && taskNoTime.source === null, taskNoTime);

// 2) 渲染层：任务来源要加「在做：」前缀（手机行 + 桌面紧凑行）。
const screen = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
ck('手机行按来源区分渲染', /model\.source === 'task' \? t\('chat\.statusDoing'/.test(screen));
ck('桌面紧凑行同样加前缀', /t\('chat\.statusDoing', \{ text: item\.task \}\)/.test(screen));
const i18n = readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8');
ck('文案存在', /'chat\.statusDoing': \['在做：\{text\}'/.test(i18n));

// 3) 主动消息（user_inbox，agent 主动发的）必须进侧栏「最新消息」，否则面板有、侧栏没有。
const latest = latestMessageByAgent({ serverBody: { messages: [
  { message_id: 'dm_1', from_session: 'A', content: '主动消息', created_at: '2026-11-20 06:00:00' },
] } });
ck('user_inbox 主动消息进入侧栏 latest', latest.A?.text === '主动消息', latest);

console.log(`chat-preview-source: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
