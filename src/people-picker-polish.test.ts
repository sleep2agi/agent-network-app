// 任务页审计 M8 / M9 / L11:负责人筛选分「人 / Agent」且我第一;人员选择器副标题写角色不写内部 id、我第一标「（我）」、
// 参与人模式有「加我」;分两个角色的 Hub 上负责人不再标「（人类）」。
// ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { idMatchesQuery, meFirst, personSubtitle, type RequirementPerson } from './requirement-people';
import { ownerFilterSections, UNASSIGNED } from './task-board-model';
import { listRequirementPeople } from './requirement-people-api';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

console.log('# M8 负责人筛选分段');
{
  const U = (id: string) => ({ key: `user:${id}`, ref: { kind: 'user' as const, id }, name: id, count: 1 });
  const N = (id: string) => ({ key: `node:${id}`, ref: { kind: 'node' as const, id }, name: id, count: 5 });
  const none = { key: UNASSIGNED, ref: null, name: '未分配', count: 2 };
  // ownerCounts 按数目排:节点多的在前,我在中间偏后。
  const rows = [N('n_a'), U('u_a'), N('n_b'), U('u_b'), U('u_me'), none];
  const secs = ownerFilterSections(rows, 'user:u_me');
  ck('三段:人 / Agent / 未分配,按这个顺序', secs.map(s => s.kind).join() === 'people,agents,none', secs.map(s => s.kind).join());
  ck('「人」段我第一,其余保持原顺序', secs[0].rows.map(r => r.key).join() === 'user:u_me,user:u_a,user:u_b');
  ck('「Agent」段只有节点', secs[1].rows.every(r => r.ref?.kind === 'node') && secs[1].rows.length === 2);
  ck('未分配单独在最后', secs[2].rows.length === 1 && secs[2].rows[0].key === UNASSIGNED);
  ck('空段不返回(只有节点 + 未分配)', ownerFilterSections([N('n_a'), none], 'user:u_me').map(s => s.kind).join() === 'agents,none');
  ck('不知道我是谁时「人」段保持原顺序', ownerFilterSections(rows, '')[0].rows.map(r => r.key).join() === 'user:u_a,user:u_b,user:u_me');
  const board = src('./RequirementBoard.tsx');
  ck('头部筛选弹层用分段(桌面下拉和手机弹层是同一个 FilterMenu)', /open\.kind === 'owner'\s*\n\s*\/\/[^\n]*\n\s*\? ownerFilterSections\(/.test(board));
  ck('段标题有 testID(人 / Agent)', board.includes('task-filter-sec-${sec.kind}') && board.includes("tr('tasks.filterSectionPeople')") && board.includes("tr('tasks.filterSectionAgents')"));
}

console.log('# M9 人员选择器');
{
  const P = (o: Partial<RequirementPerson> & { kind: 'user' | 'node'; id: string }): RequirementPerson => ({ networkId: 'n', name: o.id, ...o });
  const list = [P({ kind: 'user', id: 'u_a' }), P({ kind: 'node', id: 'n_x' }), P({ kind: 'user', id: 'u_me' }), P({ kind: 'node', id: 'u_me' })];
  ck('我排第一,同 id 的节点不算我', meFirst(list, 'u_me').map(r => `${r.kind}:${r.id}`).join() === 'user:u_me,user:u_a,node:n_x,node:u_me');
  ck('meId 为空时不动顺序', meFirst(list, null).map(r => r.id).join() === 'u_a,n_x,u_me,u_me');
  ck('副标题:人类 = 成员,不带 id', JSON.stringify(personSubtitle(P({ kind: 'user', id: 'u_a' }), '')) === '{"role":"member"}');
  ck('副标题:节点 = Agent,不带 id', JSON.stringify(personSubtitle(P({ kind: 'node', id: 'n_x' }), '')) === '{"role":"agent"}');
  ck('副标题:Hub 给了管理员 / 在线才写', JSON.stringify(personSubtitle(P({ kind: 'user', id: 'u_a', role: 'admin', online: false }), '')) === '{"role":"admin","online":false}');
  ck('搜索词命中 id 时才带 id', personSubtitle(P({ kind: 'node', id: 'n_e06d93' }), 'E06D').id === 'n_e06d93' && personSubtitle(P({ kind: 'node', id: 'n_e06d93', name: '示例' }), '示例').id === undefined);
  ck('空白搜索词不算命中', !idMatchesQuery({ kind: 'user', id: 'u_a' }, '   '));
  const picker = src('./RequirementPeoplePicker.tsx');
  ck('行副标题不再拼 person.id', !/· \{person\.id\}/.test(picker) && picker.includes('subtitle(person)'));
  ck('我那行标「（我）」(tasks.copy.62)', picker.includes("isMe(person) ? tr('tasks.copy.62'"));
  ck('参与人模式才有「加我」', /mode === 'participants' \? candidates\.find/.test(picker) && picker.includes('testID="people-add-me"'));
  ck('看板的选择器把 meId 传进去', /kinds=\{assignFor\.mode === 'owner'[^\n]*\n\s*meId=\{meId\}/.test(src('./RequirementBoard.tsx')));
}

console.log('# M9 Hub 给角色 / 在线时带上');
{
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ people: [
    { kind: 'user', id: 'u_a', networkId: 'net-a', name: '甲', role: 'owner', online: true },
    { kind: 'user', id: 'u_b', networkId: 'net-a', name: '乙', role: 'member' },
    { kind: 'node', id: 'n_x', networkId: 'net-a', name: 'x', role: 'weird' },
  ] });
  try {
    const rows = await listRequirementPeople({ serverUrl: 'http://isolated.test', token: 'fixture', networkId: 'net-a' });
    ck('owner 算管理员、online 原样', rows[0].role === 'admin' && rows[0].online === true);
    ck('member 照收、没给 online 就是 undefined', rows[1].role === 'member' && rows[1].online === undefined);
    ck('认不出的角色不带', rows[2].role === undefined);
  } finally { globalThis.fetch = original; }
}

console.log('# L11 负责人不再标「（人类）」');
{
  const create = src('./TaskCreateDialog.tsx');
  ck('OwnerField 只在旧 Hub(role=any)标种类', create.includes("value ? (role === 'any' ? `${name}（"));
  const editor = src('./RequirementAssignmentsEditor.tsx');
  ck('详情负责人 / 参与人:两个角色的 Hub 上人类不标', editor.includes("hasRoles(item) && ref.kind === 'user' ? ''"));
  const copy = src('./i18n-tasks.ts');
  ck('两个角色的负责人占位不写(人类)', copy.includes("['选择负责人,可空','Choose owner (optional)']") && !copy.includes("['选择负责人(人类),可空'"));
  ck('旧 Hub 的占位仍写人类或 Agent', copy.includes("['选择负责人(人类或 Agent),可空'"));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
