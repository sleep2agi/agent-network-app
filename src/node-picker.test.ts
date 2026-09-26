// ck-style (self-executing; run by scripts/run-tests.mjs): 定时任务「执行节点」选择器 + 表单安全区。
//
// 2026-09-26 owner(展开的折叠屏):「这个执行节点的展示实在是太丑了」—— ~300 个 agent 铺成换行胶囊;
// 同一屏「取消 / 新建定时任务 / 保存」画在 Android 状态栏底下。
//
// 三层,分开钉:
//   ① 纯逻辑(node-picker-model.ts / modal-safe-area.ts):搜索(含拼音)、分组、最近使用、离线排序、选中;
//   ② 接线(读源码):表单用一行 + 选择器,旧的胶囊墙没了,选择器用 SectionList 且有 onRequestClose;
//   ③ 取集 + 判据:定时任务相关的每个 <Modal> 都有真的 onRequestClose(路径统一成 POSIX 再比)。
// 所有别名都是占位名,不含真实节点。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 bun/node 提供。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { HubNode, Session } from './api';
import { buildSections } from './agents-list';
import { __setPinyinProvider, pinyinMatch } from './lib/pinyin';
import {
  buildPickerSections, countPickerRows, emptySearchText, fieldModel, loadRecents, parseRecents, pickerAutoFocus,
  pickerDialogSize, pickerNodes, pickerPresentation, RECENT_MAX, RECENT_TITLE, recentsPush, recentsStorageKey,
  rememberRecent, toggleFolded, type RecentsStore,
} from './node-picker-model';
import { modalSafePadding } from './modal-safe-area';
import { PINNED_TITLE } from './agents-list';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

// ── fixture: placeholder fleet ──────────────────────────────────────────────
const N = (node_id: string, alias: string, runtime = 'claude-code'): HubNode => ({ node_id, alias, runtime });
const S = (alias: string, status: string, node_id?: string): Session => ({ alias, status, node_id } as Session);
const nodes: HubNode[] = [
  N('n1', '测试甲'), N('n2', '测试乙', 'codex'), N('n3', '测试丙'),
  N('n4', '样例一'), N('n5', '样例二'),
  N('n6', 'tm-alpha'), N('n7', 'TM-beta'), N('n8', 'demo-x'),
  N('n9', '示范甲'),
];
const sessions: Session[] = [
  S('测试甲', 'offline', 'n1'), S('测试乙', 'working', 'n2'), S('测试丙', 'idle'), // 丙 没带 node_id → 按 alias 接
  S('样例一', 'error', 'n4'),
  S('tm-alpha', 'idle', 'n6'), S('TM-beta', 'offline', 'n7'),
  // n5 / n8 / n9 没有会话 ⇒ 离线
  S('孤儿会话', 'idle', 'nX'), // 有会话没注册的节点:不是合法目标
];
const items = pickerNodes(nodes, sessions);

// ① join ─────────────────────────────────────────────────────────────────────
ck('join: one item per registered node (a session without a node is not a target)', items.length === nodes.length && !items.some(i => i.alias === '孤儿会话'));
const by = (a: string) => items.find(i => i.alias === a)!;
ck('join: status by node_id', by('测试乙').status === 'working' && by('测试乙').online);
ck('join: session without node_id falls back to alias', by('测试丙').status === 'idle' && by('测试丙').online);
ck('join: no session ⇒ offline', by('样例二').status === 'offline' && !by('样例二').online && !by('demo-x').online);
ck('join: explicit offline stays offline', !by('测试甲').online);
ck('join: error is online (the dot is red, the row is not dimmed)', by('样例一').online);
ck('join: runtime carried for the hint', by('测试乙').runtime === 'codex');
ck('join: duplicate node rows collapse to one', pickerNodes([N('d', 'x'), N('d', 'x')]).length === 1);
ck('join: rows without node_id / alias are dropped', pickerNodes([{ node_id: '', alias: 'a' } as HubNode, { node_id: 'b', alias: '' } as HubNode]).length === 0);

