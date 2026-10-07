// 审计 M2:桌面看板右键菜单没有「改优先级」(手机长按有「改状态…」「改优先级…」)。ck 风格,自执行。
// 现在桌面菜单在「移到」下面直接列优先级各档(当前档 ✓),和列表单元格同一条 PATCH(editCell priority)。
// 量框 / 真点在 tests/test-card-menu-priority/drive.mjs。
import { readFileSync } from 'node:fs';
import { priorityChoices } from './task-priority';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const menu = read('./TaskCardMenu.tsx');
const board = read('./RequirementBoard.tsx');

console.log('# 桌面菜单列优先级');
ck('菜单目标带当前档和可选档', /priority: ReqPriority; priorities: readonly ReqPriority\[\];/.test(menu));
ck('桌面(!touch)在「移到」后面列各档,testID task-menu-priority-<档>', /\{!touch \? target\.priorities\.map\(p => item\(`priority-\$\{p\}`, priorityLabel\(p\)/.test(menu));
ck('当前档 ✓ 且不可点;参与人(quick.priority=locked)全部灰掉', /disabled: target\.quick\.priority === 'locked' \|\| p === target\.priority, checked: p === target\.priority, icon: p === target\.priority \? 'checkmark' : 'flag-outline'/.test(menu));
ck('菜单高度把优先级行算进去(翻边 / 夹进窗口不会算错)', /const count = 1 \+ assignRows \+ \(touch \? 2 : columns\.length\) \+ priorityRows \+ archiveRow;/.test(menu));
ck('手机不变:仍是「改状态…」「改优先级…」两个选择器', /\{touch \? \(\['status', 'priority'\] as const\)\.map/.test(menu));

console.log('# 接线');
ck('右键 / 长按 / 列表行 ⋯ 都用同一个 menuTarget', (board.match(/setMenu\(menuTarget\(item, x, y\)\)/g) ?? []).length === 2 && !/setMenu\(\{ id/.test(board));
ck('可选档 = priorityChoices(旧 Hub 没 P3)', /priorities: priorityChoices\(lowestPriority, item\.priority\)/.test(board));
ck('点一档 = editCell priority(和列表单元格、手机改优先级同一条 PATCH),失败提示', /onPriority=\{\(id, priority\) => \{[\s\S]*?editCell\(id, \{ field: 'priority', priority \}\)\.then\(failed => \{ if \(failed\) setBanner/.test(board));

console.log('# 可选档');
ck('支持 P3 的 Hub:四档', priorityChoices(true).join() === 'high,normal,low,lowest');
ck('旧 Hub:三档', priorityChoices(false).join() === 'high,normal,low');
ck('旧 Hub 上已经是 P3 的卡仍列出 P3(好改回去)', priorityChoices(false, 'lowest').includes('lowest'));

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
