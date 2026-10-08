// board #745 —— 长会话分批加载(chat-history-pages.ts)。ck 风格,自执行。
// 一个按 hub 规则(server.ts /api/tasks:before / before_task_id,ORDER BY created_at DESC, task_id DESC,limit ≤ 200)
// 实现的假 hub,把首屏、往上翻、到起点、新消息、边界去重整个走一遍;再查 ChatScreen 的接线。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_PAGE, HUB_MAX_LIMIT, mergeNewestPage, mergeOlderPage, newestPageParams, olderPageHasMore, olderPageParams,
  type TaskPageParams,
} from './chat-history-pages';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };
const here = import.meta.dir;
const read = (rel: string) => readFileSync(join(here, rel), 'utf8').replace(/\r\n?/g, '\n');

type Row = { task_id: string; created_at: string; content: string };
const ts = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + Math.floor(i / 3) * 1000).toISOString().replace('T', ' ').slice(0, 19);
// 每 3 条同一秒:边界上 created_at 相同、只能靠 task_id 区分 —— 正是游标最容易漏 / 重的地方。
const mkRows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ task_id: `t${String(i).padStart(5, '0')}`, created_at: ts(i), content: `m${i}` }));

const fakeHub = (rows: Row[], opts: { ignoreBefore?: boolean } = {}) => {
  const calls: TaskPageParams[] = [];
  const get = (q: TaskPageParams): Row[] => {
    calls.push(q);
    const limit = Math.min(q.limit || 50, HUB_MAX_LIMIT);
    let out = rows.filter(r => r.task_id && q.to_name === 'A');
    if (q.before && !opts.ignoreBefore) {
      out = out.filter(r => q.before_task_id
        ? (r.created_at < q.before! || (r.created_at === q.before && r.task_id < q.before_task_id))
        : r.created_at < q.before!);
    }
    out.sort((a, b) => (a.created_at === b.created_at ? (a.task_id < b.task_id ? 1 : -1) : (a.created_at < b.created_at ? 1 : -1)));
    return out.slice(0, limit);
  };
  return { get, calls };
};

const ids = (rs: Row[]) => rs.map(r => r.task_id);
const newestFirst = (rs: Row[]) => [...rs].reverse();

console.log('首屏 = 最新一页');
{
  const all = mkRows(500);
  const hub = fakeHub(all);
  const q = newestPageParams('A', CHAT_PAGE);
  const page = hub.get(q);
  ck(`一页 ${CHAT_PAGE} 条(不是一次全拉)`, page.length === CHAT_PAGE && q.limit === CHAT_PAGE);
  ck('就是最新的那几条,newest-first', JSON.stringify(ids(page)) === JSON.stringify(ids(newestFirst(all).slice(0, CHAT_PAGE))));
  ck('首屏不带游标', q.before === undefined && q.before_task_id === undefined);
  ck('不要 stats 全表扫描(skip_stats)', q.skipStats === true);
  ck('轮询窗口超过 hub 上限时截在 200(不然 200 < limit 被当成到起点)', newestPageParams('A', 260).limit === HUB_MAX_LIMIT);
  ck('首屏一页大约 30 条', CHAT_PAGE >= 20 && CHAT_PAGE <= 50);
}

console.log('往上翻:游标、去重、到起点');
{
  const all = mkRows(500);
  const hub = fakeHub(all);
  let rows = mergeNewestPage([], hub.get(newestPageParams('A', CHAT_PAGE)), CHAT_PAGE);
  const q = olderPageParams('A', rows)!;
  const oldest = rows[rows.length - 1];
  ck('游标 = 已加载最老一条的 (created_at, task_id)', q.before === oldest.created_at && q.before_task_id === oldest.task_id);
  ck(`更早的一页也只要 ${CHAT_PAGE} 条`, q.limit === CHAT_PAGE);
  let more = true, pages = 1, sawOverlap = false;
  while (more && pages < 100) {
    const params = olderPageParams('A', rows)!;
    const page = hub.get(params);
    const r = mergeOlderPage(rows, page);
    if (r.added !== page.length) sawOverlap = true;
    rows = r.rows; more = olderPageHasMore(page.length, r.added); pages++;
  }
  ck('一页一页拉到起点后停(超过 hub 的 200 上限也拉得到)', !more && rows.length === 500);
  ck('全程没有一条重复', new Set(ids(rows)).size === rows.length);
  ck('全程没有漏一条,顺序 = hub 的 newest-first', JSON.stringify(ids(rows)) === JSON.stringify(ids(newestFirst(all))));
  ck(`请求数 = ⌈500 / ${CHAT_PAGE}⌉(+1 次空页)`, pages === Math.ceil(500 / CHAT_PAGE) + (500 % CHAT_PAGE === 0 ? 1 : 0));
  ck('每次请求都 ≤ 一页', hub.calls.every(c => c.limit <= CHAT_PAGE));
  ck('游标是严格「更早」,正常 hub 不会回同一条', !sawOverlap);

  // 边界去重:页与页重叠一条(例如旧 hub 不认 before_task_id、只按秒切)时不重复画。
  const a = newestFirst(all).slice(0, 30), b = newestFirst(all).slice(29, 59);
  const m = mergeOlderPage(a, b);
  ck('边界上重叠的那条只留一份', m.rows.length === 59 && m.added === 29 && new Set(ids(m.rows)).size === 59);
  ck('不满一页 ⇒ 到起点', !olderPageHasMore(12, 12));
  ck('满一页但一条新的都没有 ⇒ 也停(不认 before 的老 hub 不会死循环)', !olderPageHasMore(CHAT_PAGE, 0));
  ck('满一页且有新的 ⇒ 还有更早的', olderPageHasMore(CHAT_PAGE, CHAT_PAGE));
  ck('没有可作游标的行 ⇒ 不发请求', olderPageParams('A', []) === null);

  const old = fakeHub(all, { ignoreBefore: true });
  let r2 = mergeNewestPage([], old.get(newestPageParams('A', CHAT_PAGE)), CHAT_PAGE);
  const pg = old.get(olderPageParams('A', r2)!);
  const mm = mergeOlderPage(r2, pg);
  ck('老 hub 原样回最新一页 ⇒ 没加任何行、停止', mm.added === 0 && !olderPageHasMore(pg.length, mm.added));
}

