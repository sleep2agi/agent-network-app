// 新建时带参与人 + 左栏「我参与的」(只算参与人,和「我负责的」分开)。
// ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { applyFilter, createInput, emptyDraft, filterActive, filterForScope, ownersForScope, scopeOf, type BoardFilter } from './task-board-model';
import { createRequirementBody } from './requirements-hub';
import { isMyCard } from './task-activity-model';
import { setLanguagePreference, t } from './i18n';
import './i18n-tasks';
import type { Requirement } from './requirements-model';

let p = 0, n = 0;
const ck = (name: string, c: boolean, extra = '') => { n++; if (c) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const ME = { kind: 'user' as const, id: 'u_me' };
const AMY = { kind: 'user' as const, id: 'u_amy' };
const BOT = { kind: 'node' as const, id: 'node_demo_a' };
const cfg = { serverUrl: 'http://hub.test', token: 't', networkId: 'net_demo' };

console.log('# 新建请求体:参与人');
{
  const input = createInput({ ...emptyDraft(), name: '示例任务', participants: [AMY, { ...ME, name: '显示名' } as never, AMY, BOT] }, true)!;
  ck('人类 + Agent 都收、按 kind:id 去重、只带 {kind,id}', JSON.stringify(input.participants) === JSON.stringify([AMY, ME, BOT]), JSON.stringify(input.participants));
  const body = createRequirementBody(cfg, input);
  ck('POST 体里是 participants: [{kind,id}],Agent = {kind:"node",id}', JSON.stringify(body.participants) === JSON.stringify([AMY, ME, BOT]), JSON.stringify(body.participants));
  ck('看不懂的种类不发', !createInput({ ...emptyDraft(), name: 'x', participants: [{ kind: 'admin', id: 'a' } as never] }, true)!.participants);
  ck('参与人和负责人互不影响(没选负责人就不带 owner)', body.owner === undefined && body.agent_owner === undefined);
  const none = createInput({ ...emptyDraft(), name: '示例任务' }, true)!;
  ck('不选参与人:createInput 不带字段', !('participants' in none));
  ck('不选参与人:POST 体不带 participants(JSON 里没有这个键,旧 Hub 行为不变)', !('participants' in JSON.parse(JSON.stringify(createRequirementBody(cfg, none)))));
  const onlyAgent = createInput({ ...emptyDraft(), name: '示例任务', participants: [BOT] }, true)!;
  ck('只选了 Agent:照发 [{kind:"node",id}](owner 10-07 起参与人可以是 Agent)', JSON.stringify(onlyAgent.participants) === JSON.stringify([BOT]));
  const both = createRequirementBody(cfg, createInput({ ...emptyDraft(), name: '示例任务', owner: ME, participants: [AMY] }, true)!);
  ck('负责人 + 参与人一起发', JSON.stringify(both.owner) === JSON.stringify(ME) && JSON.stringify(both.participants) === JSON.stringify([AMY]));
}

const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name: `示例任务${id}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-30T00:00:00Z', owner: null, participants: [], ...o,
});
const items: Requirement[] = [
  R('own', { owner: ME }),                              // 我负责
  R('join', { owner: AMY, participants: [ME] }),        // 我参与
  R('both', { owner: ME, participants: [ME, AMY] }),    // 都是
  R('other', { owner: AMY, participants: [AMY] }),      // 跟我无关
  R('old', { owner: undefined, participants: undefined }), // 旧 Hub 的行
];
const base: BoardFilter = { owners: [], priorities: [] };
const ids = (f: BoardFilter) => applyFilter(items, f).map(i => i.id).join();

console.log('# 左栏计数:我负责的 ≠ 我参与的');
{
  const mine = filterForScope(base, 'mine', 'u_me');
  const joined = filterForScope(base, 'participating', 'u_me');
  ck('我负责的 = 只看负责人', ids(mine) === 'own,both', ids(mine));
  ck('我参与的 = 只看参与人(负责人不限)', ids(joined) === 'join,both', ids(joined));
  ck('我参与的:计数 2', applyFilter(items, joined).length === 2);
  ck('旧 Hub 的行(没有 participants)不算参与', !applyFilter(items, joined).some(i => i.id === 'old'));
  ck('我参与的:负责人格清空', joined.owners.length === 0 && joined.participant === 'user:u_me');
  ck('点回「我负责的」清掉参与人', !filterForScope(joined, 'mine', 'u_me').participant);
  ck('点「全部」两格都清', (() => { const a = filterForScope(joined, 'all', 'u_me'); return !a.participant && a.owners.length === 0; })());
  ck('其余筛选(优先级/项目)保留', (() => { const f = filterForScope({ ...base, priorities: ['high'], project: 'p1' }, 'participating', 'u_me'); return f.priorities.join() === 'high' && f.project === 'p1'; })());
  ck('不知道我是谁:不筛成空', !filterForScope(base, 'participating', null).participant && ownersForScope('participating', 'u_me').length === 0);
  ck('高亮:我参与的', scopeOf(joined.owners, 'u_me', joined.participant) === 'participating');
  ck('高亮:我负责的仍是我负责的', scopeOf(mine.owners, 'u_me', mine.participant) === 'mine');
  ck('参与人 + 头部又筛了负责人:左栏一项都不亮', scopeOf(['user:u_amy'], 'u_me', 'user:u_me') === null);
  ck('参与人筛选算「有筛选」(出现「清除筛选」)', filterActive(joined) && !filterActive(base));
  ck('动态视图的「负责或参与」= 负责 ∪ 参与', items.filter(i => isMyCard(i, 'u_me')).map(i => i.id).join() === 'own,join,both');
}

console.log('# 文案');
{
  setLanguagePreference('zh');
  const zh = [t('tasks.participating'), t('act.mine')];
  setLanguagePreference('en');
  const en = [t('tasks.participating'), t('act.mine')];
  setLanguagePreference('zh');
  ck('左栏「我参与的」', zh[0] === '我参与的' && en[0] === 'Participating', zh.concat(en).join('|'));
  ck('动态视图写明「负责或参与」,不再叫「我的任务」', zh[1] === '负责或参与' && en[1] !== 'My tasks', zh[1]);
  ck('「我负责的」没改名', t('tasks.copy.193') === '我负责的');
}

console.log('# 接线');
{
  const side = src('./TaskFilterSidebar.tsx');
  const at = (s: string) => side.indexOf(s);
  ck('左栏:「我参与的」紧跟在「我负责的」下面', at("row('mine'") > 0 && at("row('participating'") > at("row('mine'") && at("row('participating'") < at("row('unassigned'"));
  ck('左栏点击走 filterForScope', side.includes('filterForScope(filter, scope, meId)'));
  const dlg = src('./TaskCreateDialog.tsx');
  const field = dlg.slice(dlg.indexOf('export function ParticipantsField'));
  const pick = field.slice(field.indexOf('<RequirementPeoplePicker'), field.indexOf('/>', field.indexOf('<RequirementPeoplePicker')));
  ck('新建对话框:参与人用和详情同一个选择器(mode=participants,人类 + Agent,不限 kinds)', pick.includes('mode="participants"') && !pick.includes('kinds='));
  ck('新建对话框:选的 Agent 不再被过滤掉', field.includes('onConfirm={sel => { onChange(sel); setOpen(false); }}'));
  ck('新建对话框:Agent 胶囊浅蓝底 +「· Agent」(手机和桌面两处)', (field.match(/r\.kind === 'node' \? colors\.tonalBg : colors\.subtleFill/g) ?? []).length === 2 && (field.match(/chip-agent-\$\{r\.id\}/g) ?? []).length === 2);
  ck('新建对话框:手机(sheet)和桌面是两套', dlg.includes('touch={sheet}') && dlg.includes('if (touch)'));
  const board = src('./RequirementBoard.tsx');
  ck('看板:旧 Hub 不显示参与人一栏', board.includes('participantsCapable={twoRoles || items.some(item => item.participants !== undefined)}'));
  ck('看板:在「我参与的」下新建默认带上我', board.includes("filter.participant?.startsWith('user:')"));
}

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
