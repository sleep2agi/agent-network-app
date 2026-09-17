import * as fs from 'fs';
import * as path from 'path';
import { quoteLabel } from './chat-actions';
import { replyQuoteFor } from './reply-quote';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };

// ---- 2026-09-17 Vincent:「Agent 节点回复人类也要这个引用啊」 ----
const admin = { task_id: 'a1', from_name: 'admin', content: '先修这个啊', result: '收到,正在修' };
const q1 = replyQuoteFor(admin, 'admin');
ck('普通任务:回复引用同一行的请求,作者是发送方', !!q1 && q1.author === 'admin' && q1.text === '先修这个啊' && q1.targetKey === 'a1');
ck('引用条文案与用户侧一致:「作者: 文本」', !!q1 && quoteLabel(q1) === 'admin: 先修这个啊');

const long = { task_id: 'a2', from_name: 'admin', content: '一二三四五六七八九十'.repeat(6), result: '好' };
const q2 = replyQuoteFor(long, 'admin');
ck('长请求截到 40 字加省略号', !!q2 && q2.text.length === 41 && q2.text.endsWith('…'));

const nested = { task_id: 'a3', from_name: 'admin', content: '「@通信龙: 上一条回复」\n那这个呢', result: '这个也修' };
const q3 = replyQuoteFor(nested, 'admin');
ck('请求自带引用行 → 引用请求正文,不引用嵌套的那条', !!q3 && q3.text === '那这个呢');

const manual = { task_id: 'a4', from_name: 'admin', content: '问', result: '「@admin: 问」\n答' };
ck('回复自己已带「@作者」引用行 → 不再重复挂(由既有渲染负责)', replyQuoteFor(manual, 'admin') === null);

ck('没有回复 → 无引用条', replyQuoteFor({ task_id: 'a5', from_name: 'admin', content: '问' }, 'admin') === null);
ck('请求正文为空(只有附件)→ 无引用条', replyQuoteFor({ task_id: 'a6', from_name: 'admin', content: '   ', result: '答' }, 'admin') === null);

const foreign = { task_id: 'a7', from_name: '通信牛', from_node_id: 'n_x', content: '派活', result: '干完了' };
const q7 = replyQuoteFor(foreign, 'admin');
ck('别的节点派的单:作者是那个节点', !!q7 && q7.author === '通信牛' && q7.targetKey === 'a7');

const pendingIdentity = replyQuoteFor({ task_id: 'a8', from_name: 'admin', content: '问', result: '答' }, '我');
ck('身份未拿到时作者退回占位「我」而不是空', !!pendingIdentity && pendingIdentity.author === '我');

const map = new Map<string, any>([['a1', admin]]);
const pro = { task_id: 'dm_1', _proactive: true as const, result: '主动汇报:修好了', in_reply_to: 'a1' };
const q9 = replyQuoteFor(pro, 'admin', map);
ck('主动消息带 in_reply_to 且任务已加载 → 引用那条任务,目标是它', !!q9 && q9.author === 'admin' && q9.text === '先修这个啊' && q9.targetKey === 'a1');
ck('主动消息目标未加载 → 不挂', replyQuoteFor({ ...pro, in_reply_to: 'zzz' }, 'admin', map) === null);
ck('主动消息无 in_reply_to → 不挂', replyQuoteFor({ task_id: 'dm_2', _proactive: true, result: '汇报' }, 'admin', map) === null);
ck('查找函数形式也可用', !!replyQuoteFor(pro, 'admin', (id) => (id === 'a1' ? admin : undefined)));

// 源码契约:ChatScreen 的回复气泡真的渲染了它,而且点击会定位原文
const src = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8').replace(/\r\n?/g, '\n');
ck('ChatScreen 引入 replyQuoteFor', src.includes("import { replyQuoteFor } from './reply-quote';"));
ck('回复分支按 replyQuoteFor 算引用(手写引用优先)', src.includes('const replyQuote = replyQuoted.quote ? null : replyQuoteFor(item, currentUsername, byTaskId);'));
ck('引用条渲染 quoteLabel(replyQuote) 且可点', src.includes('onPress={() => locateKey(replyQuote.targetKey)}') && src.includes('{quoteLabel(replyQuote)}'));
ck('点击定位复用搜索的滚动+高亮', src.includes('const locateKey = (key: string) => {') && src.includes('setHighlight({ key, at: Date.now() });'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
