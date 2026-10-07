// ck-style (self-executing; run by scripts/run-tests.mjs): 执行节点选择器不许静默丢掉在线的会话。
//
// 2026-09-29 owner(Windows 桌面端):定时任务 → 选择执行节点,标题写「搜索 273 个节点」,网络里 304 个会话,
// 自己那个在线的 claude-code 节点不在列表里;另一个**离线**的 claude-code 节点却在。量出来的规则:
//   - 选择器只列 hub 节点表(/api/nodes)里的行;claude-code-cli 节点的 MCP 通道旧版本不报 node_id,
//     hub 节点表就没有它们 ⇒ 在线也不见(那个离线的在,是因为它的 token 铸造时绑过 node_id);
//   - 标题数的是节点表的行数(273),列表按别名去重后只画 242 行 ⇒ 标题和列表对不上。
// 修法:节点表没有、但在线的会话列成灰的不可指派行,写明原因;离线的只计数,在底部说一句;
// 标题 = 列出来的行数。
//
// fixture 照生产的形状(全是占位名):/api/status?light=1 的会话**不带 node_id**、team 为空;
// 同一别名多行节点(旧行 + 新行);离线的一次性探针;runtime 为空的会话;同一别名两条会话。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 bun/node 提供。
import { readFileSync } from 'node:fs';
import type { HubNode, Session } from './api';
import {
  buildPickerSections, countPickerRows, fieldModel, hiddenOfflineText, pickerChoices, pickerNodes,
  REASON_OLD_NODE, REASON_UNREGISTERED, searchPlaceholder,
} from './node-picker-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

// ── fixture ────────────────────────────────────────────────────────────────
type NodeRow = HubNode & { team?: null };
const N = (node_id: string, alias: string, extra: Partial<NodeRow> = {}): NodeRow =>
  ({ node_id, alias, runtime: 'claude-sdk', lifecycle_state: 'active', updated_at: '2026-09-01 00:00:00', team: null, ...extra });
// light=1 的会话形状:alias / status / runtime / agent,没有 node_id。
const S = (alias: string, status: string, runtime: string | null = 'claude-code-cli', extra: Partial<Session> = {}): Session =>
  ({ alias, status, runtime, agent: runtime === 'claude-code-cli' ? 'claude-code' : runtime, ...extra } as Session);

const nodes: NodeRow[] = [
  N('n_a1', '甲组-一号'),
  N('n_a2', '甲组-二号', { runtime: 'codex-sdk' }),
  // 绑过 node_id 的 claude-code 节点:有节点行,会话 node_id 为空 ⇒ 按别名接上
  N('n_cc_bound', '甲组-绑定', { runtime: null }),
  // 离线、但有节点行的 claude-code 节点(owner 截图里「在」的那个)
  N('n_cc_off', '甲组-遥测', { runtime: null }),
  // 同一别名三行:删除中的旧行、较旧的活行、最新的活行 ⇒ 只画一行,取最新的活行
  N('n_dup_old', '乙组-换号', { lifecycle_state: 'deleting', updated_at: '2026-09-20 00:00:00' }),
  N('n_dup_mid', '乙组-换号', { updated_at: '2026-08-01 00:00:00' }),
  N('n_dup_new', '乙组-换号', { updated_at: '2026-09-10 00:00:00' }),
  // 同一别名两行,都没有 lifecycle_state(旧 hub)⇒ 取 updated_at 新的
  N('n_twin_a', '乙组-双胞', { lifecycle_state: null, updated_at: '2026-09-02 00:00:00' }),
  N('n_twin_b', '乙组-双胞', { lifecycle_state: null, updated_at: '2026-09-03 00:00:00' }),
  // 有节点行、没有会话 ⇒ 离线,仍可选(还能排队)
  N('n_quiet', '丙组-静默'),
];
const sessions: Session[] = [
  S('甲组-一号', 'idle', 'claude-sdk'),
  S('甲组-二号', 'working', 'codex-sdk'),
  S('甲组-绑定', 'idle'),
  S('甲组-遥测', 'offline'),
  S('乙组-换号', 'idle', 'claude-sdk'),
  S('乙组-双胞', 'offline', 'claude-sdk'),
  // ↓ 节点表里没有的会话
  S('甲组-负责人', 'idle'),                   // 在线 claude-code-cli ⇒ 灰行,「版本过旧」
  S('甲组-工程师', 'working'),                // 在线 claude-code-cli(忙)⇒ 灰行
  S('丙组-无运行时', 'idle', null),            // 在线、runtime 空 ⇒ 灰行,「未登记」
  S('丙组-报错', 'error', 'codex-sdk'),        // error 也是在线
  S('丁组-探针1', 'offline', 'claude-agent-sdk'),
  S('丁组-探针2', 'offline', 'codex-sdk'),
  S('丁组-退役', 'offline'),
  S('丁组-空状态', ''),                         // 没有状态 ⇒ 当离线
  // 同一别名两条会话:旧的离线行 + 新的在线行 ⇒ 按在线算
  S('戊组-重连', 'offline'),
  S('戊组-重连', 'idle'),
];

