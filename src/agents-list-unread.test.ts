// 「新消息」组断言 — run: bun src/agents-list-unread.test.ts
// Vincent 2026-09-25「收到消息的那些节点,你要置顶…有消息的那些节点,你要置顶,这方便我直接看」。
//
// 钉住四件事:
//   1. 顺序:新消息(按最近消息倒序)> 置顶 > 各团队;置顶且有未读的进新消息,不在两处重复。
//   2. 读完回到原位:未读→0 后,整份分组与「从没有过未读」逐项相同。
//   3. 搜索不受影响:有查询词时不浮动,结果与不传 unread 时逐项相同。
//   4. 列表的未读集合 == 托盘的未读集合(同一个 agentUnreadCounts → trayModelFrom)。

import { buildSections, compareNewMessages, holdWhileActive, NEW_MESSAGES_TITLE, PINNED_TITLE, type AgentSection, type UnreadContext } from './agents-list';
import { agentUnreadCounts, hubTimeMs, latestMessageAtByAgent, type UnreadCountSource } from './agent-unread-counts';
import { trayModelFrom } from './tray-menu-model';
import { initialUnreadState } from './unread-ledger';
import type { HubMessage, Session } from './api';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const S = (alias: string, status = 'idle', updated_at = '2026-09-01T00:00:00Z'): Session =>
  ({ alias, status, updated_at } as Session);
const shape = (secs: AgentSection[]) => secs.map(g => `${g.title}:${g.data.map(s => s.alias).join(',')}`).join(' | ');
const unreadOf = (counts: Record<string, number>, lastAt: Record<string, number> = {}): UnreadContext =>
  ({ count: a => counts[a] ?? 0, lastMessageAt: a => lastAt[a] ?? 0 });

const fleet = [
  S('demo-node', 'working'),
  S('节点A', 'idle'),
  S('节点B', 'offline'),
  S('节点C', 'idle'),
  S('团队X甲', 'idle'),
  S('团队X乙', 'offline'),
  S('团队Y丙', 'working'),
];
const pinned = (a: string) => a === '节点A' || a === '团队Y丙';

// ── 1. 顺序:未读 / 置顶混合 ─────────────────────────────────────
{
  const unread = unreadOf({ '节点B': 2, '团队X乙': 1, '节点A': 5 }, { '节点B': 3000, '团队X乙': 9000, '节点A': 1000 });
  const secs = buildSections(fleet, '', { sort: { pinned }, unread });
  ck('新消息组在最顶', secs[0]?.title === NEW_MESSAGES_TITLE, shape(secs));
  ck('新消息组按最近一条消息倒序(与在线/置顶无关)', secs[0]?.data.map(s => s.alias).join(',') === '团队X乙,节点B,节点A', shape(secs));
  ck('置顶组紧跟其后,且只剩没有未读的置顶', secs[1]?.title === PINNED_TITLE && secs[1].data.map(s => s.alias).join(',') === '团队Y丙', shape(secs));
  const all = secs.flatMap(g => g.data.map(s => s.alias));
  ck('每个会话恰好出现一次(搬走,不复制)', all.length === fleet.length && new Set(all).size === fleet.length, all.join(','));
  const inTeams = secs.slice(2).flatMap(g => g.data.map(s => s.alias));
  ck('团队组里不再有有未读的会话', !inTeams.some(a => ['节点B', '团队X乙', '节点A'].includes(a)), inTeams.join(','));
  ck('新消息组的在线数照常计算', secs[0].online === 1 && secs[0].total === 3, `${secs[0].online}/${secs[0].total}`);

  const none = buildSections(fleet, '', { sort: { pinned }, unread: unreadOf({}) });
  ck('没有未读时不出现新消息组(空组不显示)', !none.some(g => g.title === NEW_MESSAGES_TITLE), shape(none));
  ck('没有未读时第一组仍是置顶', none[0]?.title === PINNED_TITLE, shape(none));

  // 最近消息时间缺失 → 退回 updated_at;时间相同 → 别名序
  const fb = buildSections([S('节点B', 'idle', '2026-09-02T00:00:00Z'), S('节点C', 'idle', '2026-09-03T00:00:00Z')], '',
    { unread: unreadOf({ '节点B': 1, '节点C': 1 }) });
  ck('没有消息时间时按 updated_at 倒序', fb[0].data.map(s => s.alias).join(',') === '节点C,节点B', shape(fb));
  ck('同一时间按别名序稳定', compareNewMessages(S('b'), S('a'), unreadOf({ a: 1, b: 1 }, { a: 5, b: 5 })) > 0);
  const negative = buildSections(fleet, '', { unread: unreadOf({ '节点B': 0, '节点C': -1 }) });
  ck('未读 0 / 负数不上浮', !negative.some(g => g.title === NEW_MESSAGES_TITLE), shape(negative));
}

// ── 2. 读完回到原位 ──────────────────────────────────────────────
{
  const baseline = buildSections(fleet, '', { sort: { pinned } });
  const before = buildSections(fleet, '', { sort: { pinned }, unread: unreadOf({ '节点A': 1, '节点B': 4 }) });
  const after = buildSections(fleet, '', { sort: { pinned }, unread: unreadOf({ '节点A': 0, '节点B': 0 }) });
  ck('有未读时分组确实变了(否则下面的「回原位」是空断言)', shape(before) !== shape(baseline));
  ck('读完后整份分组与从没有未读时逐项相同', shape(after) === shape(baseline), `${shape(after)}\n   vs ${shape(baseline)}`);
  const pinnedBack = after.find(g => g.title === PINNED_TITLE)?.data.map(s => s.alias) ?? [];
  ck('置顶的节点A读完回到置顶组', pinnedBack.includes('节点A'), pinnedBack.join(','));
  const partial = buildSections(fleet, '', { sort: { pinned }, unread: unreadOf({ '节点B': 4 }) });
  ck('只读完一个:另一个仍在新消息组', partial[0]?.title === NEW_MESSAGES_TITLE && partial[0].data.map(s => s.alias).join(',') === '节点B', shape(partial));
}