// ② search matching ─────────────────────────────────────────────────────────
const aliasesFor = (q: string) => buildPickerSections(items, { query: q, match: pinyinMatch }).flatMap(s => s.data.map(n => n.alias)).sort();
ck("search 'tm' is case-insensitive substring", JSON.stringify(aliasesFor('tm')) === JSON.stringify(['TM-beta', 'tm-alpha'].sort()), aliasesFor('tm').join());
ck("search 'TM' finds the same rows", JSON.stringify(aliasesFor('TM')) === JSON.stringify(aliasesFor('tm')));
// Without the pinyin dictionary (the degraded path) substring matching alone must still be case-insensitive —
// with it loaded, pinyin-pro's lowercased Latin would hide a case-sensitive substring bug.
__setPinyinProvider(null, { disableAutoLoad: true });
ck("search 'TM' without the dictionary: substring alone is case-insensitive", JSON.stringify(aliasesFor('TM')) === JSON.stringify(['TM-beta', 'tm-alpha'].sort()), aliasesFor('TM').join());
__setPinyinProvider(null);
ck("search pinyin initials 'csy' → 测试乙", JSON.stringify(aliasesFor('csy')) === '["测试乙"]', aliasesFor('csy').join());
ck("search full pinyin 'yangli' → 样例一/二", JSON.stringify(aliasesFor('yangli')) === JSON.stringify(['样例一', '样例二'].sort()), aliasesFor('yangli').join());
ck("search CJK substring '测试' → three rows", aliasesFor('测试').length === 3);
ck('search with surrounding spaces is trimmed', JSON.stringify(aliasesFor('  csy ')) === '["测试乙"]');
ck('search miss → zero rows (UI then shows the empty text)', countPickerRows(buildPickerSections(items, { query: 'zzzz', match: pinyinMatch })) === 0);
ck('empty-search text is the owner-specified shape', emptySearchText(' abc ') === '没有找到 “abc”');

// ③ sections ────────────────────────────────────────────────────────────────
const plain = buildPickerSections(items, {});
const reference = buildSections(items.map(i => ({ alias: i.alias, status: i.status } as Session)), '');
ck('groups: same titles in the same order as the agent list (buildSections)', JSON.stringify(plain.map(s => s.title)) === JSON.stringify(reference.map(s => s.title)), plain.map(s => s.title).join());
ck('groups: online/total counts per group', plain.every(s => s.total === s.data.length && s.online === s.data.filter(n => n.online).length));
const ceshi = plain.find(s => s.title === '测试')!;
ck('offline sort: online rows before offline rows within a group', ceshi.data.map(n => n.online).join() === 'true,true,false', ceshi.data.map(n => n.alias).join());
ck('offline sort: every group is online-first', plain.every(s => { const f = s.data.findIndex(n => !n.online); return f < 0 || s.data.slice(f).every(n => !n.online); }));
ck('no recents ⇒ no 最近使用 section', !plain.some(s => s.title === RECENT_TITLE));

const withRecent = buildPickerSections(items, { recents: ['n5', 'gone', 'n2', 'n5', 'n1', 'n3', 'n4', 'n6'] });
ck('最近使用 is the first section', withRecent[0].title === RECENT_TITLE);
ck(`最近使用 keeps order, drops unknown ids and duplicates, caps at ${RECENT_MAX}`, withRecent[0].data.map(n => n.node_id).join() === 'n5,n2,n1,n3,n4', withRecent[0].data.map(n => n.node_id).join());
ck('最近使用 is not collapsible', !withRecent[0].collapsible);
ck('最近使用 copies (the row stays in its group too)', withRecent.find(s => s.title === '测试')!.data.some(n => n.node_id === 'n2'));
ck('section keys never collide (最近使用 vs a group)', new Set(withRecent.map(s => s.key)).size === withRecent.length);
const searchingRecent = buildPickerSections(items, { recents: ['n2'], query: 'yangli', match: pinyinMatch });
ck('searching hides 最近使用', !searchingRecent.some(s => s.title === RECENT_TITLE));

const pinnedSecs = buildPickerSections(items, { pinned: ['demo-x'], recents: ['n1'] });
ck('置顶 comes after 最近使用 and before the groups', pinnedSecs[0].title === RECENT_TITLE && pinnedSecs[1].title === PINNED_TITLE && pinnedSecs[1].data[0].alias === 'demo-x');
ck('置顶 moves the row out of its group (as in the agent list)', !pinnedSecs.slice(2).some(s => s.data.some(n => n.alias === 'demo-x')));

const folded = buildPickerSections(items, { collapsed: ['测试'] });
const f = folded.find(s => s.title === '测试')!;
ck('collapse: folded group keeps header + counts, no rows', f.collapsed && f.data.length === 0 && f.total === 3 && f.online === 2);
ck('collapse: other groups untouched', folded.filter(s => s.title !== '测试').every(s => !s.collapsed && s.data.length > 0));
const foldedSearch = buildPickerSections(items, { collapsed: ['测试'], query: 'cs', match: pinyinMatch });
ck('collapse: searching shows every match (no group folded, none collapsible)', foldedSearch.every(s => !s.collapsed && !s.collapsible) && foldedSearch.find(s => s.title === '测试')!.data.length === 3);
ck('toggleFolded adds then removes', JSON.stringify(toggleFolded(toggleFolded([], 'a'), 'a')) === '[]' && JSON.stringify(toggleFolded([], 'a')) === '["a"]');

