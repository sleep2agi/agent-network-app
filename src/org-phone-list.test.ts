// admin 2026-11-17「这个里面真的是有点太丑了……要有那种很舒适的感觉」—— 手机「组织」页每行的数据与布局约束。
import { readFileSync } from 'node:fs';
import { phoneDeptFacts } from './org-phone-list';
import type { AgentOrgData, PlacedAgent } from './agent-org-model';

let pass = 0;
const fails: string[] = [];
const ck = (name: string, ok: boolean) => { if (ok) pass += 1; else fails.push(name); };

const now = new Date().toISOString();
const old = new Date(Date.now() - 30 * 86400_000).toISOString();
const agent = (alias: string, dept: string | null, running: boolean): PlacedAgent => ({
  nodeId: `n_${alias}`, alias, ownerUserId: null, ownerName: null, sourceDepartmentId: dept, departmentId: dept, demo: false,
  updatedAt: running ? now : old, lifecycleState: running ? 'active' : 'stopped',
} as PlacedAgent);
const data = { departments: [
  { id: 'root', name: '研发', parent_id: null },
  { id: 'child', name: '前端', parent_id: 'root' },
] } as unknown as AgentOrgData;
const placed = [
  agent('zeta', 'root', false), agent('alpha', 'root', true), agent('beta', 'child', true),
  agent('gamma', 'child', false), agent('delta', null, false),
];

const root = phoneDeptFacts(placed, data, 'root');
ck('department counts include sub-departments', root.count === 4);
ck('running counts only active, recently seen agents', root.running === 2);
ck('avatar stack shows running agents first, at most 3', root.avatars.length === 3 && root.avatars[0] === 'alpha' && root.avatars[1] === 'beta');
const child = phoneDeptFacts(placed, data, 'child');
ck('child department counts only its own subtree', child.count === 2 && child.running === 1);
const none = phoneDeptFacts(placed, data, null);
ck('未归属 counts agents without a department', none.count === 1 && none.avatars[0] === 'delta');
ck('empty department has no avatars', phoneDeptFacts([], data, 'root').avatars.length === 0);

const screen = readFileSync(new URL('./AgentOrgScreen.tsx', import.meta.url), 'utf8');
ck('phone page has no outer card frame', screen.includes("p.phone ? styles.workspacePhone : styles.workspace") && screen.includes('workspacePhone: {}'));
ck('phone page drops the summary toolbar and the settings-style chart row', screen.includes("{!p.fill && !p.phone ? <View style={styles.toolbar}") && !screen.includes('agent-org-phone-nav'));
ck('phone shows the chart as a card carrying the totals', screen.includes('<PhoneChartCard data={data} placed={placed}') && screen.includes("t('agentOrg.phone.chartSub'"));
const list = screen.slice(screen.indexOf('function PhoneDepartmentList'), screen.indexOf('function IconAction'));
ck('phone department rows: avatar stack + name + count/running line, no folder icon', list.includes('<AvatarStack aliases={f.avatars} />') && list.includes("t('agentOrg.phone.deptSub'") && !list.includes('folder-outline'));
ck('long-press only on touch (mouse press selects text)', (screen.match(/onLongPress=\{pointerUi\(\) \? undefined : p\.onMenu \?/g) ?? []).length === 2);
ck('avatar stack has a fixed width so names line up', screen.includes('phoneStack: { width: PHONE_STACK_WIDTH,') && screen.includes('size={PHONE_AVATAR} fixedSize'));
ck('phone hides the jargon info line', screen.includes('{data && !p.fill && !p.phone ? <View testID="agent-org-info"'));

// admin 2026-11-17 第二张截图（手机架构图）「这个现在也是很难看」：手机上的架构图不再是桌面海报。
const showcase = readFileSync(new URL('./OrgShowcase.tsx', import.meta.url), 'utf8');
ck('phone chart: no brand row / headline / avatar cloud, only the numbers', /\{c \? \(here \? <Text numberOfLines=\{1\} style=\{styles\.phoneHereTitle\}>/.test(showcase));
ck('phone chart: full-width department cards, no root pill or connector lines', showcase.includes('testID="org-showcase-phone-list"') && /org-showcase-phone-list[\s\S]*?stem=\{false\}/.test(showcase));
ck('phone chart: no card frame around the chart, hero is a flat row', showcase.includes('c ? styles.chartPhone : styles.chartCard') && showcase.includes("heroCompact: { padding: 0, gap: spacing.sm, backgroundColor: 'transparent', borderWidth: 0 }"));
ck('phone chart: crumbs only after drilling in; no footer', showcase.includes('{c && !here ? null : <View style={styles.chartHead}>') && showcase.includes('{c ? null : <View style={styles.footerRow} testID="org-showcase-footer">'));
ck('phone chart view hides the 调整结构 block', screen.includes("!p.fill && !(p.phone && view === 'chart') ? (\n        <DemoAdjust"));

console.log(`org-phone-list: ${pass}/${pass + fails.length}`);
if (fails.length) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
