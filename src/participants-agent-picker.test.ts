// owner 10-07「是不是少了参与Agent 的选型」:任务详情「编辑参与人」也能选 Agent。
// 选择器分「人类 / Agent」两组(Agent 按团队分)、保存是 {kind:'node',id} 和人类合在一起的整表(读-改-写)、
// 详情胶囊 Agent =「名字 · Agent」。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { groupPeople, mergeParticipants, peopleOf, type RequirementPerson } from './requirement-people';
import { teamOf } from './agents-list';
import { saveRequirementAssignments } from './requirement-people-api';
import { participantChip } from './i18n-task-presentation';
import { setLanguagePreference as setLanguage } from './i18n';
import './i18n-tasks';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const P = (kind: 'user' | 'node', id: string, name: string): RequirementPerson => ({ kind, id, name, networkId: 'net' });
const people = [P('user', 'u_a', '示例成员甲'), P('user', 'u_b', '示例成员乙'), P('node', 'n_1', '示例A站牛'), P('node', 'n_2', '演示B站马'), P('node', 'n_3', '示例C站狗')];

// —— 选择器列出 Agent,分组 ——
{
  const entries = groupPeople(people, teamOf);
  const heads = entries.filter(e => e.type === 'header');
  ck('两大组:人类在前、Agent 在后', heads.filter(h => h.type === 'header' && h.level === 1).map(h => h.type === 'header' ? `${h.group}:${h.count}` : '').join() === 'user:2,node:3');
  ck('Agent 按团队分小组(teamOf,和节点列表一致)', heads.filter(h => h.type === 'header' && h.level === 2).map(h => h.type === 'header' ? `${h.label}:${h.count}` : '').join() === '示例:2,演示:1', JSON.stringify(heads));
  const rows = peopleOf(entries);
  ck('所有 Agent 都在名单里(不只人类)', ['n_1', 'n_2', 'n_3'].every(id => rows.some(r => r.kind === 'node' && r.id === id)));
  ck('键盘顺序:人类 → Agent(同团队挨着)', rows.map(r => r.id).join() === 'u_a,u_b,n_1,n_3,n_2', rows.map(r => r.id).join());
  ck('只有一种(负责人 / 负责 Agent 选择器)不分组', groupPeople(people.filter(x => x.kind === 'user'), teamOf).every(e => e.type === 'person'));
  ck('只有一个团队:不画团队小标题', groupPeople([people[0], people[2]], teamOf).filter(e => e.type === 'header').length === 2);
  ck('搜索后为空:没有组标题', groupPeople([], teamOf).length === 0);

  const editor = src('./RequirementAssignmentsEditor.tsx');
  const call = editor.slice(editor.indexOf('<PeoplePicker'));
  ck('详情「编辑参与人」的选择器不限种类(人类 + Agent 都列)', !!call && !/kinds=/.test(call.slice(0, call.indexOf('/>'))));
  ck('数据源和负责 Agent 选择器同一个(listRequirementPeople)', editor.includes('listRequirementPeople(cfg)') && src('./TaskDetailPanel.tsx').includes('RequirementAssignmentsEditor'));
  const picker = src('./RequirementPeoplePicker.tsx');
  ck('选择器用 groupPeople + teamOf 分组', picker.includes('groupPeople(meFirst(peopleInNetwork(people, networkId, query), meId), teamOf)'));
  ck('手机面板和桌面下拉都画组标题', (picker.match(/entry\.type === 'header'/g) ?? []).length >= 2 && picker.includes('<GroupHeader key={entry.key} entry={entry} dense />'));
  ck('Agent 行带「Agent」标签(品牌色)', (picker.match(/person\.kind === 'node' \? <AgentTag \/> : null/g) ?? []).length === 2 && /function AgentTag[\s\S]*?colors\.accent[\s\S]*?colors\.tonalBg|function AgentTag[\s\S]*?colors\.tonalBg[\s\S]*?colors\.accent/.test(picker));
}