// ④ selection + recents persistence ─────────────────────────────────────────
ck('recentsPush: selected goes to the top', recentsPush(['a', 'b', 'c'], 'c').join() === 'c,a,b');
ck('recentsPush: new id is prepended and capped', recentsPush(['a', 'b', 'c', 'd', 'e'], 'f').join() === 'f,a,b,c,d');
ck('recentsPush: empty id changes nothing', recentsPush(['a'], '').join() === 'a');
ck('parseRecents: array, deduped, non-strings dropped, capped', parseRecents('["a","a",3,"","b","c","d","e","f"]').join() === 'a,b,c,d,e');
ck('parseRecents: garbage → []', [null, undefined, '', '{', '{"a":1}', 42, 'null'].every(v => parseRecents(v).length === 0));
ck('storage key is per hub account (node ids are per hub)', recentsStorageKey({ profileId: 'p1' }) !== recentsStorageKey({ profileId: 'p2' }));

const mem = new Map<string, string>();
const memStore: RecentsStore = { get: async k => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); } };
const cfgA = { profileId: 'pa' };
let recents = await loadRecents(memStore, cfgA);
ck('persist: empty store → []', recents.length === 0);
recents = rememberRecent(memStore, cfgA, recents, 'n2');
recents = rememberRecent(memStore, cfgA, recents, 'n5');
recents = rememberRecent(memStore, cfgA, recents, 'n2');
await Promise.resolve();
ck('persist: returned list is the new order', recents.join() === 'n2,n5');
ck('persist: a reload sees the same list (round trip)', (await loadRecents(memStore, cfgA)).join() === 'n2,n5');
ck('persist: another account does not see it', (await loadRecents(memStore, { profileId: 'pb' })).length === 0);
const broken: RecentsStore = { get: async () => { throw new Error('io'); }, set: async () => { throw new Error('io'); } };
ck('persist: read failure → [] (the form still opens)', (await loadRecents(broken, cfgA)).length === 0);
ck('persist: write failure still updates the list for this session', rememberRecent(broken, cfgA, ['a'], 'b').join() === 'b,a');
const throwingSync: RecentsStore = { get: () => { throw new Error('sync'); }, set: () => { throw new Error('sync'); } };
ck('persist: a store that throws synchronously is contained', (await loadRecents(throwingSync, cfgA)).length === 0 && rememberRecent(throwingSync, cfgA, [], 'x').join() === 'x');

ck('field: nothing selected ⇒ placeholder 选择执行节点', fieldModel(null).placeholder && fieldModel(null).title === '选择执行节点');
ck('field: selected ⇒ name + runtime · group hint', (() => { const m = fieldModel(by('测试乙')); return !m.placeholder && m.title === '测试乙' && m.hint === 'codex · 测试' && m.online; })());
ck('field: editing a plan whose node is gone still shows its alias', (() => { const m = fieldModel(null, '旧节点'); return !m.placeholder && m.title === '旧节点' && !m.online; })());

// ⑤ presentation / focus / safe area ────────────────────────────────────────
ck('presentation: phone (390) ⇒ bottom sheet', pickerPresentation(390) === 'sheet');
ck('presentation: two-pane boundary 700 ⇒ dialog, 699 ⇒ sheet', pickerPresentation(700) === 'dialog' && pickerPresentation(699) === 'sheet');
ck('presentation: desktop 1200 ⇒ dialog', pickerPresentation(1200) === 'dialog');
ck('presentation: NaN width ⇒ sheet (never a dialog wider than the screen)', pickerPresentation(NaN) === 'sheet');
ck('dialog: 520×640 when it fits', JSON.stringify(pickerDialogSize(1200, 850)) === '{"width":520,"height":640}');
ck('dialog: shrinks with 24 margins in a small window', JSON.stringify(pickerDialogSize(560, 600)) === '{"width":512,"height":552}');
ck('focus: desktop web (fine pointer) auto-focuses', pickerAutoFocus('web', false));
ck('focus: touch web does not (no keyboard pop)', !pickerAutoFocus('web', true));
ck('focus: native android / ios never', !pickerAutoFocus('android', false) && !pickerAutoFocus('ios', false));

