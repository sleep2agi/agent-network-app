// 看板卡片上的参与人头像 → 设置参与人:桌面锚在头像组下面的下拉(同详情 / 新建的字段,#637 / #639),手机照旧居中面板。
// ck 风格,自执行。量框的那一半在 tests/test-people-picker/drive.mjs(card anchored 一步)。
import { readFileSync } from 'node:fs';
import { anchorRightAligned, anchorSelectMenu, SELECT_MENU_MIN_WIDTH } from './task-select-model';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

console.log('# 右沿对齐锚点(头像组窄、贴卡片右边)');
{
  const stack = { x: 900, y: 300, w: 46, h: 20 };
  const a = anchorRightAligned(stack);
  ck('换成宽 240、右边和头像组对齐', a.w === SELECT_MENU_MIN_WIDTH && a.x + a.w === stack.x + stack.w && a.y === stack.y && a.h === stack.h);
  const view = { width: 1440, height: 900 };
  const pos = anchorSelectMenu(a, view, { rows: 4, rowH: 40, search: true, maxWidth: 360 });
  ck('下拉右沿 = 头像组右沿', pos.left + pos.width === stack.x + stack.w, `${pos.left}+${pos.width}`);
  ck('下拉在头像组下面 4px', pos.top === stack.y + stack.h + 4);
  const wide = { x: 10, y: 10, w: 300, h: 30 };
  ck('本来就够宽的锚点原样返回', anchorRightAligned(wide) === wide);
  const nearLeft = anchorSelectMenu(anchorRightAligned({ x: 20, y: 300, w: 40, h: 20 }), view, { rows: 3, rowH: 40, search: true });
  ck('贴窗口左边时照旧夹进窗口(左边留 8)', nearLeft.left === 8);
  const low = anchorSelectMenu(anchorRightAligned({ x: 900, y: 860, w: 46, h: 20 }), view, { rows: 4, rowH: 40, search: true });
  ck('下面放不下就翻到上面', low.top + low.maxHeight <= 860 - 4 + 0.5);
}

console.log('# 接线');
{
  const board = read('RequirementBoard.tsx');
  const parts = read('TaskBoardParts.tsx');
  ck('头像组把自己的元素交给 onPress', /onPress=\{onPress \? \(\) => onPress\(stackEl\.current\) : undefined\}/.test(parts) && /stackEl\.current = el;/.test(parts));
  ck('卡片头像 → openAssign 带上头像组元素', /\(stack\?: any\) => \{ void openAssign\(item\.id, 'participants', stack\); \}/.test(board));
  ck('只有指针(桌面)才量锚点,手机 anchor=null', /if \(!pointer \|\| !anchorEl\) \{ setAssignFor\(\{ id, mode, anchor: null, opened \}\); return; \}/.test(board));
  ck('量到的锚点右沿对齐后交给选择器', /measureAnchor\(anchorEl, a => setAssignFor\(\{ id, mode, anchor: a \? anchorRightAligned\(a\) : null, opened \}\)\)/.test(board));
  ck('选择器收到 anchor', /anchor=\{assignFor\.anchor\}/.test(board));
  ck('卡片菜单「设置参与人…」仍走居中(不传元素)', /onAssign=\{\(id, mode\) => \{ void openAssign\(id, mode\); \}\}/.test(board));
  const picker = read('RequirementPeoplePicker.tsx');
  ck('窗口宽度门仍在选择器里(< 600 照旧居中)', /const anchored = !!anchor && win\.width >= PEOPLE_DROPDOWN_MIN_WIDTH;/.test(picker));
  ck('下拉的 Esc 走 escape-close(不连带关下面那层)', /listenEscapeClose\(\(\) => keyRef\.current\.onClose\(\)\)/.test(picker));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
