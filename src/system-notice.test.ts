// 到期提醒(hub agent-network#2289,kind='task_due')在 App 里的落点(#491 / #493)。ck 风格,自执行。
// 形状照 hub server/src/requirement-due-reminders.ts + agent-notice.ts:user_inbox 一行 + desktop_message 推送,
// meta.task_notice = {requirement_id, seq, network_id, due_reminder, due, overdue_days};发信人 = 负责 Agent 的别名或「任务提醒」。
import { readFileSync } from 'node:fs';
import {
  DUE_REMINDER_KIND, DUE_REMINDER_SENDER, isDueReminderNotice, isSystemNotice, isSystemNoticeRow, noticeAckIds, stripSystemNotices,
} from './system-notice';
import { stripHumanDms } from './human-dm';
import { consumeDesktopMessageEvent } from './desktop-message-consume';
import { agentUnreadCounts, latestMessageAtByAgent } from './agent-unread-counts';
import { proactiveItemsForAgent } from './proactive-messages';
import { readServerUnread } from './user-unread';
import { initialUnreadState } from './unread-ledger';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };

const meta = (kind: string) => JSON.stringify({ task_notice: { requirement_id: 'req_1', seq: 3, network_id: 'net-a', due_reminder: kind, due: '2026-10-01', overdue_days: 2 } });
const sysRow = (id: string, acked = 0) => ({ message_id: id, from_session: DUE_REMINDER_SENDER, kind: DUE_REMINDER_KIND, title: '任务已逾期', content: '任务#3「示例任务」已逾期 2 天(预计完成 2026-10-01),还没有完成。', severity: 'warning', meta_json: meta('overdue'), created_at: '2026-10-03 01:00:00', acked });
const agentReminder = { message_id: 'dm_due_b', from_session: 'agent-x', kind: DUE_REMINDER_KIND, title: '任务今天到期', content: '任务#4「示例任务二」今天到期(预计完成 2026-10-03)。', severity: 'info', meta_json: meta('due_today'), created_at: '2026-10-03 01:00:01', acked: 0 };
const stuck = { message_id: 'dm_stuck_c', from_session: 'agent-x', kind: 'schedule_stuck', title: '定时任务卡住', content: '示例', severity: 'warning', created_at: '2026-10-03 00:59:00', acked: 0 };
const fakeNode = { message_id: 'dm_d', from_session: DUE_REMINDER_SENDER, kind: 'agent_message', content: '一个真叫这个名字的节点发的普通消息', created_at: '2026-10-03 00:58:00', acked: 0 };

console.log('# 判据');
ck('「任务提醒」+ task_due = 系统通知', isSystemNoticeRow(sysRow('dm_due_a')));
ck('Agent 别名发的到期提醒不是(留在那个会话里,同 #464)', !isSystemNoticeRow(agentReminder));
ck('同名发信人但不是 task_due(真节点的普通消息)不是', !isSystemNoticeRow(fakeNode));
ck('#464 定时卡住通知不受影响', !isSystemNoticeRow(stuck));

