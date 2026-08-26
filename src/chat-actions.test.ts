// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/chat-actions.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { buildQuote, applyQuote, confirmedOutboxIds, mergeMessagesNewestFirst, msgKey, removeMessage, shouldShowJumpPill, nextUnread, jumpPillLabel, canSend, isAgentOnline, agentStatusLabel, shouldSendOnEnter } from './chat-actions';
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
ck('Enter 发送', shouldSendOnEnter({ key: 'Enter' }) === true);
ck('Shift+Enter 换行', shouldSendOnEnter({ key: 'Enter', shiftKey: true }) === false);
ck('Ctrl+Enter 换行', shouldSendOnEnter({ key: 'Enter', ctrlKey: true }) === false);
ck('Cmd+Enter 换行', shouldSendOnEnter({ key: 'Enter', metaKey: true }) === false);
ck('输入法组词确认不发送', shouldSendOnEnter({ key: 'Enter', isComposing: true }) === false);
ck('旧 WebView 输入法 keyCode=229 不发送', shouldSendOnEnter({ key: 'Enter', keyCode: 229 }) === false);
ck('旧 WebView 输入法 which=229 不发送', shouldSendOnEnter({ key: 'Enter', which: 229 }) === false);
ck('输入法 Process 键不发送', shouldSendOnEnter({ key: 'Process' }) === false);
ck('其它按键不发送', shouldSendOnEnter({ key: 'a' }) === false);
const base = Date.parse('2026-08-23T08:00:00.000Z');
ck('Hub 出现同内容近时消息后确认并清除未送达副本', confirmedOutboxIds(
  [{ id: 'retry-1', content: 'hello', createdAt: base }],
  [{ content: 'hello', created_at: '2026-08-23 08:00:20' }],
).join() === 'retry-1');
ck('Hub 五分钟去重窗口内的送达记录会清除错误未送达标记', confirmedOutboxIds(
  [{ id: 'retry-five-min', content: 'hello', createdAt: base }],
  [{ content: 'hello', created_at: '2026-08-23 08:05:00' }],
).join() === 'retry-five-min');
ck('同内容旧历史不会误确认本次重试', confirmedOutboxIds(
  [{ id: 'retry-2', content: 'hello', createdAt: base }],
  [{ content: 'hello', created_at: '2026-08-23 07:00:00' }],
).length === 0);
ck('本地失败消息与 Hub 消息统一按时间倒序', mergeMessagesNewestFirst(
  [{ _localId: 'old-failed', content: 'old', created_at: '2026-08-23T07:00:00.000Z' }],
  [{ content: 'new', created_at: '2026-08-23 08:00:00' }],
)[0].content === 'new');
// ── #178 P0:主窗口重复恢复历史 outbox ──────────────────────────────────────
// 复现路径(ChatScreen.tsx):切换 alias 的 effect 把 outboxForAlias() 的全部条目
// 当作 `restored` 并进【缓存快照】,而那份快照本身是上一次轮询用
// `conversations.put(token.key, merged)` 写回去的 —— merged 里已经含同一批
// _localId 项。于是每次 A→B→A 回来就再叠一层,用户看到同一条"未送达"4 遍。
// 独立聊天窗口只开一次(冷缓存)所以不复现,与用户报告一致。
const restoredOnce = [{ _localId: 'L1', content: '还有多久新的能出来', created_at: '2026-08-25T23:00:00.000Z', _failed: true }];
const cachedAfterFirstMount = [
  { _localId: 'L1', content: '还有多久新的能出来', created_at: '2026-08-25T23:00:00.000Z', _failed: true },
  { task_id: 'T9', content: 'hub 的历史消息', created_at: '2026-08-25T22:00:00.000Z' },
];
const remerged = mergeMessagesNewestFirst(restoredOnce, cachedAfterFirstMount);
ck('#178 同一 _localId 重挂载后只出现一次', remerged.filter(m => m._localId === 'L1').length === 1);
// 三次重挂载 = 用户截图里的那种堆叠
let acc = mergeMessagesNewestFirst(restoredOnce, cachedAfterFirstMount);
for (let i = 0; i < 2; i++) acc = mergeMessagesNewestFirst(restoredOnce, acc);
ck('#178 连续三次重挂载仍只有一条', acc.filter(m => m._localId === 'L1').length === 1);
// 🔴 去重不能吞掉别的消息:Hub 行没有 _localId,一条都不许少
ck('#178 去重不误删 Hub 消息', acc.filter(m => m.task_id === 'T9').length === 1);
// 🔴 保留的必须是【本地那份】—— 它带着最新的 _failed/_pending 状态,
//    缓存里那份可能是上一轮的旧状态。
const staleCached = [{ _localId: 'L2', content: 'x', created_at: '2026-08-25T23:00:00.000Z', _failed: true }];
const freshLocal = [{ _localId: 'L2', content: 'x', created_at: '2026-08-25T23:00:00.000Z', _pending: true }];
ck('#178 冲突时保留本地(更新)的那份状态',
  mergeMessagesNewestFirst(freshLocal, staleCached).find(m => m._localId === 'L2')?._pending === true);
// 无 _localId 的本地项本来就会被丢弃,这条行为不许因为去重而改变
ck('#178 无 _localId 的本地项仍被丢弃',
  mergeMessagesNewestFirst([{ content: 'no-id', created_at: '2026-08-25T23:00:00.000Z' }], []).length === 0);

const chatSource = fs.readFileSync(path.join(process.cwd(), 'src/ChatScreen.tsx'), 'utf8');
ck('桌面输入区使用独立微信式 composer', chatSource.includes('styles.desktopComposer'));
ck('桌面输入区显示快捷键提示', chatSource.includes('Enter 发送 · Shift/Ctrl/⌘+Enter 换行'));
console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
