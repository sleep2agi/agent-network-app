// 2026-09-16 Vincent(安卓截图):「手机端的那个表格显示还是很有问题」—— 定宽列把气泡撑出屏幕、右边被裁。
import fs from 'node:fs';
import path from 'node:path';
import { tableLayoutFor, stackedRows } from './table-layout';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

ck('web always scrolls a grid', tableLayoutFor(5, false) === 'grid-scroll' && tableLayoutFor(2, false) === 'grid-scroll');
ck('native ≤2 columns → flexible grid', tableLayoutFor(2, true) === 'grid-flex' && tableLayoutFor(1, true) === 'grid-flex');
ck('native ≥3 columns → stacked cards', tableLayoutFor(3, true) === 'stacked' && tableLayoutFor(6, true) === 'stacked');

const rows = [['变异', 'rc', '顶出'], ['M1 删掉', '1', '承重'], ['M2', '1']];
const cards = stackedRows(rows);
ck('one card per data row (header excluded)', cards.length === 2);
ck('cells labelled by header', cards[0][0].label === '变异' && cards[0][0].value === 'M1 删掉' && cards[0][2].label === '顶出');
ck('short row padded with empty values', cards[1].length === 3 && cards[1][2].value === '');
ck('extra cells beyond the header get a positional label', stackedRows([['a'], ['x', 'y']])[0][1].label === '#2');
ck('empty table → no cards', stackedRows([]).length === 0);

const src = fs.readFileSync(path.join(__dirname, 'MarkdownMessage.tsx'), 'utf8').replace(/\r\n?/g, '\n');
ck('table block delegates to TableBlock', src.includes("if (block.kind === 'table') return <TableBlock key={index} rows={block.rows} />;"));
ck('TableBlock uses the layout helper with the native flag', src.includes('tableLayoutFor(columns, NATIVE)'));
ck('flex cells have no fixed width', /tableCellFlex: \{ flex: 1, minWidth: 0,/.test(src) && !/tableCellFlex: \{[^}]*width: 150/.test(src));
ck('stacked cards render label + value per cell', src.includes('styles.tableCardLabel') && src.includes('styles.tableCardValue'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