console.log('# 从 agent 链路摘掉(未读角标 / 新消息分组 / 主动消息)');
{
  const body = {
    messages: [sysRow('dm_due_a'), sysRow('dm_due_old', 1), agentReminder, stuck, fakeNode],
    unread: 5, pending_count: 5, unread_total: 4,
    unread_by_agent: { [DUE_REMINDER_SENDER]: 2, 'agent-x': 2 },
  };
  const s = stripSystemNotices(body);
  const ids = (s.messages as { message_id: string }[]).map(m => m.message_id).join(',');
  ck('系统通知行被摘掉,其余原样', ids === 'dm_due_b,dm_stuck_c,dm_d', ids);
  ck('unread_by_agent 里没有「任务提醒」', !(DUE_REMINDER_SENDER in (s.unread_by_agent ?? {})) && s.unread_by_agent?.['agent-x'] === 2);
  ck('合计减掉(unread 5→3,unread_total 4→2)', s.unread === 3 && s.pending_count === 3 && s.unread_total === 2, JSON.stringify([s.unread, s.pending_count, s.unread_total]));
  const snap = { serverBody: s, ledger: initialUnreadState(), replyRows: [], replyUsername: 'me', replyWatermarks: {} } as any;
  const counts = agentUnreadCounts(snap);
  ck('角标里没有「任务提醒」这个幽灵会话', !(DUE_REMINDER_SENDER in counts) && counts['agent-x'] === 2, JSON.stringify(counts));
  // 唯一留下的「任务提醒」行是那个真节点的普通消息(00:58),系统通知(01:00)不再把它顶到最上面。
  ck('「新消息」分组的时间不含系统通知', latestMessageAtByAgent(snap)[DUE_REMINDER_SENDER] === Date.parse('2026-10-03T00:58:00Z'));
  ck('服务端总未读读数也是摘掉后的', readServerUnread(s) === 3);
  const raw = agentUnreadCounts({ ...snap, serverBody: body });
  ck('反证:不摘的话「任务提醒」会变成一个清不掉的角标', raw[DUE_REMINDER_SENDER] === 2);
  const proactive = proactiveItemsForAgent(s.messages as any, 'agent-x');
  ck('Agent 别名发的到期提醒照常进那个会话(可读:标题 + 正文)', proactive.some(i => i.task_id === 'dm_due_b' && i.result === `**任务今天到期**\n\n${agentReminder.content}`));
  ck('没有这种行也没有这个键 → 原样返回同一个对象', stripSystemNotices({ messages: [stuck], unread: 1 }) !== undefined && (() => { const b = { messages: [stuck], unread: 1 }; return stripSystemNotices(b) === b; })());
  ck('只有键没有行(行在第 51 条以后)也减掉', (() => { const b = stripSystemNotices({ messages: [], unread: 3, unread_total: 3, unread_by_agent: { [DUE_REMINDER_SENDER]: 3 } }); return b.unread === 0 && b.unread_total === 0 && !(DUE_REMINDER_SENDER in b.unread_by_agent!); })());
  ck('与私信剥离叠加(api.ts 的顺序)不冲突', (stripSystemNotices(stripHumanDms({ ...body, messages: [...body.messages, { message_id: 'dm_h', from_session: 'alice', kind: 'human_dm', acked: 0 }] }, new Set())).messages as { message_id: string }[]).length === 3);
}

console.log('# 顶部提示:可读、点了打开任务');
{
  const ev = { type: 'desktop_message', message_id: 'dm_due_a', kind: DUE_REMINDER_KIND, from: DUE_REMINDER_SENDER, title: '任务已逾期', message: sysRow('x').content, severity: 'warning', created_at: '2026-10-03T01:00:00Z', meta: JSON.parse(meta('overdue')) };
  const r = consumeDesktopMessageEvent(ev, { networkId: 'net-a' });
  ck('照常弹出(present)', r.status === 'present');
  const notice = r.status === 'present' ? r.notice : null;
  ck('标题 + 正文可读', notice?.title === '任务已逾期' && !!notice?.message.includes('已逾期 2 天'));
  ck('带 requirement_id → 点提示打开那张任务', notice?.taskNotice?.requirementId === 'req_1' && notice?.taskNotice?.seq === 3);
  ck('是系统通知', !!notice && isSystemNotice(notice) && isDueReminderNotice(notice));
  const noMeta = consumeDesktopMessageEvent({ ...ev, meta: undefined });
  ck('不带 requirement_id → 只是可读的提示(点了关掉)', noMeta.status === 'present' && !noMeta.notice.taskNotice);
}

console.log('# 什么时候标已读');
{
  const sys = { messageId: 'dm_due_a', kind: DUE_REMINDER_KIND, from: DUE_REMINDER_SENDER };
  const viaAgent = { messageId: 'dm_due_b', kind: DUE_REMINDER_KIND, from: 'agent-x' };
  const other = { messageId: 'dm_x', kind: 'agent_message', from: 'agent-x' };
  ck('系统通知:弹出就 ack', noticeAckIds(sys, 'shown').join() === 'dm_due_a');
  ck('系统通知:点开也 ack', noticeAckIds(sys, 'opened').join() === 'dm_due_a');
  ck('Agent 别名的到期提醒:弹出不 ack(留在会话里等打开,同 #464)', noticeAckIds(viaAgent, 'shown').length === 0);
  ck('Agent 别名的到期提醒:点提示打开任务 = 看过,ack', noticeAckIds(viaAgent, 'opened').join() === 'dm_due_b');
  ck('普通主动消息:从不在这里 ack', noticeAckIds(other, 'shown').length === 0 && noticeAckIds(other, 'opened').length === 0);
}

console.log('# 接线');
{
  const api = readFileSync('src/api.ts', 'utf8');
  ck('两个 user_inbox 取数口都摘系统通知', (api.match(/stripSystemNotices\(stripHumanDms\(/g) ?? []).length === 2);
  const listener = readFileSync('src/DesktopMessageListener.tsx', 'utf8');
  ck('顶部提示弹出时 ack(shown)', /ackNotice\(result\.notice, 'shown'\)/.test(listener));
  ck('点提示打开任务时 ack(opened)', /ackNotice\(notice, 'opened'\)/.test(listener));
}

console.log(`\n${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
