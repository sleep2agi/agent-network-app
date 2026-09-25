// line / endLine:块在原文里的首行、末行(0 起、含末行;\r\n、\r、\n 都算一次换行)。
// itemLines / rowLines:列表每一项、表格每一行各自所在的原文行。规则文件阅读模式「双击跳到源码」用它们
// (2026-09-25 Vincent);聊天渲染不读这些字段。
type SourceSpan = { line?: number; endLine?: number };
export type MarkdownBlock = SourceSpan & (
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[]; itemLines?: number[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'table'; rows: string[][]; rowLines?: number[] }
);

const tableCells = (line: string) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

const isTableDivider = (line: string) => {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
};

export const parseMarkdownBlocks = (source: string): MarkdownBlock[] => {
  const lines = (source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const start = i;
    const fence = line.match(/^\s*```\s*([^\s`]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', language: fence[1] || undefined, text: body.join('\n'), line: start, endLine: i - 1 });
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim(), line: start, endLine: start });
      i++;
      continue;
    }

    if (i + 1 < lines.length && line.includes('|') && isTableDivider(lines[i + 1])) {
      const rows = [tableCells(line)];
      const rowLines = [i];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rowLines.push(i); rows.push(tableCells(lines[i++])); }
      blocks.push({ kind: 'table', rows, rowLines, line: start, endLine: i - 1 });
      continue;
    }

    const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (list) {
      const ordered = !!list[2];
      const items: string[] = [];
      const itemLines: number[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!match || !!match[2] !== ordered) break;
        items.push(match[3]);
        itemLines.push(i);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items, itemLines, line: start, endLine: i - 1 });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const body: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*>\s?(.*)$/);
        if (!match) break;
        body.push(match[1]);
        i++;
      }
      blocks.push({ kind: 'quote', text: body.join('\n'), line: start, endLine: i - 1 });
      continue;
    }

    const paragraph = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(?:```|#{1,6}\s|>|[-+*]\s|\d+\.\s)/.test(lines[i]) &&
      !(i + 1 < lines.length && lines[i].includes('|') && isTableDivider(lines[i + 1]))
    ) paragraph.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n'), line: start, endLine: i - 1 });
  }
  return blocks;
};

export const isSafeMarkdownUrl = (url: string) => /^https?:\/\//i.test(url.trim());
