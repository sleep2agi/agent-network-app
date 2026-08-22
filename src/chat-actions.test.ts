// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/chat-actions.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { buildQuote, applyQuote, msgKey, removeMessage, shouldShowJumpPill, nextUnread, jumpPillLabel, canSend, isAgentOnline, agentStatusLabel, shouldSendOnEnter } from './chat-actions';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
// round-2 长按动作
ck('quote 包「」+换行', buildQuote('你好') === '「你好」\n');
ck('quote 压多行空白为单行', buildQuote('a\n b   c') === '「a b c」\n');
ck('quote 截断 >40 +…', buildQuote('x'.repeat(50)).startsWith('「' + 'x'.repeat(40) + '…'));
ck('quote 空→""', buildQuote('') === '' && buildQuote(undefined) === '');
ck('applyQuote 引用在前保留草稿', applyQuote('原文', '引') === '「引」\n原文');
ck('applyQuote 空引用不改草稿', applyQuote('原文', '') === '原文');
ck('msgKey 优先 _localId', msgKey({ _localId: 'L', task_id: 'T' }) === 'L');
ck('msgKey 退回 task_id', msgKey({ task_id: 'T' }) === 'T');
ck('removeMessage 按key删中间', JSON.stringify(removeMessage([{ _localId: 'a' }, { task_id: 'b' }, { _localId: 'c' }], { task_id: 'b' })) === JSON.stringify([{ _localId: 'a' }, { _localId: 'c' }]));
ck('removeMessage 不误伤其它', removeMessage([{ _localId: 'a' }, { task_id: 'b' }], { _localId: 'a' }).length === 1);
// round-3 回到最新 pill
ck('底部(0)不显 pill', shouldShowJumpPill(0) === false);
ck('滚离底部>200 显 pill', shouldShowJumpPill(300) === true);
ck('阈值(200)不显', shouldShowJumpPill(200) === false);
ck('到底清零未读', nextUnread(5, true, 2) === 0);
ck('未到底累加未读', nextUnread(3, false, 2) === 5);
ck('pill 有未读显条数', jumpPillLabel(3) === '3 条新消息');
ck('pill 无未读显回到最新', jumpPillLabel(0) === '回到最新');
// round-4 发送键可用态
ck('空+无附件不可发', canSend('', false, false) === false);
ck('纯空白不可发', canSend('   ', false, false) === false);
ck('有文字可发', canSend('你好', false, false) === true);
ck('仅附件可发', canSend('', true, false) === true);
ck('发送中不可发', canSend('你好', false, true) === false);
// round-5 头像在线态
ck('working 在线', isAgentOnline('working') === true);
ck('idle 在线', isAgentOnline('idle') === true);
ck('offline 离线', isAgentOnline('offline') === false);
ck('空 离线不崩', isAgentOnline('') === false && isAgentOnline(undefined) === false);
ck('列表和聊天头共用状态文案', agentStatusLabel('idle') === '在线' && agentStatusLabel('working') === '工作中' && agentStatusLabel('offline') === '离线');
// round-6 桌面发送快捷键
ck('Enter 换行', shouldSendOnEnter({ key: 'Enter' }) === false);
ck('Ctrl+Enter 发送', shouldSendOnEnter({ key: 'Enter', ctrlKey: true }) === true);
ck('Cmd+Enter 发送', shouldSendOnEnter({ key: 'Enter', metaKey: true }) === true);
ck('输入法组词确认不发送', shouldSendOnEnter({ key: 'Enter', ctrlKey: true, isComposing: true }) === false);
ck('其它按键不发送', shouldSendOnEnter({ key: 'a' }) === false);
const chatSource = fs.readFileSync(path.join(process.cwd(), 'src/ChatScreen.tsx'), 'utf8');
ck('桌面输入区使用独立微信式 composer', chatSource.includes('styles.desktopComposer'));
ck('桌面输入区显示快捷键提示', chatSource.includes('Ctrl/⌘+Enter 发送 · Enter 换行'));
console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