const INS = { top: 38, right: 0, bottom: 20, left: 44 };
ck('safe: android pageSheet (ignored on Android ⇒ full window) pads the status bar', modalSafePadding('android', 'pageSheet', INS, 38).paddingTop === 38);
ck('safe: android falls back to StatusBar.currentHeight when insets read 0', modalSafePadding('android', 'pageSheet', { top: 0 }, 31).paddingTop === 31);
ck('safe: android landscape pads the cutout side', modalSafePadding('android', 'pageSheet', INS, 38).paddingLeft === 44);
ck('safe: ios pageSheet top 0 (the sheet already sits below the status bar)', modalSafePadding('ios', 'pageSheet', { top: 47, bottom: 34 }, null).paddingTop === 0);
ck('safe: ios pageSheet still clears the home indicator', modalSafePadding('ios', 'pageSheet', { top: 47, bottom: 34 }, null).paddingBottom === 34);
ck('safe: ios fullScreen pads the notch', modalSafePadding('ios', 'fullScreen', { top: 47 }, null).paddingTop === 47);
ck('safe: overlay sheet top 0 but bottom padded', (() => { const o = modalSafePadding('android', 'overlay', INS, 38); return o.paddingTop === 0 && o.paddingBottom === 20; })());
ck('safe: web / Tauri 0 on every side', Object.values(modalSafePadding('web', 'pageSheet', INS, 38)).every(v => v === 0));