const c = pickerChoices(nodes, sessions);
const by = (a: string) => c.nodes.filter(n => n.alias === a);
const one = (a: string) => by(a)[0];
const sectionsPlain = buildPickerSections(c.nodes, {});

// ① 不丢在线的会话 ────────────────────────────────────────────────────────────
const listed = new Set(c.nodes.map(n => n.alias));
const onlineAliases = [...new Set(sessions.filter(s => s.status && s.status !== 'offline').map(s => s.alias))];
const missingOnline = onlineAliases.filter(a => !listed.has(a));
ck('invariant: every online session is listed', missingOnline.length === 0, missingOnline.join());
ck('invariant (collect): the fixture actually has online sessions without a node row', onlineAliases.filter(a => !nodes.some(n => n.alias === a)).length === 5);
const allAliases = new Set(sessions.map(s => s.alias));
const accounted = [...allAliases].filter(a => listed.has(a)).length + c.hiddenOffline;
ck('invariant: every session alias is either listed or counted as hidden', accounted === allAliases.size, `${accounted} vs ${allAliases.size}`);

// ② 标题 = 列出来的行 ───────────────────────────────────────────────────────
ck('count: one row per alias', c.nodes.length === listed.size);
ck('count: header count == rows drawn (no query / fold / recents)', countPickerRows(sectionsPlain) === c.nodes.length, `${countPickerRows(sectionsPlain)} vs ${c.nodes.length}`);
ck('count: 7 registered aliases + 5 unassignable = 12 rows', c.nodes.length === 12, String(c.nodes.length));
ck('count: offline sessions without a node row are counted, not listed (4)', c.hiddenOffline === 4, String(c.hiddenOffline));
ck('count: placeholder uses the listed count', searchPlaceholder(c.nodes.length) === '搜索 12 个节点(支持拼音)');
ck('footer text names the hidden count', hiddenOfflineText(4) === '另有 4 个离线会话没有登记节点，无法指派');
ck('footer text is empty when nothing is hidden', hiddenOfflineText(0) === '');

// ③ 可指派 / 不可指派 ──────────────────────────────────────────────────────
ck('assignable: registered claude-code node whose session has no node_id joins by alias (online)', one('甲组-绑定').assignable && one('甲组-绑定').online && one('甲组-绑定').node_id === 'n_cc_bound');
ck('assignable: registered but offline claude-code node stays assignable, offline', one('甲组-遥测').assignable && !one('甲组-遥测').online);
ck('assignable: registered node without any session is offline but assignable', one('丙组-静默').assignable && !one('丙组-静默').online);
ck('unassignable: online claude-code-cli session without a node row → greyed with the upgrade reason', !one('甲组-负责人').assignable && one('甲组-负责人').reason === REASON_OLD_NODE && one('甲组-负责人').online);
ck('unassignable: busy claude-code-cli session too', !one('甲组-工程师').assignable && one('甲组-工程师').reason === REASON_OLD_NODE && one('甲组-工程师').status === 'working');
ck('unassignable: runtime-less session gets the generic reason', !one('丙组-无运行时').assignable && one('丙组-无运行时').reason === REASON_UNREGISTERED);
ck('unassignable: an error session counts as online and is listed', !one('丙组-报错').assignable && one('丙组-报错').online);
ck('unassignable: rows carry no node_id (nothing to submit)', c.nodes.filter(n => !n.assignable).every(n => n.node_id === ''));
ck('assignable rows never carry a reason', c.nodes.filter(n => n.assignable).every(n => n.reason === undefined));
ck('reason text is the owner-specified wording', REASON_OLD_NODE === '节点版本过旧，无法指派，升级后可选');
ck('hidden: offline probes / retired / status-less sessions are not rows', ['丁组-探针1', '丁组-探针2', '丁组-退役', '丁组-空状态'].every(a => !listed.has(a)));
ck('duplicate sessions: an online row wins over a stale offline one', one('戊组-重连').online && by('戊组-重连').length === 1);

