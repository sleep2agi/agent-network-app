// 聊天超长消息折叠 + FlatList 虚拟化 + 5s 轮询列表去重单测 — run: bun src/markdown-message-fold.test.ts
import fs from 'node:fs';
import path from 'node:path';
import {
  CHAT_LIST_PERF,
  LONG_MESSAGE_CHARS,
  foldLongMessage,
  longMessageFoldLabel,
  sameChatMessages,
} from './markdown-message-fold';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

// ── foldLongMessage ──
const short = foldLongMessage('普通短回复', false);
ck('短消息不折叠', short.shown === '普通短回复' && !short.truncated && short.hiddenChars === 0 && longMessageFoldLabel(short, false) === null);

const exact = 'a'.repeat(LONG_MESSAGE_CHARS);
ck(`恰好 ${LONG_MESSAGE_CHARS} 字不折叠`, !foldLongMessage(exact, false).truncated && longMessageFoldLabel(foldLongMessage(exact, false), false) === null);

const huge = Array.from({ length: 1200 }, (_, i) => `第 ${i + 1} 行：回归核验结果 PASS —— 完整字段校验通过`).join('\n');
const folded = foldLongMessage(huge, false);
ck('超长消息默认折叠并截在换行边界',
  folded.truncated && folded.shown.length <= LONG_MESSAGE_CHARS && folded.hiddenChars > 0 && !folded.shown.endsWith('第'),
  { shownLen: folded.shown.length, hidden: folded.hiddenChars });
ck('折叠文案提示展开全文与剩余字数', /^展开全文（还有 .+）$/.test(longMessageFoldLabel(folded, false) ?? ''), longMessageFoldLabel(folded, false));

const expanded = foldLongMessage(huge, true);
ck('展开后返回全文且文案切换为收起', expanded.shown === huge && !expanded.truncated && (longMessageFoldLabel(expanded, true) ?? '').startsWith('收起长消息'));

const openFenceText = `${'x'.repeat(3500)}\n\`\`\`ts\n${'const a = 1;\n'.repeat(100)}\`\`\``;
const foldedFence = foldLongMessage(openFenceText, false);
ck('截断落在未闭合 ``` 代码块内时自动补闭合行', foldedFence.truncated && foldedFence.shown.endsWith('\n```'), foldedFence.shown.slice(-40));

const openTildeText = `${'y'.repeat(3500)}\n~~~bash\n${'echo hi\n'.repeat(100)}~~~`;
const foldedTilde = foldLongMessage(openTildeText, false);
ck('截断落在未闭合 ~~~ 代码块内时自动补闭合行', foldedTilde.truncated && foldedTilde.shown.endsWith('\n~~~'), foldedTilde.shown.slice(-40));

ck('空字符串安全', foldLongMessage('', false).shown === '' && !foldLongMessage('', false).truncated);

// ── CHAT_LIST_PERF ──
ck('FlatList 虚拟化窗口小于默认 21 且首屏批合理', CHAT_LIST_PERF.windowSize <= 9 && CHAT_LIST_PERF.initialNumToRender <= 10 && CHAT_LIST_PERF.maxToRenderPerBatch <= 8);

// ── sameChatMessages ──
const row1 = { task_id: 't1', content: 'hi', result: 'ok', status: 'replied', created_at: '2026-11-22 15:00:00', completed_at: '2026-11-22 15:01:00' };
const row2 = { task_id: 't2', content: 'next', result: null, status: 'delivered', created_at: '2026-11-22 15:05:00' };
ck('同内容新对象数组判相等（避免 5s 轮询空重绘）', sameChatMessages([row1, row2], [{ ...row1 }, { ...row2 }]));
ck('新增消息判不等', !sameChatMessages([row1], [row1, row2]));
ck('回复内容到达判不等', !sameChatMessages([row1, row2], [row1, { ...row2, result: 'done', status: 'replied' }]));
ck('本地状态变化(_pending -> _failed)判不等', !sameChatMessages([{ _localId: 'l1', content: 'a', _pending: true }], [{ _localId: 'l1', content: 'a', _failed: true }]));

// ── wiring ──
const md = fs.readFileSync(path.join(process.cwd(), 'src/MarkdownMessage.tsx'), 'utf8');
const chat = fs.readFileSync(path.join(process.cwd(), 'src/ChatScreen.tsx'), 'utf8');
ck('MarkdownMessage 已包 React.memo 且缓存 parseMarkdownBlocks', md.includes('export default memo(MarkdownMessage);') && md.includes('useMemo(() => parseMarkdownBlocks('));
ck('MarkdownMessage 支持 foldLong 并提供展开按钮', md.includes('foldLongMessage(children, longExpanded)') && md.includes('testID="markdown-long-fold-toggle"'));
ck('ChatScreen 接入 CHAT_LIST_PERF、sameChatMessages 与 foldLong', chat.includes('{...CHAT_LIST_PERF}') && chat.includes('sameChatMessages(prev, merged) ? prev : merged') && chat.includes('<MarkdownMessage foldLong>'));

console.log(`markdown-message-fold: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
