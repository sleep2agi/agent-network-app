// 任务状态「废弃」(abandoned,看板 #724;Hub agent-network#2490)的 App 侧。
// 1) 需求接口每个请求都声明 X-Anet-Accept-Columns: abandoned(没声明 Hub 把它投影成 done);
// 2) 状态胶囊 / 选择器:灰色、标题划线;旧 Hub(capabilities 无 column_abandoned)不给这个选项;
// 3) 看板「废弃」列默认收起;列表「全部」默认不含废弃,有开关;各处计数同源。
import { readFileSync } from 'node:fs';
import {
  fetchRequirementStats, getRequirementOnHub, listRequirementsFull, listRequirementChanges, moveRequirementOnHub,
  probeAgentOwnerSupport, requirementFromHub, setChecklistItemOnHub, setRequirementArchivedOnHub, updateRequirementOnHub,
  createRequirementOnHub, listProjects, __resetRequirementsConditionalCache,
} from './requirements-hub';
import { listRequirementPeople, saveRequirementAssignments } from './requirement-people-api';
import { fetchTagCatalog } from './task-tag-catalog';
import { fetchDepartmentRequirements } from './org-api';
import { ABANDONED_CAPABILITY, ACCEPT_COLUMNS_HEADER, isClosedColumn, statusChoices, supportsAbandoned } from './requirement-columns';
import { abandonedShown, applyFilter, boardColumns, EMPTY_FILTER, hiddenAbandonedCount, HIDE_DONE, matchesFilter, neighbourColumn, projectCounts, subProgress } from './task-board-model';
import { recountChildren } from './board-sync';
import { isOverdue } from './due-marker';
import { REQ_COLUMN_LABEL, type Requirement } from './requirements-model';
import { setLanguagePreference, t as tr } from './i18n';
import './i18n-tasks';
import { taskText } from './i18n-tasks';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const card = (id: string, column: Requirement['column'], extra: Partial<Requirement> = {}): Requirement =>
  ({ id, name: id, priority: 'normal', assignee: '', due: '', column, createdAt: '2026-10-01T00:00:00.000Z', ...extra });