// ④ 同一别名多行节点 ───────────────────────────────────────────────────────
ck('duplicate node rows: one row per alias', by('乙组-换号').length === 1 && by('乙组-双胞').length === 1);
ck('duplicate node rows: an active row beats a newer deleting one', one('乙组-换号').node_id === 'n_dup_new', one('乙组-换号').node_id);
ck('duplicate node rows: without lifecycle, the latest updated_at wins', one('乙组-双胞').node_id === 'n_twin_b', one('乙组-双胞').node_id);
ck('duplicate node rows: order of rows does not change the pick', pickerNodes([...nodes].reverse(), sessions).find(n => n.alias === '乙组-换号')!.node_id === 'n_dup_new');

// ⑤ 分组 / 最近使用 / 搜索 ─────────────────────────────────────────────────
const groupOf = (a: string) => sectionsPlain.find(s => s.data.some(n => n.alias === a))?.title;
ck('grouping: unassignable rows sit in their team group like everyone else', groupOf('甲组-负责人') === groupOf('甲组-一号'));
const withRecents = buildPickerSections(c.nodes, { recents: ['', 'n_a1'] });
ck('recents: an empty id never pulls an unassignable row into 最近使用', withRecents[0].data.map(n => n.alias).join() === '甲组-一号', withRecents[0].data.map(n => n.alias).join());
const found = buildPickerSections(c.nodes, { query: '负责人' }).flatMap(s => s.data);
ck('search: unassignable rows are searchable (so the user can see why)', found.length === 1 && !found[0].assignable);
ck('field model still renders a registered choice', fieldModel(one('甲组-一号')).title === '甲组-一号');

// ⑥ 空输入 / 旧 hub ───────────────────────────────────────────────────────
ck('empty: no nodes, no sessions ⇒ nothing, nothing hidden', (() => { const e = pickerChoices([], []); return e.nodes.length === 0 && e.hiddenOffline === 0; })());
ck('empty: sessions only ⇒ online ones listed unassignable', (() => { const e = pickerChoices([], [S('x', 'idle'), S('y', 'offline')]); return e.nodes.length === 1 && !e.nodes[0].assignable && e.hiddenOffline === 1; })());
ck('garbage session rows are skipped', pickerChoices([], [null as unknown as Session, { alias: '' } as Session, { status: 'idle' } as Session]).nodes.length === 0);

// ── 接线(读源码)────────────────────────────────────────────────────────
const srcDir = new URL('.', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, srcDir), 'utf8').replace(/\r\n?/g, '\n');
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const picker = strip(read('NodePicker.tsx'));
// 表单在 ScheduleEditor.tsx(定时任务页和节点页共用)。
const screen = strip(read('ScheduleEditor.tsx'));
ck('picker: unassignable rows are disabled Pressables', /disabled=\{!assignable\}/.test(picker) && /accessibilityState=\{\{ selected, disabled: !assignable \}\}/.test(picker));
ck('picker: ✓ only on assignable rows (empty node_id vs empty selection)', /const selected = assignable && item\.node_id === selectedId;/.test(picker));
ck('picker: tap on an unassignable row is ignored', /const pick = useCallback\(\(n: PickerNode\) => \{ if \(n\.assignable\) onSelect\(n\); \}/.test(picker));
ck('picker: the reason replaces the runtime hint', /!assignable && item\.reason \? <Text dense testID=\{`picker-\$\{id\}-reason`\}/.test(picker));
ck('picker: header placeholder counts the listed rows', /placeholder=\{searchPlaceholder\(nodes\.length\)\}/.test(picker) && !/搜索 \$\{nodes\.length\}/.test(picker));
ck('picker: footer names the hidden offline count (not while searching)', /ListFooterComponent=\{!searching && hiddenOffline > 0 \?/.test(picker) && /hiddenOfflineText\(hiddenOffline\)/.test(picker));
ck('picker: row keys do not collide for id-less rows', /keyExtractor=\{\(n, i\) => `\$\{n\.node_id \|\| `alias:\$\{n\.alias\}`\}:\$\{i\}`\}/.test(picker));
ck('screen: chosen target must be assignable', /const chosen = choices\.nodes\.find\(n => n\.assignable && n\.node_id === target\)/.test(screen));
ck('screen: onSelect refuses an unassignable row', /onSelect=\{n => \{ if \(!n\.assignable\) return;/.test(screen));

console.log(`\n${p}/${t} passed`);
if (p !== t) (globalThis as any).process.exit(1);