// ── ② wiring (source) ───────────────────────────────────────────────────────
const srcDir = new URL('.', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, srcDir), 'utf8').replace(/\r\n?/g, '\n');
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const screen = strip(read('ScheduledTasksScreen.tsx'));
const picker = strip(read('NodePicker.tsx'));
const form = screen.slice(screen.indexOf('function ScheduleFormModal('), screen.indexOf('function Label('));
ck('form: the chip wall is gone (no nodes.map in the form)', form.length > 0 && !/nodes\.map\(/.test(form) && !/nodeChoice/.test(screen));
ck('form: 执行节点 is one NodePickerField row that opens the picker', /<Label text="执行节点"><NodePickerField node=\{chosen\} fallbackAlias=\{fallbackAlias\} onPress=\{\(\) => setPickerOpen\(true\)\} \/><\/Label>/.test(form));
ck('form: picker gets the joined nodes, the selection, recents and pins', /<NodePickerSheet[\s\S]*?nodes=\{choices\}[\s\S]*?selectedId=\{target\}[\s\S]*?recents=\{recents\}[\s\S]*?pinned=\{pins\}/.test(form) && /const choices = useMemo\(\(\) => pickerNodes\(nodes, sessions\)/.test(form));
ck('form: select ⇒ set target, remember as recent, close the sheet', /onSelect=\{n => \{ setTarget\(n\.node_id\); setRecents\(rememberScheduleTarget\(cfg, recents, n\.node_id\)\); setPickerOpen\(false\); \}\}/.test(form));
ck('form: the picker only shows while the form does', /visible=\{visible && pickerOpen\}/.test(form));
ck('form: statuses + pins + recents are loaded when the form opens', /fetchStatus\(cfg\)/.test(form) && /loadChatPins\(cfg\)/.test(form) && /loadScheduleTargetRecents\(cfg\)/.test(form));
ck('form: root View carries the safe-area padding (#387 approach)', /const safe = modalSafePadding\(Platform\.OS, 'pageSheet', useSafeAreaInsets\(\), StatusBar\.currentHeight\)/.test(form) && /<View testID="schedule-form" style=\{\[styles\.modalRoot, safe\]\}>/.test(form));
ck('form: header lives inside the padded root', form.indexOf('style={[styles.modalRoot, safe]}') < form.indexOf('testID="schedule-form-header"'));
ck('form: Tauri title strips re-mounted inside the Modal (it covers the window)', /<MacTitleStrip \/>\s*<WinTitleBar \/>\s*<View testID="schedule-form-header"/.test(form));
ck('form: 取消 and 保存 get equal-width sides so the title is truly centred', /headerSide: \{ minWidth: 56/.test(screen) && /modalTitle: \{ flex: 1, textAlign: 'center'/.test(screen));
for (const name of ['CronEditModal', 'IntentsModal']) {
  const start = screen.indexOf(`function ${name}(`);
  const body = screen.slice(start, screen.indexOf('\nfunction ', start + 10));
  ck(`${name}: full-screen sheet gets the same safe-area padding`, start >= 0 && /modalSafePadding\(Platform\.OS, 'pageSheet'/.test(body) && /style=\{\[s\.modalRoot, safe\]\}/.test(body));
}
ck('picker: SectionList (virtualized) with a bounded render window', /<SectionList/.test(picker) && /initialNumToRender=\{\d+\}/.test(picker) && /windowSize=\{\d+\}/.test(picker));
ck('picker: typing is deferred (useDeferredValue) and the sections use the deferred query', /const deferred = useDeferredValue\(query\)/.test(picker) && /buildPickerSections\(nodes, \{ query: deferred/.test(picker));
ck('picker: pinyin matcher is the agent list one', /match: pinyinMatch/.test(picker) && /from '\.\/lib\/pinyin'/.test(picker));
ck('picker: auto-focus only through pickerAutoFocus (the TextInput prop is that value, never a literal)', /const autoFocus = visible && pickerAutoFocus\(Platform\.OS, coarsePointer\(\)\)/.test(picker) && /autoFocus=\{autoFocus\}/.test(picker) && !/autoFocus(=\{true\}|\s*\n|\s+\/?>)/.test(picker));
ck('picker: phone sheet vs dialog decided by pickerPresentation', /const mode = pickerPresentation\(width\)/.test(picker));
ck('picker: sheet height is PICKER_SHEET_RATIO of the window', /height: Math\.round\(height \* PICKER_SHEET_RATIO\)/.test(picker));
ck('picker: selected row draws a ✓', /selected \? <Ionicons[^>]*name="checkmark"/.test(picker));
ck('picker: offline rows are dimmed', /style=\{!st\.online \? s\.dim : null\}/.test(picker) && /dim: \{ opacity: 0\.45 \}/.test(picker));
ck('picker: empty search shows emptySearchText', /emptySearchText\(deferred\)/.test(picker));
ck('picker: backdrop tap closes it', /testID="node-picker-backdrop"[^>]*onPress=\{onClose\}/.test(picker));

// ── ③ every Modal answers back (collect, then judge) ───────────────────────
function modalTags(src: string): string[] {
  const out: string[] = [];
  const re = /<Modal\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0, i = m.index + 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}
const closeHandler = (tag: string): string | null => {
  const m = /onRequestClose=\{([^}]*)\}/.exec(tag);
  return m ? m[1].trim() : null;
};
// judge self-test with known positives / negatives
ck('judge self-test: a Modal without onRequestClose is flagged', closeHandler(modalTags('<Modal transparent visible={a > 1}>')[0]) === null);
ck('judge self-test: `>` inside braces does not end the tag', modalTags('<Modal visible={a > 1} onRequestClose={onClose}>')[0].endsWith('onRequestClose={onClose}>'));
// collect: all .tsx under src/, recursively, paths normalised to POSIX
const toPosix = (s: string) => s.replace(/\\/g, '/');
const srcPath = toPosix(decodeURIComponent(srcDir.pathname)).replace(/^\/([A-Za-z]:)/, '$1');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((e: string) => {
  const full = `${dir}/${e}`;
  if (statSync(full).isDirectory()) return e === 'node_modules' ? [] : walk(full);
  return e.endsWith('.tsx') ? [toPosix(full)] : [];
});
const files = walk(srcPath.replace(/\/$/, '')).map(f => f.slice(srcPath.replace(/\/$/, '').length + 1));
ck('collect: paths are POSIX', files.every(f => !f.includes('\\')));
ck('collect: picker + schedule screen are in the scanned set', files.includes('NodePicker.tsx') && files.includes('ScheduledTasksScreen.tsx'));
const scheduleTags = ['NodePicker.tsx', 'ScheduledTasksScreen.tsx'].flatMap(f => modalTags(read(f)).map(tag => ({ f, tag })));
ck(`collect: ${scheduleTags.length} Modals in the schedule surfaces (form, cancel, cron, intents, picker)`, scheduleTags.length === 5);
for (const { f, tag } of scheduleTags) {
  const h = closeHandler(tag);
  ck(`${f}: ${tag.slice(0, 60).replace(/\s+/g, ' ')}… has onRequestClose (Android back / Esc)`, !!h && !/^\(\)\s*=>\s*\{\s*\}$/.test(h));
}
ck('picker Modal: onRequestClose={onClose}', modalTags(read('NodePicker.tsx')).every(tag => closeHandler(tag) === 'onClose'));

console.log(`\n${p}/${t} passed`);
if (p !== t) (globalThis as any).process.exit(1);