// ── 3. 搜索不受影响 ──────────────────────────────────────────────
{
  const unread = unreadOf({ '节点B': 3, '节点C': 1 }, { '节点B': 1, '节点C': 2 });
  const plain = buildSections(fleet, '节点', { sort: { pinned } });
  const withUnread = buildSections(fleet, '节点', { sort: { pinned }, unread });
  ck('有查询词时结果与不传未读时逐项相同', shape(withUnread) === shape(plain), `${shape(withUnread)}\n   vs ${shape(plain)}`);
  ck('有查询词时不出现新消息组', !withUnread.some(g => g.title === NEW_MESSAGES_TITLE));
  ck('搜索确实命中了有未读的会话(否则上面是空断言)', withUnread.some(g => g.data.some(s => s.alias === '节点B')));
  const blank = buildSections(fleet, '   ', { sort: { pinned }, unread });
  ck('纯空白查询视为没有查询,照常上浮', blank[0]?.title === NEW_MESSAGES_TITLE, shape(blank));
}

// ── 4. 列表未读集合 == 托盘未读集合 ───────────────────────────────
{
  const username = 'demo-user';
  const row = (id: string, from: string, at: string, type = 'reply'): HubMessage =>
    ({ id, from_alias: from, to_alias: username, type, created_at: at, acked: 0 } as HubMessage);
  const legacy: UnreadCountSource = {
    serverBody: { ok: true, unread: 2, messages: [
      { message_id: 'u1', from_session: '节点A', acked: 0, created_at: '2026-09-25 01:00:00' },
    ] },
    ledger: { ...initialUnreadState(), counts: { '节点A': 1, hub: 3 } },
    replyRows: [
      row('r1', '节点B', '2026-09-25 03:00:00'),
      row('r2', '节点B', '2026-09-25 02:00:00'),
      row('r3', '团队X甲', '2026-09-25 00:00:01'), // 已看过(水位线之后才算)
      row('r4', '团队Y丙', '2026-09-25 04:00:00', 'status'), // 状态类不算
    ],
    replyUsername: username,
    replyWatermarks: { '团队X甲': '2026-09-25 00:00:05' },
  };
  const authoritative: UnreadCountSource = {
    ...legacy,
    serverBody: { ok: true, unread: 3, unread_by_agent: { '节点C': 2, '团队X乙': 1, '节点A': 0 } },
  };
  for (const [label, src] of [['老 hub(本地 ledger + 回复水位线)', legacy], ['新 hub(unread_by_agent 权威数)', authoritative]] as const) {
    const counts = agentUnreadCounts(src);
    const lastAt = latestMessageAtByAgent(src);
    const tray = new Set(trayModelFrom(counts).items.map(i => i.alias));
    const secs = buildSections(fleet, '', { sort: { pinned }, unread: { count: a => counts[a] ?? 0, lastMessageAt: a => lastAt[a] ?? 0 } });
    const listed = new Set(secs.find(g => g.title === NEW_MESSAGES_TITLE)?.data.map(s => s.alias) ?? []);
    const same = tray.size === listed.size && [...tray].every(a => listed.has(a));
    ck(`${label}:列表新消息组 == 托盘会话集合`, same && tray.size > 0 && tray.size < fleet.length, `tray=${[...tray]} list=${[...listed]}`);
  }
  const legacyTray = trayModelFrom(agentUnreadCounts(legacy)).items.map(i => i.alias).sort().join(',');
  ck('老 hub:未读集合就是 节点A + 节点B(hub 排除、状态类与水位线前的不算)', legacyTray === ['节点A', '节点B'].sort().join(','), legacyTray);
  const lastAt = latestMessageAtByAgent(legacy);
  ck('最近消息时间取两个来源里最新的一条', lastAt['节点B'] === hubTimeMs('2026-09-25 03:00:00') && lastAt['节点A'] === hubTimeMs('2026-09-25 01:00:00'));
  ck('hub 无时区时间按 UTC 解析', hubTimeMs('2026-09-25 03:00:00') === Date.UTC(2026, 8, 25, 3, 0, 0) && hubTimeMs('2026-09-25T03:00:00Z') === Date.UTC(2026, 8, 25, 3, 0, 0));
  ck('读不出的时间返回 0', hubTimeMs('') === 0 && hubTimeMs('garbage') === 0 && hubTimeMs(undefined) === 0);
}

// ── 5. 活动中按住上一份输入 ──────────────────────────────────────
{
  const prev = { v: 1 }, live = { v: 2 };
  ck('活动中且有上一份:按住上一份', holdWhileActive(prev, live, true) === prev);
  ck('不活动:换成最新的', holdWhileActive(prev, live, false) === live);
  ck('活动中但还没有上一份:用最新的', holdWhileActive(null, live, true) === live);
}

// ── 6. 源码契约:托盘和列表调的是同一个函数 ─────────────────────
{
  const { readFileSync } = await import('node:fs');
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const tray = read('./desktop-tray.ts');
  const screen = read('./AgentsScreen.tsx');
  ck('托盘 trayCountsFrom 直接返回 agentUnreadCounts(snap)', /export function trayCountsFrom\([^)]*\)[^{]*\{\s*return agentUnreadCounts\(snap\);\s*\}/.test(tray));
  ck('节点列表的新消息组用 agentUnreadCounts 取数', /counts: agentUnreadCounts\(src\)/.test(screen) && /unread: \{ count: alias => floatInput\.counts\[alias\]/.test(screen));
}

console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
