import { readFileSync } from 'node:fs';
import { proactiveBody, proactiveItemsForAgent } from './proactive-messages';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

const rows = [
  { message_id: 'dm_1', from_session: '通信龙', kind: 'agent_message', title: '构建失败', content: 'CI 红了', severity: 'warning', created_at: '2026-09-07 06:00:00', acked: 0 },
  { message_id: 'dm_2', from_session: '通信龙', title: null, content: '只有正文', created_at: '2026-09-07 06:01:00', acked: 1 },
  { message_id: 'dm_3', from_session: '别的牛', content: '别人的消息', created_at: '2026-09-07 06:02:00' },
  { message_id: 'dm_4', from_session: '通信龙', title: '只有标题', content: '', created_at: '2026-09-07 06:03:00' },
  { message_id: 'dm_5', from_session: '通信龙', title: '', content: '   ', created_at: '2026-09-07 06:04:00' },
  { from_session: '通信龙', content: '没有 message_id' },
];
const items = proactiveItemsForAgent(rows as any, '通信龙', 'admin');
check('只取该 alias 的、有 id 且有正文的行', items.map(i => i.task_id).join(',') === 'dm_1,dm_2,dm_4');
check('标题+正文合成 Markdown', items[0].result === '**构建失败**\n\nCI 红了');
check('只有正文 / 只有标题 → 原样', items[1].result === '只有正文' && items[2].result === '只有标题');
check('映射成只有 result 的 ChatItem,带 _proactive', items[0].content === '' && items[0]._proactive === true && items[0].from_name === '通信龙' && items[0].to_name === 'admin' && items[0]._severity === 'warning');
check('空输入 / 空 alias → 空', proactiveItemsForAgent(undefined, 'x').length === 0 && proactiveItemsForAgent(rows as any, '').length === 0);
check('proactiveBody 去首尾空白', proactiveBody({ title: ' t ', content: ' b ' }) === '**t**\n\nb');
// 接线契约(ChatScreen import react-native,bun 里按源码查)
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const load = chat.slice(chat.indexOf('const load = useCallback('), chat.indexOf('// Reset the lazy window when the chat target changes'));
check('ChatScreen.load 与任务同一次轮询里取 scope=user 消息并映射为主动项', load.includes('fetchUserMessages(cfg') && load.includes('proactiveItemsForAgent('));
check('主动项与任务行一起进 mergeMessagesNewestFirst(按 created_at 排)', load.includes('[...fetched, ...proactive]'));
const render = chat.slice(chat.indexOf('renderItem={({ item, index }) => {'));
check('渲染:主动项不画发送气泡', /\{!item\._proactive \? \(/.test(render));
check('渲染:主动项回复气泡带「主动汇报」标', render.includes('主动汇报'));
console.log(`proactive messages: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
