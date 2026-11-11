// chuqi 2026-11-11：对端 agent 用 `~~~text` 写代码块，客户端把整段当正文渲染
// （波浪号原样显示，块里的「1. 2.」被当成有序列表重新编号）⇒ 读起来像「渲染坏了」。
// CommonMark 允许反引号与波浪号两种围栏，且开闭必须同字符、闭合长度 >= 开启长度。
import { describe, expect, test } from 'bun:test';
import { parseMarkdownBlocks } from './markdown-model';

const blocks = (md: string) => parseMarkdownBlocks(md);

describe('波浪号围栏', () => {
  test('~~~text 被识别为代码块，语言为 text', () => {
    const b = blocks('~~~text\n1. 不是列表\n~~~');
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe('code');
    expect((b[0] as any).language).toBe('text');
    expect((b[0] as any).text).toBe('1. 不是列表');
  });

  test('块内的 1. / 2. 不再被拆成有序列表', () => {
    const b = blocks('~~~\n1. 查 /session\n2. 建 session\n~~~');
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe('code');
  });

  test('反引号围栏行为不变', () => {
    const b = blocks('```ts\nconst x = 1\n```');
    expect(b[0].kind).toBe('code');
    expect((b[0] as any).language).toBe('ts');
  });

  test('闭合围栏可以用更长的同字符（CommonMark）', () => {
    const b = blocks('~~~\nbody\n~~~~~');
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe('code');
  });

  test('反引号块里的 ~~~ 不会被当成闭合', () => {
    const b = blocks('```\n~~~\n```');
    expect(b).toHaveLength(1);
    expect((b[0] as any).text).toBe('~~~');
  });
});
