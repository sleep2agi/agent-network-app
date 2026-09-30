// 平板横屏的任务列表(owner 09-30 截图):首行空标题 + 「状态」列被挤出右边。ck 风格自执行,不是 bun:test。
import { readFileSync } from 'node:fs';
import { COMPACT_WIDTHS, DEFAULT_WIDTHS, defaultFields, fittedWidths, minWidth, type FieldPref } from './task-list-fields';
import { hasVisibleTitle, titleText } from './requirements-model';
import { requirementFromHub } from './requirements-hub';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

console.log('\n列宽:放得下 / 放不下');
// 没有 requirement_seq 的 Hub:ID 列不显示(TaskListTable 按 seqCapable 过滤)。
const vis = defaultFields().filter(f => f.visible && f.id !== 'seq');
const total = vis.reduce((n, f) => n + DEFAULT_WIDTHS[f.id], 0);
const compact = vis.reduce((n, f) => n + COMPACT_WIDTHS[f.id], 0);
ck('放得下:原样默认宽', JSON.stringify(fittedWidths(vis, total + 50)) === JSON.stringify(Object.fromEntries(vis.map(f => [f.id, DEFAULT_WIDTHS[f.id]]))));
ck('还没量到宽(0):原样', fittedWidths(vis, 0).status === DEFAULT_WIDTHS.status);
const mid = fittedWidths(vis, Math.round((total + compact) / 2));
ck('放不下一半:总宽正好收到可用宽(±列数的取整误差)', Math.abs(sum(mid) - Math.round((total + compact) / 2)) <= vis.length, `${sum(mid)}`);
ck('每列都在紧凑宽和默认宽之间', vis.every(f => mid[f.id] <= DEFAULT_WIDTHS[f.id] && mid[f.id] >= COMPACT_WIDTHS[f.id]));
const tight = fittedWidths(vis, 400);
ck('再窄也不低于紧凑宽(之后才横向滚动)', vis.every(f => tight[f.id] === COMPACT_WIDTHS[f.id]));
ck('紧凑宽不低于拖动的下限(标题除外:它有余量就伸长)', (Object.keys(COMPACT_WIDTHS) as (keyof typeof COMPACT_WIDTHS)[]).every(id => id === 'title' || COMPACT_WIDTHS[id] >= minWidth(id)));
// 桌面 1000 宽窗口带左栏:表格 668 → 给列用 668 − 32 − 7×12 − (勾选格 20 + 12) = 520,「状态」要在前六列里放得下
const narrowDesk = fittedWidths(vis, 520);
const deskStatusRight = (() => { let x = 16 + 32; for (const f of vis) { x += narrowDesk[f.id]; if (f.id === 'status') return x; x += 12; } return -1; })();
ck('桌面 1000 宽窗口(带左栏):「状态」列的右边在表格里', deskStatusRight > 0 && deskStatusRight <= 668, `status right ${deskStatusRight}`);
const dragged: FieldPref[] = vis.map(f => (f.id === 'owner' ? { ...f, width: 300 } : f));
const dw = fittedWidths(dragged, 700);
ck('用户拖过的列不动', dw.owner === 300);
ck('没拖过的照样收', dw.title < DEFAULT_WIDTHS.title && dw.status < DEFAULT_WIDTHS.status);
// 1000×700 平板:表格 908 宽 → 给列用 908 − 32 − 7×12 = 792
const tablet = fittedWidths(vis, 792);
const statusRight = (() => { let x = 16; for (const f of vis) { x += tablet[f.id]; if (f.id === 'status') return x; x += 12; } return -1; })();
ck('1000 宽平板:「状态」列的右边在表格可见范围里', statusRight > 0 && statusRight <= 908 - 16, `status right ${statusRight}`);

// 有 ID 列(#563,requirement_seq Hub):1000 宽平板上「状态」也还在表格里(多一列 + 一个间隙)
const visSeq = defaultFields().filter(f => f.visible);
const tabletSeq = fittedWidths(visSeq, 792 - 12);
const seqStatusRight = (() => { let x = 16; for (const f of visSeq) { x += tabletSeq[f.id]; if (f.id === 'status') return x; x += 12; } return -1; })();
ck('有 ID 列时 1000 宽平板:「状态」列的右边在表格里', visSeq.some(f => f.id === 'seq') && seqStatusRight > 0 && seqStatusRight <= 908 - 16, `status right ${seqStatusRight}`);

console.log('\n空标题');
ck('普通标题看得见', hasVisibleTitle('天马企业组织树权限设置'));
ck('只有零宽字符 = 看不见', !hasVisibleTitle('​​') && !hasVisibleTitle('﻿') && !hasVisibleTitle('‍⁠'));
ck('全角空格 / 不换行空格 = 看不见', !hasVisibleTitle('　 '));
ck('零宽字符能过 Hub 行解析(所以列表会画一行空标题)', requirementFromHub({ id: 'r_1', name: '​' })?.name === '​');
ck('空白名字的行本来就被丢掉(不是空标题的来源)', requirementFromHub({ id: 'r_2', name: '   ' }) === null);
ck('看不见字时显示「(无标题)· id 末 6 位」', titleText({ id: 'r_abcdef123456', name: '​' }) === '（无标题）· 123456');
ck('看得见就原样', titleText({ id: 'x', name: 'Portal 文案' }) === 'Portal 文案');

console.log('\n接线(静态)');
const table = src('./TaskListTable.tsx');
ck('列宽走 fittedWidths(按量到的表格宽)', table.includes('fittedWidths(visible, available)') && table.includes('onLayout={e => setTableW('));
// 不是 flex:0 —— web 上那是 0 基准宽,整列标题空白(task-title-web-width.test.ts)。
ck('标题格里的标题文字不 flex:1(竖排里会占满行高、把字顶到最上沿),按内容宽(flex:-1)', /s\.tdTitle, \{ flex: -1 \}/.test(table));
ck('没有标签不放标签那一层', table.includes('item.tags?.length ? <TaskTagChips'));
ck('列表 / 卡片 / 手机行都用 titleText(搜索高亮包在外面)', table.includes('highlight(titleText(item), terms)') && (src('./RequirementBoard.tsx').match(/\{highlight\(titleText\(item\), terms\)\}/g) ?? []).length === 2);

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