// —— 保存:{kind:'node',id} 和人类合在一起,读-改-写 ——
{
  const current = [{ kind: 'user' as const, id: 'u_a' }];
  const merged = mergeParticipants(current, current, [{ kind: 'user', id: 'u_a' }, { kind: 'node', id: 'n_1' }]);
  ck('加一个 Agent:人类保留 + {kind:node,id}', JSON.stringify(merged) === '[{"kind":"user","id":"u_a"},{"kind":"node","id":"n_1"}]', JSON.stringify(merged));
  // 选择器开着时别人加了 u_b:这次只加 n_1,u_b 不能被冲掉。
  const raced = mergeParticipants([{ kind: 'user', id: 'u_a' }, { kind: 'user', id: 'u_b' }], current, [{ kind: 'user', id: 'u_a' }, { kind: 'node', id: 'n_1' }]);
  ck('读-改-写:套到最新列表上,不冲掉别人刚加的', JSON.stringify(raced) === '[{"kind":"user","id":"u_a"},{"kind":"user","id":"u_b"},{"kind":"node","id":"n_1"}]', JSON.stringify(raced));
  const removed = mergeParticipants([{ kind: 'user', id: 'u_a' }, { kind: 'node', id: 'n_1' }], [{ kind: 'user', id: 'u_a' }, { kind: 'node', id: 'n_1' }], [{ kind: 'user', id: 'u_a' }]);
  ck('去掉 Agent:只去它,人类留着', JSON.stringify(removed) === '[{"kind":"user","id":"u_a"}]');
  ck('同 id 的人类和 Agent 是两个人', mergeParticipants([], [], [{ kind: 'user', id: 'x' }, { kind: 'node', id: 'x' }]).length === 2);

  const original = globalThis.fetch;
  let sent: any = null;
  globalThis.fetch = (async (_url: any, init: any) => { sent = JSON.parse(String(init.body)); return Response.json({ requirement: { owner: null, participants: sent.participants } }); }) as typeof fetch;
  try {
    const saved = await saveRequirementAssignments({ serverUrl: 'http://isolated.test', token: 'fixture', networkId: 'net' } as any, 'r1', { participants: merged });
    ck('PATCH 请求体只带 participants,Agent 是 {kind:"node",id}', JSON.stringify(sent) === '{"participants":[{"kind":"user","id":"u_a"},{"kind":"node","id":"n_1"}]}', JSON.stringify(sent));
    ck('Hub 回来的 node 参与人原样读回', saved.participants.some(r => r.kind === 'node' && r.id === 'n_1'));
  } finally { globalThis.fetch = original; }

  const editor = src('./RequirementAssignmentsEditor.tsx');
  ck('详情保存走 mergeParticipants(最新列表, 打开时, 选的)', editor.includes('mergeParticipants(latest.current.participants ?? [], opened.current, selected)'));
}

// —— 详情胶囊 ——
{
  setLanguage('zh');
  const agent = participantChip({ kind: 'node', id: 'n_1' }, people);
  const human = participantChip({ kind: 'user', id: 'u_a' }, people);
  ck('Agent 胶囊:「名字 · Agent」', `${agent.name} ${agent.kindLabel}` === '示例A站牛 · Agent' && agent.agent);
  ck('人类胶囊:「名字 人类」', `${human.name} ${human.kindLabel}` === '示例成员甲 人类' && !human.agent);
  ck('认不出的 Agent 不显示裸 id', !participantChip({ kind: 'node', id: 'n_gone_123456' }, people).name.includes('n_gone_123456'));
  setLanguage('en');
  ck('英文:Human / · Agent', participantChip({ kind: 'user', id: 'u_a' }, people).kindLabel === 'Human' && participantChip({ kind: 'node', id: 'n_1' }, people).kindLabel === '· Agent');
  setLanguage('zh');
  const parts = src('./TaskBoardParts.tsx');
  ck('Agent 胶囊和人类分开画:浅蓝底 + 品牌蓝字', parts.includes("backgroundColor: agent ? colors.tonalBg : colors.subtleFill") && parts.includes("testID={agent ? 'person-chip-agent' : 'person-chip'}"));
}

// —— 「我参与」筛选不受 Agent 参与人影响 ——
{
  const { filterForScope, applyFilter } = await import('./task-board-model');
  const f = filterForScope({ owners: [], priorities: [] }, 'participating', 'u_me');
  ck('「我参与」= 参与人里有 user:我', f.participant === 'user:u_me');
  {
    const items: any[] = [{ id: 'a', participants: [{ kind: 'node', id: 'u_me' }] }, { id: 'b', participants: [{ kind: 'user', id: 'u_me' }, { kind: 'node', id: 'n_1' }] }];
    const out = applyFilter(items, f).map((i: any) => i.id).join();
    ck('同 id 的 Agent 参与人不算「我参与」;混着 Agent 的卡照样命中', out === 'b', out);
  }
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