console.log('短会话 / 新消息 / 轮询');
{
  const short = mkRows(12);
  const page = fakeHub(short).get(newestPageParams('A', CHAT_PAGE));
  ck('不满一页的会话:首屏就是全部', mergeNewestPage([], page, CHAT_PAGE).length === 12);

  const all = mkRows(200);
  const hub = fakeHub(all);
  let rows = mergeNewestPage([], hub.get(newestPageParams('A', CHAT_PAGE)), CHAT_PAGE);
  rows = mergeOlderPage(rows, hub.get(olderPageParams('A', rows)!)).rows; // 用户往上翻了一页:60 条
  all.push({ task_id: 't99999', created_at: ts(400), content: 'live' }); // 新消息到了
  const live = mergeNewestPage(rows, hub.get(newestPageParams('A', CHAT_PAGE)), CHAT_PAGE);
  ck('新消息接在最新一端(index 0 = inverted 列表底部)', live[0].task_id === 't99999');
  ck('轮询只拉最新一页时,往上翻过的历史还在', live.length === 61 && new Set(ids(live)).size === 61);
  ck('最新区间以这次拉到的为准(状态 / 回复刷新)', (() => {
    const changed = { ...rows[3], content: 'updated' };
    const out = mergeNewestPage(rows, [...rows.slice(0, 3), changed, ...rows.slice(4, CHAT_PAGE)], CHAT_PAGE);
    return out[3].content === 'updated' && out.length === rows.length;
  })());
}

console.log('接线:ChatScreen / api');
{
  const chat = read('ChatScreen.tsx');
  const api = read('api.ts');
  ck('首屏 / 轮询走 newestPageParams', chat.includes('const params = newestPageParams(alias, limit);') && chat.includes('tasks: () => fetchTasks(cfg, params)'));
  ck('轮询结果用 mergeNewestPage 并入(不把翻过的历史缩回去)', chat.includes('const rows = hubRowsRef.current = mergeNewestPage(hubRowsRef.current, fetched, params.limit);') && chat.includes("paint('tasks', rows, fetched, confirmed)"));
  ck('往上翻按游标拉一页(不再 limit += PAGE 整窗重拉)', chat.includes('olderPageParams(alias, hubRowsRef.current)') && !chat.includes('limitRef.current += PAGE'));
  ck('往上翻的结果去重并入、到起点停', chat.includes('mergeOlderPage(hubRowsRef.current, page)') && chat.includes('if (!olderPageHasMore(page.length, added)) setHasOlder(false);'));
  ck('切会话清空已拉的 hub 行', chat.includes('hubRowsRef.current = [];'));
  ck('往上翻的回答也认会话(切走后不落到新会话)', /const loadOlder = async[\s\S]{0,700}requestGate\.isCurrent\(token\)/.test(chat));
  ck('首屏没到时画骨架,不是一整块空白', chat.includes('testID="chat-history-skeleton"') && !/\{!loaded \? \(\s*<View style=\{styles\.center\}>\s*<ActivityIndicator/.test(chat));
  ck('顶部加载指示居中', chat.includes("alignSelf: 'center' }} testID=\"chat-loading-older\""));
  ck('一页 = CHAT_PAGE', chat.includes('const PAGE = CHAT_PAGE;'));
  ck('fetchTasks 透传 before / before_task_id', api.includes("q.set('before', params.before)") && api.includes("q.set('before_task_id', params.before_task_id)"));
}

console.log(`\nchat-history-pages: ${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
