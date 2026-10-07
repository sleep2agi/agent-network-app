// 任务页审计 L10 / L12 / L13(app 任务页审计剩余三条)。ck 风格,自执行。
//   L10 看板卡片上看得出「我参与了」:我排第一、强调色描边、名单标「我」。
//   L12 桌面上人员选择器锚在字段下面(不再居中盖住详情面板),手机照旧居中面板。
//   L13 「仅相关任务」成员新建 / 挪卡只列能编辑的项目;一个都没有就只剩「无项目」。
import { readFileSync } from 'node:fs';
import { defaultProjectFor, participantsMeFirst, participantStack, pickableProjects, NO_PROJECT } from './task-board-model';
import { projectFromHub } from './requirements-hub';
import { anchorSelectMenu } from './task-select-model';
import type { RequirementPerson } from './requirement-people';
import type { RequirementProject } from './requirements-model';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const ME = { kind: 'user' as const, id: 'u_me' };
const A = { kind: 'user' as const, id: 'u_a' };
const B = { kind: 'user' as const, id: 'u_b' };
const C = { kind: 'user' as const, id: 'u_c' };
const N = { kind: 'node' as const, id: 'u_me' }; // 同 id 的 Agent 不是我
const people: RequirementPerson[] = [
  { ...ME, name: '样例我', networkId: 'n' }, { ...A, name: '样例甲', networkId: 'n' }, { ...B, name: '样例乙', networkId: 'n' },
  { ...C, name: '样例丙', networkId: 'n' }, { ...N, name: 'sample-node', networkId: 'n' },
];
const meKey = 'user:u_me';

console.log('# L10 参与人头像里的「我」');
{
  const st = participantStack([A, B, C, ME], people, 3, meKey);
  ck('我在第 4 位也排到最前(不被折进 +N)', st.shown[0].key === meKey && st.shown[0].me && st.more === 1);
  ck('只有我一个 me=true', st.shown.filter(x => x.me).length === 1);
  ck('其余顺序不变', st.shown.slice(1).map(x => x.name).join() === '样例甲,样例乙');
  ck('名单里标「我」', st.all.startsWith('样例我（我）、'));
  const none = participantStack([A, B], people, 3, meKey);
  ck('我不在 → 没有 me,顺序原样', none.shown.every(x => !x.me) && none.shown[0].name === '样例甲');
  ck('不给 meKey → 与旧行为逐字相同', JSON.stringify(participantStack([A, ME], people).shown.map(x => x.name)) === '["样例甲","样例我"]' && !participantStack([A, ME], people).shown.some(x => x.me));
  ck('同 id 的 Agent 不算我', !participantStack([N], people, 3, meKey).shown[0].me);
  ck('meFirst 不改原数组', (() => { const refs = [A, ME]; participantsMeFirst(refs, meKey); return refs[0] === A; })());

  const parts = read('TaskBoardParts.tsx');
  const stack = parts.slice(parts.indexOf('export function ParticipantStack'), parts.indexOf('export function PersonChips'));
  ck('描边宽度对我和别人一样(1.5)—— 卡片不长高', /borderWidth: 1\.5, borderColor: p\.me \? colors\.accent : cardBg\(\)/.test(stack));
  ck('悬停名单 / 长按展开都还在', stack.includes("setAttribute('title'") && stack.includes('onLongPress'));
  const board = read('RequirementBoard.tsx');
  ck('看板卡片把 meKey 传下去', /<ParticipantStack[^>]*meKey=\{meId \? personKey\(\{ kind: 'user', id: meId \}\) : null\}/.test(board) && (board.match(/<CardFooter [^>]*meId=\{meId\}/g) || []).length === 2);
}

