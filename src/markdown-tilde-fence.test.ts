// chuqi 2026-11-11：对端 agent 用 `~~~text` 写代码块，客户端把整段当正文渲染
// （波浪号原样显示，块里的「1. 2.」被当成有序列表重新编号）⇒ 读起来像「渲染坏了」。
// CommonMark 允许反引号与波浪号两种围栏，且开闭必须同字符、闭合长度 >= 开启长度。
//
// 本仓测试是**普通脚本 + ck()**（不是 bun:test），照既有约定写，见 markdown-model.test.ts。
import { parseMarkdownBlocks } from './markdown-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const b1 = parseMarkdownBlocks('~~~text\n1. 不是列表\n~~~');
ck('~~~text 被识别为代码块', b1.length === 1 && b1[0].kind === 'code');
ck('~~~text 的语言标记是 text', b1[0].kind === 'code' && (b1[0] as any).language === 'text');
ck('块内容原样', b1[0].kind === 'code' && (b1[0] as any).text === '1. 不是列表');

const b2 = parseMarkdownBlocks('~~~\n1. 查 /session\n2. 建 session\n~~~');
ck('块内的 1. / 2. 不再被拆成有序列表', b2.length === 1 && b2[0].kind === 'code');

const b3 = parseMarkdownBlocks('```ts\nconst x = 1\n```');
ck('反引号围栏行为不变', b3[0]?.kind === 'code' && (b3[0] as any).language === 'ts' && (b3[0] as any).text === 'const x = 1');

const b4 = parseMarkdownBlocks('~~~\nbody\n~~~~~');
ck('闭合围栏可以用更长的同字符', b4.length === 1 && b4[0].kind === 'code' && (b4[0] as any).text === 'body');

const b5 = parseMarkdownBlocks('```\n~~~\n```');
ck('反引号块里的 ~~~ 不会被当成闭合', b5.length === 1 && b5[0].kind === 'code' && (b5[0] as any).text === '~~~');

// admin 2026-11-22 截图：对端在开围栏那一行前面自己写了 [alias] 署名，与气泡头部已有的
// 发送者名字重复；这一行就不再是「只有围栏」了，整段又退化成正文。
const b6 = parseMarkdownBlocks('[通信欧] ```text\n本轮：...\n```');
ck('开围栏前的 [alias] 署名不挡围栏识别', b6.length === 1 && b6[0].kind === 'code');
ck('[alias] 署名本身被丢弃（头部已经画过了），语言标记仍是 text', b6[0].kind === 'code' && (b6[0] as any).language === 'text');
ck('块内容不含 [alias] 前缀', b6[0].kind === 'code' && (b6[0] as any).text === '本轮：...');
const b7 = parseMarkdownBlocks('普通一段话 ```text\n不是围栏\n```');
ck('围栏前面是真正文（不是短方括号标签）时该行不识别为开围栏，仍是段落', b7[0]?.kind === 'paragraph' && (b7[0] as any).text.startsWith('普通一段话'));

console.log(`${p}/${t} passed`);
if (p !== t) process.exit(1);
