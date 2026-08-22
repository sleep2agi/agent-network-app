export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'table'; rows: string[][] };

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

    const fence = line.match(/^\s*```\s*([^\s`]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', language: fence[1] || undefined, text: body.join('\n') });
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (i + 1 < lines.length && line.includes('|') && isTableDivider(lines[i + 1])) {
      const rows = [tableCells(line)];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(tableCells(lines[i++]));
      blocks.push({ kind: 'table', rows });
      continue;
    }

    const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (list) {
      const ordered = !!list[2];
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!match || !!match[2] !== ordered) break;
        items.push(match[3]);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
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
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }

    const paragraph = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(?:```|#{1,6}\s|>|[-+*]\s|\d+\.\s)/.test(lines[i]) &&
      !(i + 1 < lines.length && lines[i].includes('|') && isTableDivider(lines[i + 1]))
    ) paragraph.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
};

export const isSafeMarkdownUrl = (url: string) => /^https?:\/\//i.test(url.trim());
