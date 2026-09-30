// 任务短号 #N(Hub capabilities.requirement_seq):解析、显示、搜索匹配、排序、字段配置、以及只在新 Hub 上出现。
import { readFileSync } from 'node:fs';
import { idPrefix, matchesTaskId, seqCmp, seqFromHub, shortIdLabel, SEQ_CAPABILITY } from './task-short-id';
import { requirementFromHub } from './requirements-hub';
import { sortRows } from './task-board-model';
import { defaultFields, FIELD_IDS, parseFields } from './task-list-fields';
import type { Requirement } from './requirements-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// ── 解析 ──
ck('seqFromHub: positive integer', seqFromHub(42) === 42);
for (const bad of [0, -1, 1.5, '42', null, undefined, NaN, Number.MAX_SAFE_INTEGER + 1]) ck(`seqFromHub rejects ${String(bad)}`, seqFromHub(bad) === null);
const row = { id: 'req_0f3a9c2e-1111-2222-3333-444455556666', name: '卡', priority: 'normal', column: 'pool', createdAt: '2026-09-30T00:00:00Z' };
ck('new hub: seq parsed', requirementFromHub({ ...row, seq: 7 })!.seq === 7);
ck('new hub: unreadable seq → null, the card still loads', requirementFromHub({ ...row, seq: 'x' })!.seq === null);
ck('old hub: no seq key → field absent (undefined)', !('seq' in requirementFromHub(row)!));

// ── 显示 ──
ck('label #N', shortIdLabel({ seq: 42 }) === '#42');
ck('no label on old hub / null', shortIdLabel({}) === null && shortIdLabel({ seq: null }) === null);
ck('uuid prefix for old hub detail', idPrefix(row.id) === '0f3a9c2e');

// ── 搜索 ──
const card = { id: row.id, seq: 42 };
ck('#42 matches', matchesTaskId(card, '#42'));
ck('bare 42 matches', matchesTaskId(card, ' 42 '));
ck('#4 does not (exact, not prefix)', !matchesTaskId(card, '#4') && !matchesTaskId(card, '420'));
ck('full id matches (case-insensitive)', matchesTaskId(card, row.id.toUpperCase()));
ck('8+ char id prefix matches, with or without req_', matchesTaskId(card, '0f3a9c2e') && matchesTaskId(card, 'req_0f3a9c2e-11'));
ck('short fragments do not', !matchesTaskId(card, '0f3a') && !matchesTaskId(card, 'req_') && !matchesTaskId(card, ''));
ck('old hub card: numbers never match', !matchesTaskId({ id: row.id }, '#1'));

// ── 排序 ──
const mk = (id: string, seq?: number | null): Requirement => ({ id, name: id, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '', ...(seq === undefined ? {} : { seq }) });
const items = [mk('c', 3), mk('none', null), mk('a', 1), mk('b', 12)];
ck('sort by ID asc (numeric, not string)', sortRows(items, { key: 'seq', dir: 'asc' }).map(i => i.id).join() === 'a,c,b,none');
ck('sort by ID desc, missing still last', sortRows(items, { key: 'seq', dir: 'desc' }).map(i => i.id).join() === 'b,c,a,none');
ck('seqCmp: two missing are equal', seqCmp({}, { seq: null }, 1) === 0);

// ── 字段配置 ──
ck('ID is a column, first, visible by default', FIELD_IDS[0] === 'seq' && defaultFields()[0].visible);
const legacy = parseFields(JSON.stringify([{ id: 'title', visible: true }, { id: 'owner', visible: false }, { id: 'status', visible: true }]));
ck('saved prefs from before ID: ID goes back to its default spot (front), visible', legacy[0].id === 'seq' && legacy[0].visible);
ck('saved prefs keep their own relative order', legacy.map(f => f.id).filter(id => ['title', 'owner', 'status'].includes(id)).join() === 'title,owner,status' && !legacy.find(f => f.id === 'owner')!.visible);
const hidden = parseFields(JSON.stringify([{ id: 'title', visible: true }, { id: 'seq', visible: false }]));
ck('a hidden ID stays hidden and where the user put it', hidden[1].id === 'seq' && !hidden[1].visible);
ck('every field still present exactly once', legacy.length === FIELD_IDS.length && new Set(legacy.map(f => f.id)).size === FIELD_IDS.length);

// ── 只在新 Hub 上出现(旧 Hub 什么都不加) ──
const table = src('TaskListTable.tsx'), fields = src('TaskListFields.tsx'), board = src('RequirementBoard.tsx'), parts = src('TaskBoardParts.tsx'), chip = src('TaskIdChip.tsx'), detail = src('TaskDetailPanel.tsx');
ck('capability name', SEQ_CAPABILITY === 'requirement_seq');
ck('board reads the capability and passes it to the list', board.includes('st.capabilities.includes(SEQ_CAPABILITY)') && /seqCapable=\{seqCapable\}/.test(board));
ck('list hides the ID column without the capability', table.includes("(seqCapable || f.id !== 'seq')"));
ck('field config hides the ID row without the capability', fields.includes("(seqCapable || f.id !== 'seq')") && table.includes('seqCapable={seqCapable}'));
ck('ID column is sortable (not in the unsortable set)', /const sortable = id !== 'participants' && id !== 'issues';/.test(table));
ck('kanban / phone card shows #N only when the card has one', /\{shortIdLabel\(item\) \? <Text testID=\{`req-card-seq-/.test(parts));
ck('card #N is subtle: muted, right-aligned, does not shrink', /req-card-seq-[^\n]*metaMuted[^\n]*marginLeft: item\.due \? 0 : 'auto'[^\n]*flexShrink: 0/.test(parts));
ck('only one auto margin per meta row: the due chip keeps its own, #N follows it', /due: \{ marginLeft: 'auto'/.test(parts));
ck('detail header mounts the ID chip', detail.includes('<TaskIdChip item={item} pointer={pointer} />'));
ck('chip: tap copies #N, old hub copies the full id', chip.includes("copy(short ? 'short' : 'full')") && chip.includes("which === 'short' && short ? short : item.id"));
ck('chip: phone long-press = copy full id, gated to touch', chip.includes("onLongPress={!pointer ? () => { if (short) void copy('full'); } : undefined}"));
ck('chip: phone screen-reader action for the full id', chip.includes("accessibilityActions={!pointer && short ? [{ name: 'longpress', label: t('taskId.copyFull') }]"));
ck('chip: desktop gets a visible 复制完整 ID button, phone does not', chip.includes('{pointer && short ? (') && chip.includes('testID="req-detail-id-copy-full"'));
ck('chip: old hub shows the uuid prefix', chip.includes('short ?? idPrefix(item.id)'));

// ── 请求永远按主键,不按短号 ──
// 短号只在一个网络里唯一;owner 是跨很多网络的 Hub 管理员,按 #N 请求会撞 409 ambiguous_seq。app 的读写一律用 req_ 主键
// (全局唯一),#N 只用于显示、复制和本地搜索。
const hub = src('requirements-hub.ts');
const paths = hub.split('\n').filter(l => l.includes('/api/requirements/'));
ck('every per-task request path is built from the task id', paths.filter(l => l.includes('/api/requirements/${')).length >= 3 && paths.filter(l => l.includes('/api/requirements/${')).every(l => /\/api\/requirements\/\$\{encodeURIComponent\(id\)\}/.test(l)));
ck('no request path uses seq or an encoded #', !/%23|seq/.test(paths.join('\n')));
ck('the list request is network-scoped', hub.includes("scoped(cfg, '/api/requirements')"));

console.log(`${p}/${t} passed`); if (p !== t) process.exit(1);