// ── 1. 声明头:所有需求接口的读和写 ──
{
  const cfg = { serverUrl: 'http://hub.local', token: 't', username: 'u', networkId: 'net', profileId: 'p' };
  const seen: { url: string; method: string; accept: string | null }[] = [];
  const row = { id: 'r1', name: 'x', column: 'abandoned', priority: 'normal', due: '', createdAt: '' };
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers as HeadersInit | undefined);
    seen.push({ url: String(url), method: init.method ?? 'GET', accept: h.get(ACCEPT_COLUMNS_HEADER) });
    const u = String(url);
    const body = u.includes('__capability_probe__') ? { error: 'requirement_not_found' }
      : u.includes('/projects') ? { projects: [] }
        : u.includes('/people') ? { people: [] }
          : u.includes('/tags') ? { tags: [] }
            : u.includes('/stats') ? { totals: {} }
              : { requirement: { ...row, archived: init.body ? JSON.parse(String(init.body)).archived : undefined }, requirements: [row], capabilities: [ABANDONED_CAPABILITY], owner: null, participants: [] };
    return new Response(JSON.stringify(body), { status: u.includes('__capability_probe__') ? 404 : 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    __resetRequirementsConditionalCache();
    const listed = await listRequirementsFull(cfg);
    await listRequirementChanges(cfg, '2026-10-01T00:00:00Z');
    await getRequirementOnHub(cfg, 'r1');
    await fetchRequirementStats(cfg, { from: null, tz: 'Asia/Shanghai', days: 7, recent: 5 });
    await createRequirementOnHub(cfg, { name: 'x', priority: 'normal', assignee: '', due: '' });
    await moveRequirementOnHub(cfg, 'r1', 'abandoned');
    await updateRequirementOnHub(cfg, 'r1', { name: 'x' }).catch(() => null);
    await setRequirementArchivedOnHub(cfg, 'r1', true).catch(() => null);
    await setChecklistItemOnHub(cfg, 'r1', 'c1', true).catch(() => null);
    await probeAgentOwnerSupport(cfg);
    await listProjects(cfg).catch(() => null);
    await listRequirementPeople(cfg).catch(() => null);
    await saveRequirementAssignments(cfg, 'r1', { owner: null }).catch(() => null);
    await fetchTagCatalog(cfg).catch(() => null);
    await fetchDepartmentRequirements(cfg, 'net', 'd1').catch(() => null);
    const req = seen.filter(s => s.url.includes('/api/requirements'));
    ck('需求接口请求都发到了(读 + 写 ≥ 15 个)', req.length >= 15, String(req.length));
    const missing = req.filter(s => s.accept !== 'abandoned');
    ck('每个需求接口请求都带 X-Anet-Accept-Columns: abandoned', missing.length === 0, missing.map(m => `${m.method} ${m.url}`).join(' | '));
    ck('写(POST / PATCH)也带', req.some(s => s.method === 'PATCH' && s.accept === 'abandoned') && req.some(s => s.method === 'POST' && s.accept === 'abandoned'));
    ck('列表回来的 abandoned 原样读成「废弃」+ capability 带回', listed.rows[0]?.column === 'abandoned' && supportsAbandoned(listed.capabilities));
  } finally {
    globalThis.fetch = orig;
  }
}
{
  const callers = ['./requirements-hub.ts', './requirement-people-api.ts', './task-tag-catalog.ts', './TaskTags.tsx', './org-api.ts'];
  ck('需求接口的每个调用文件都并上 ACCEPT_COLUMNS_HEADERS', callers.every(f => /\.\.\.(\(.*\? )?ACCEPT_COLUMNS_HEADERS/.test(src(f))));
  const hub = src('./requirements-hub.ts');
  const fetches = hub.split('\n').filter(l => l.includes('headers: { Authorization'));
  ck('requirements-hub.ts 里没有漏带声明头的 headers', fetches.length >= 5 && fetches.every(h => h.includes('ACCEPT_COLUMNS_HEADERS')), String(fetches.length));
}

// ── 2. 读、胶囊、选择器、旧 Hub ──
ck('requirementFromHub 认识 abandoned;不认识的值仍当 pool', requirementFromHub({ id: 'a', name: 'x', column: 'abandoned' })?.column === 'abandoned' && requirementFromHub({ id: 'a', name: 'x', column: 'zzz' })?.column === 'pool');
ck('新 Hub:选项含「废弃」(放最后)', statusChoices(supportsAbandoned(['stats', ABANDONED_CAPABILITY])).join() === 'pool,doing,done,abandoned');
ck('旧 Hub(≤ .112,capabilities 无 column_abandoned):不给「废弃」', statusChoices(supportsAbandoned(['stats', 'events'])).join() === 'pool,doing,done' && !supportsAbandoned([]) && !supportsAbandoned(null));
ck('关闭态:完成 + 废弃(划线、不算开着)', isClosedColumn('done') && isClosedColumn('abandoned') && !isClosedColumn('doing') && !isClosedColumn('pool'));
ck('废弃不逾期', !isOverdue({ due: '2020-01-01', column: 'abandoned' }, { today: '2026-10-07' }) && isOverdue({ due: '2020-01-01', column: 'pool' }, { today: '2026-10-07' }));
{
  const parts = src('./TaskBoardParts.tsx');
  ck('胶囊颜色:废弃 = 灰(textMuted)', /abandoned: \(\) => colors\.textMuted/.test(parts));
  const board = src('./RequirementBoard.tsx');
  ck('卡片 / 行标题:关闭态都划线', (board.match(/isClosedColumn\(item\.column\) && s\.cardDone/g) ?? []).length === 2 && src('./TaskListTable.tsx').includes('isClosedColumn(item.column) && s.cardDone'));
  const pickers = ['./TaskCardMenu.tsx', './TaskListCellEditor.tsx', './TaskDetailPanel.tsx'];
  ck('右键菜单 / 列表单元格 / 详情:状态选项都按 Hub 能力取(statusChoices)', pickers.every(f => src(f).includes('statusChoices(') && src(f).includes('supportsAbandoned(st.capabilities)') && !/REQ_COLUMNS\.map/.test(src(f))));
  ck('看板:快捷改状态 / 批量改状态 / 状态筛选都用 statusOptions', !/REQ_COLUMNS\.map/.test(board) && (board.match(/statusOptions\.map/g) ?? []).length === 3);
  ck('键盘换列只在 需求池 / 进行中 / 完成 之间走,不会写出废弃', neighbourColumn('done', 1) === null && neighbourColumn('abandoned', -1) === null && neighbourColumn('pool', 1) === 'doing');
}

// ── 3. 默认隐藏、展开、计数同源 ──
{
  const items = [card('p', 'pool'), card('d', 'doing'), card('x', 'done'), card('a1', 'abandoned', { projectId: 'P' }), card('a2', 'abandoned')];
  ck('「全部」(无状态筛选)默认不含废弃', applyFilter(items, EMPTY_FILTER).map(i => i.id).join() === 'p,d,x');
  ck('打开「显示已废弃」→ 含废弃', applyFilter(items, { ...EMPTY_FILTER, showAbandoned: true }).length === 5);
  ck('状态筛选显式选「废弃」→ 只看废弃', applyFilter(items, { ...EMPTY_FILTER, statuses: ['abandoned'] }).map(i => i.id).join() === 'a1,a2' && abandonedShown({ statuses: ['abandoned'] }));
  ck('「隐藏已完成」= 需求池 + 进行中(不含废弃)', HIDE_DONE.join() === 'pool,doing');
  ck('看板默认没有废弃列', boardColumns(items, EMPTY_FILTER).map(c => c.column).join() === 'pool,doing,done');
  ck('展开后废弃列在最后', boardColumns(items, { ...EMPTY_FILTER, showAbandoned: true }).map(c => c.column).join() === 'pool,doing,done,abandoned');
  const hidden = hiddenAbandonedCount(items, EMPTY_FILTER);
  const shownCol = boardColumns(items, { ...EMPTY_FILTER, showAbandoned: true }).find(c => c.column === 'abandoned')!.items.length;
  ck('收起时的数字 = 展开后那一列的张数', hidden === 2 && shownCol === 2);
  ck('收起数跟着其它筛选走(项目)', hiddenAbandonedCount(items, { ...EMPTY_FILTER, project: 'P' }) === 1);
  ck('已经展开 / 选了别的状态时不再提示', hiddenAbandonedCount(items, { ...EMPTY_FILTER, showAbandoned: true }) === 0 && hiddenAbandonedCount(items, { ...EMPTY_FILTER, statuses: ['doing'] }) === 0);
  const pc = projectCounts(items, EMPTY_FILTER);
  ck('左栏项目计数与列表同源(默认不含废弃)', [...pc.values()].reduce((a, b) => a + b, 0) === applyFilter(items, EMPTY_FILTER).length);
  ck('matchesFilter:废弃 + 别的状态筛选不冲突', !matchesFilter(card('z', 'abandoned'), { ...EMPTY_FILTER, statuses: ['done'] }) && matchesFilter(card('z', 'abandoned'), { ...EMPTY_FILTER, statuses: ['done', 'abandoned'] }));
  const kids = [card('parent', 'doing', { children: undefined }), card('k1', 'done', { parentId: 'parent' }), card('k2', 'abandoned', { parentId: 'parent' }), card('k3', 'pool', { parentId: 'parent' })];
  ck('子需求进度不计废弃的(与 Hub 同口径)', JSON.stringify(subProgress(kids, kids[0])) === '{"total":2,"done":1}');
  const re = recountChildren([{ ...kids[0], children: { total: 9, done: 9 } }, ...kids.slice(1)]);
  ck('增量后重算的子需求计数也不计废弃', JSON.stringify(re[0].children) === '{"total":2,"done":1}');
}
{
  const board = src('./RequirementBoard.tsx');
  ck('桌面:收起的废弃列是一条可点开的窄栏', board.includes('testID="req-col-abandoned-collapsed"') && board.includes('onPress={() => setShowAbandoned(true)}'));
  ck('手机:分页胶囊末尾一格「废弃 N」,点开并翻到那一页', board.includes('testID="req-page-tab-abandoned-collapsed"') && board.includes('goTo(columns.length)'));
  ck('展开的废弃列头上有收起按钮', board.includes('testID="req-abandoned-collapse"'));
  ck('列表底部有显示 / 隐藏开关(桌面表格和手机分组都有)', board.includes('testID="req-abandoned-toggle"') && (board.match(/\{abandonedToggle\(\)\}/g) ?? []).length === 2);
  ck('状态筛选菜单里有「显示已废弃」,只在新 Hub 上画', board.includes("row('status-show-abandoned'") && board.includes('showAbandoned={abandonedOk ? showAbandoned : null}'));
  ck('旧 Hub:折叠列 / 胶囊 / 开关都以 abandonedOk 为前提', (board.match(/abandonedOk && /g) ?? []).length >= 3);
  ck('左栏人 / 节点计数跟着废弃的显示状态走', src('./TaskFilterSidebar.tsx').includes('showAbandoned: abandonedShown(filter)'));
  ck('废弃列不给「添加任务」', board.includes("{col.column === 'abandoned' ? null : quick ? ("));
}

// ── 4. 中英文 ──
{
  setLanguagePreference('zh');
  const zh = [taskText(REQ_COLUMN_LABEL.abandoned), tr('abandoned.show'), tr('abandoned.showList', { n: 3 }), tr('act.abandoned'), tr('dept.col.abandoned')];
  setLanguagePreference('en');
  const en = [taskText(REQ_COLUMN_LABEL.abandoned), tr('abandoned.show'), tr('abandoned.showList', { n: 3 }), tr('act.abandoned')];
  setLanguagePreference('system');
  ck('中文:废弃 / 显示已废弃 / 计数', zh[0] === '废弃' && zh[1] === '显示已废弃' && zh[2].includes('3') && zh[3] === '废弃了任务', zh.join('|'));
  ck('English: Abandoned / Show abandoned (3)', en[0] === 'Abandoned' && en[1] === 'Show abandoned' && en[2] === 'Show abandoned (3)' && en[3] === 'abandoned the task', en.join('|'));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