console.log('# L12 人员选择器:桌面锚定下拉');
{
  const picker = read('RequirementPeoplePicker.tsx');
  ck('有锚点且窗口够宽才用下拉', /const anchored = !!anchor && win\.width >= PEOPLE_DROPDOWN_MIN_WIDTH;/.test(picker));
  ck('下拉的位置用 anchorSelectMenu(同 TaskSelectMenu)', /anchorSelectMenu\(anchor, viewport,/.test(picker));
  ck('键盘:↑↓ / 回车 / ⌘·Ctrl+回车', ['ArrowDown', 'ArrowUp', "e.key === 'Enter' && (e.metaKey || e.ctrlKey)"].every(k => picker.includes(k)));
  const drop = picker.slice(picker.indexOf('function PeopleDropdown'));
  ck('Esc 走 listenEscapeClose(keyup 才关并吞掉),不在 keydown 上关 —— 不连带关掉下面的整页详情', !drop.includes("'Escape'") && /listenEscapeClose\(\(\) => keyRef\.current\.onClose\(\)\)/.test(drop));
  ck('翻到上面时用 bottom 贴住字段上沿', /up \? \{ bottom: viewport\.height - \(anchor\.y - 4\) \}/.test(drop));
  ck('搜索框自动聚焦(打字就筛)', /<TextInput ref=\{search\} autoFocus value=\{query\}/.test(picker));
  ck('负责人在下拉里点了就生效', /if \(anchored && mode === 'owner'\) \{ onConfirm\(next\); return; \}/.test(picker));
  const roles = read('TaskCreateDialog.tsx');
  ck('RoleFields 只在 pointer 时量锚点', /if \(!pointer\) \{ setAnchor\(null\); setPicker\(role\); return; \}/.test(roles));
  ck('参与人字段:手指不量锚点', /if \(touch\) \{ setAnchor\(null\); setOpen\(true\); return; \}/.test(roles));
  const detail = read('TaskDetailPanel.tsx');
  // 窄窗口里的整页详情也是鼠标:同样锚定;手机靠 pointer=false + 窗口宽度门(PEOPLE_DROPDOWN_MIN_WIDTH)。
  ck('详情的负责人 / 参与人都传 pointer', /idBase="req-edit-owner"\n\s+pointer=\{pointer\}/.test(detail) && /fields="participants" onSaved=\{[^\n]*?\} pointer=\{pointer\}/.test(detail));
  const vp = { width: 1280, height: 800 };
  const right = anchorSelectMenu({ x: 1180, y: 300, w: 90, h: 40 }, vp, { rows: 8, rowH: 40, search: true, maxWidth: 360 });
  ck('靠右边的字段:下拉夹回窗口里', right.left + right.width <= vp.width - 8 && right.left >= 8);
  const bottom = anchorSelectMenu({ x: 400, y: 740, w: 300, h: 40 }, vp, { rows: 8, rowH: 40, search: true, maxWidth: 360 });
  ck('靠底边的字段:翻到上面且不出窗口', bottom.top + bottom.maxHeight <= 740 && bottom.top >= 8);
}

console.log('# L13 「仅相关任务」成员只列能编辑的项目');
{
  const ro = projectFromHub({ id: 'p1', name: '只看项目', color: '#2563eb', sort: 0, viewer_can: { edit: false } });
  const rw = projectFromHub({ id: 'p2', name: '可编辑项目', color: '#16a34a', sort: 1, viewer_can: { edit: true } });
  const plain = projectFromHub({ id: 'p3', name: '旧 Hub 项目', color: '#d97706', sort: 2 });
  ck('viewer_can.edit=false → canEdit:false', ro?.canEdit === false);
  ck('能改 / 旧 Hub → 没有 canEdit 键(与今天逐字相同)', !!rw && !('canEdit' in rw) && !!plain && !('canEdit' in plain));
  const projects = [ro!, rw!, plain!];
  ck('可选项目去掉只看的', pickableProjects(projects).map(x => x.id).join() === 'p2,p3');
  const allRo: RequirementProject[] = [ro!, { ...ro!, id: 'p4', name: '另一个只看' }];
  ck('一个能编辑的都没有 → 空(只剩「无项目」)', pickableProjects(allRo).length === 0);
  const f = (project: string) => ({ owners: [], priorities: [], project });
  ck('筛到只看项目时新建不预选它', defaultProjectFor(f('p1'), projects) === null);
  ck('筛到能编辑的项目照旧预选', defaultProjectFor(f('p2'), projects) === 'p2' && defaultProjectFor(f(NO_PROJECT), projects) === null);
  const pickers = read('TaskFieldPickers.tsx');
  ck('项目下拉的选项走 pickableProjects', /pickableProjects\(projects\)\.map\(p => \(\{ id: p\.id/.test(pickers));
  ck('当前项目只看时留在列表里(灰掉、标不可编辑),不悄悄丢', pickers.includes("tr('tasks.projectNotEditable'") && /cur\.canEdit === false\) list\.push\(.*disabled: true \}\);/.test(pickers));
  ck('没有能编辑的项目给一句说明', pickers.includes("tr('tasks.projectNoneEditable')"));
  const board = read('RequirementBoard.tsx');
  ck('建子任务不继承只看的母任务项目', board.includes("!projects?.some(p => p.id === parent.projectId && p.canEdit === false)"));
}

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
