// #499 到期提醒的系统通知 + 会话气泡「查看任务 ›」—— 纯逻辑。ck 风格,自执行(不是 bun:test)。
// 形状照 hub requirement-due-reminders.ts:kind='task_due',meta.task_notice = {requirement_id, seq, network_id, due_reminder, due, overdue_days},
// 发信人 =「任务提醒」(没有会话)或负责 Agent 的别名(落在那个会话里)。
import {
  DUE_NOTIFICATION_KIND, DUE_NOTIFICATION_TITLE, dueLogLine, dueNotificationIdentifier, dueReminderFromNotice, dueReminderFromRow,
  dueReminderRoute, dueRouteFromNotificationData, initialDueSeen, markDueSeen, parseTaskOpenAlias, pickDueRows, planDueReminder, taskOpenAlias,
} from './due-reminder-notify';
import { DUE_REMINDER_KIND, DUE_REMINDER_SENDER, splitSystemNotices } from './system-notice';
import { consumeDesktopMessageEvent } from './desktop-message-consume';
import { dueReminderTaskRef, proactiveItemsForAgent } from './proactive-messages';
import { initialTapQueue, MESSAGE_CHANNEL_ID, QUIET_CHANNEL_ID, receiveTap, routeTargetFromNotificationData, takeRoute } from './mobile-notify-model';
import { DEFAULT_QUIET_HOURS } from './quiet-hours';
import { readFileSync } from 'node:fs';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra: unknown = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name} ${JSON.stringify(extra)}`); };

const metaObj = { task_notice: { requirement_id: 'req_7', seq: 7, network_id: 'net-a', due_reminder: 'overdue', due: '2026-10-01', overdue_days: 2 } };
const meta = JSON.stringify(metaObj);
const BODY = '任务#7「示例任务」已逾期 2 天(预计完成 2026-10-01),还没有完成。';
const sysEvent = { type: 'desktop_message', message_id: 'dm_due_1', kind: DUE_REMINDER_KIND, from: DUE_REMINDER_SENDER, title: '任务已逾期', message: BODY, severity: 'warning', created_at: '2026-10-03 01:00:00', network_id: 'net-a', scope: 'user', meta };
const agentEvent = { ...sysEvent, message_id: 'dm_due_2', from: 'agent-x' };
const sysRow = (id: string, extra: Record<string, unknown> = {}) => ({ message_id: id, from_session: DUE_REMINDER_SENDER, kind: DUE_REMINDER_KIND, title: '任务已逾期', content: BODY, meta_json: meta, acked: 0, created_at: '2026-10-03 01:00:00', ...extra });
const NOW = Date.parse('2026-10-03T01:02:00Z');
const settingsOn = { enabled: true, soundEnabled: true, quiet: DEFAULT_QUIET_HOURS };

console.log('# 解析(用户流事件 / user_inbox 行)');
{
  const c = consumeDesktopMessageEvent(sysEvent, { networkId: 'net-a' });
  const rem = c.status === 'present' ? dueReminderFromNotice(c.notice) : null;
  ck('用户流事件 → 正文 = 提醒原文、任务 id / 网络取自 meta.task_notice', rem?.body === BODY && rem?.requirementId === 'req_7' && rem?.networkId === 'net-a' && rem?.messageId === 'dm_due_1', rem);
  const a = consumeDesktopMessageEvent(agentEvent, { networkId: 'net-a' });
  ck('Agent 别名发的到期提醒不走这里(null)', a.status === 'present' && dueReminderFromNotice(a.notice) === null);
  const row = dueReminderFromRow(sysRow('dm_due_3'));
  ck('user_inbox 行(meta_json 字符串)→ 同样解析', row?.body === BODY && row?.requirementId === 'req_7' && row?.createdAt === '2026-10-03 01:00:00', row);
  const rowObj = dueReminderFromRow({ ...sysRow('dm_due_4'), meta_json: undefined, meta: metaObj });
  ck('meta 是对象也认', rowObj?.requirementId === 'req_7', rowObj);
  const noMeta = dueReminderFromRow({ ...sysRow('dm_due_5'), meta_json: null });
  ck('没有 meta.task_notice:仍是提醒,任务 id 为空(点了只把应用拉到前台)', noMeta?.body === BODY && noMeta?.requirementId === null, noMeta);
  const titleOnly = dueReminderFromRow({ ...sysRow('dm_due_6'), content: '' });
  ck('正文空时用 Hub 的标题', titleOnly?.body === '任务已逾期', titleOnly);
  ck('真叫「任务提醒」的节点发的普通消息不是', dueReminderFromRow({ ...sysRow('dm_x'), kind: 'agent_message' }) === null);
  ck('没有 message_id 的行丢弃', dueReminderFromRow({ ...sysRow(''), message_id: '' }) === null);
}

console.log('# 路由(系统发信人 vs Agent 发信人)');
ck('「任务提醒」+ task_due → system', dueReminderRoute({ kind: DUE_REMINDER_KIND, from: DUE_REMINDER_SENDER }) === 'system');
ck('Agent 别名 + task_due → agent(走原来的按 agent 分组通知)', dueReminderRoute({ kind: DUE_REMINDER_KIND, from: 'agent-x' }) === 'agent');
ck('不是 task_due → none', dueReminderRoute({ kind: 'agent_message', from: DUE_REMINDER_SENDER }) === 'none' && dueReminderRoute(null) === 'none');
{
  // 轮询那一路:系统通知行只从 split 的 systemRows 出来,agent 链路(body)里没有;Agent 别名的到期提醒留在 body 里。
  const agentRow = { ...sysRow('dm_due_agent'), from_session: 'agent-x' };
  const split = splitSystemNotices({ messages: [sysRow('dm_due_sys'), agentRow], unread: 2, unread_by_agent: { [DUE_REMINDER_SENDER]: 1, 'agent-x': 1 } });
  const bodyIds = (split.body.messages as Array<{ message_id: string }>).map(m => m.message_id).join(',');
  const sysIds = split.systemRows.map(r => r.message_id).join(',');
  ck('split:agent 链路只剩 Agent 别名那条,系统那条单独交出', bodyIds === 'dm_due_agent' && sysIds === 'dm_due_sys', { bodyIds, sysIds });
  ck('split:角标里没有「任务提醒」', !(DUE_REMINDER_SENDER in (split.body.unread_by_agent ?? {})) && split.body.unread === 1, split.body);
}

console.log('# 判定 + 发什么');
{
  const rem = dueReminderFromRow(sysRow('dm_due_7'))!;
  const bg = planDueReminder(rem, { profileKey: 'pk', foreground: false, source: 'stream', settings: settingsOn, minutes: 600 });
  const post = 'post' in bg ? bg.post : null;
  ck('后台:发系统通知,标题「任务提醒」,正文 = 提醒原文', post?.title === DUE_NOTIFICATION_TITLE && DUE_NOTIFICATION_TITLE === '任务提醒' && post?.body === BODY, bg);
  ck('data 带任务 id / 网络 / 当前账号,kind 是到期提醒', post?.data.kind === DUE_NOTIFICATION_KIND && post?.data.requirementId === 'req_7' && post?.data.networkId === 'net-a' && post?.data.profileKey === 'pk', post?.data);
  ck('每条提醒一个 identifier(不并进 agent 的那条)', post?.identifier === dueNotificationIdentifier('pk', 'dm_due_7') && !post?.identifier.startsWith('anet-msg:'), post?.identifier);
  ck('提示音开 → 有声渠道', post?.alert === true && post?.channelId === MESSAGE_CHANNEL_ID);
  const quiet = planDueReminder(rem, { profileKey: 'pk', foreground: false, source: 'poll', settings: { ...settingsOn, soundEnabled: false }, minutes: 600 });
  ck('提示音关 → 静默渠道(仍然发)', 'post' in quiet && quiet.post.alert === false && quiet.post.channelId === QUIET_CHANNEL_ID, quiet);
  const off = planDueReminder(rem, { profileKey: 'pk', foreground: false, source: 'stream', settings: { ...settingsOn, enabled: false }, minutes: 600 });
  ck('通知总开关关 → 不发(master_off)', 'skip' in off && off.skip === 'master_off', off);
  const qh = planDueReminder(rem, { profileKey: 'pk', foreground: false, source: 'stream', settings: { ...settingsOn, quiet: { enabled: true, start: '22:00', end: '08:00' } }, minutes: 23 * 60 });
  ck('免打扰时段 → 不发(quiet_hours)', 'skip' in qh && qh.skip === 'quiet_hours', qh);
  const fg = planDueReminder(rem, { profileKey: 'pk', foreground: true, source: 'stream', settings: settingsOn, minutes: 600 });
  ck('前台 + 用户流推来(顶部提示已弹)→ 不发系统通知', 'skip' in fg && fg.skip === 'foreground_notice', fg);
  const fgPoll = planDueReminder(rem, { profileKey: 'pk', foreground: true, source: 'poll', settings: settingsOn, minutes: 600 });
  ck('前台但只有轮询看到(没有顶部提示)→ 发', 'post' in fgPoll, fgPoll);
  const md = planDueReminder({ ...rem, body: '**任务#7** 今天到期' }, { profileKey: 'pk', foreground: false, source: 'stream', settings: settingsOn, minutes: 600 });
  ck('正文里的 Markdown 压成纯文本', 'post' in md && md.post.body === '任务#7 今天到期', md);
}

console.log('# 点通知 → 打开哪张任务');
{
  const data = { kind: DUE_NOTIFICATION_KIND, alias: '', profileKey: 'pk', requirementId: 'req_7', networkId: 'net-a', messageId: 'dm_due_7' };
  ck('本账号的到期提醒 → req_7 / net-a', JSON.stringify(dueRouteFromNotificationData(data, 'pk')) === JSON.stringify({ requirementId: 'req_7', networkId: 'net-a' }));
  ck('别的账号发的 → 不跳', dueRouteFromNotificationData(data, 'other') === null);
  ck('没有任务 id → 不跳', dueRouteFromNotificationData({ ...data, requirementId: null }, 'pk') === null);
  ck('agent 消息通知不是到期提醒', dueRouteFromNotificationData({ kind: 'anet-agent-message', alias: 'agent-x', profileKey: 'pk' }, 'pk') === null);
  ck('到期提醒的通知不会被当成会话跳转(alias 空)', routeTargetFromNotificationData(data, 'pk') === null);
  // 冷启动排队:takeRoute 把原始 data 交回来,运行时再按 kind 解析(否则 alias 为空就被丢了)。
  let q = receiveTap(initialTapQueue(), data, 'anet-due:pk:dm_due_7@1');
  const notReady = takeRoute(q, { loggedIn: false, uiAttached: true, profileKey: 'pk' });
  ck('没登录完:点击留着', !notReady.consumed && !!notReady.queue.pending);
  q = notReady.queue;
  const taken = takeRoute(q, { loggedIn: true, uiAttached: true, profileKey: 'pk' });
  ck('就绪后取出,data 交回且解析得到任务', taken.consumed && taken.alias === null && dueRouteFromNotificationData(taken.data, 'pk')?.requirementId === 'req_7', taken);
  ck('同一次点击重读不再跳', !takeRoute(receiveTap(taken.queue, data, 'anet-due:pk:dm_due_7@1'), { loggedIn: true, uiAttached: true, profileKey: 'pk' }).consumed);
}

console.log('# 桌面:任务编码进 alias(Rust chat_notify 只回报 alias)');
{
  const alias = taskOpenAlias({ requirementId: 'req:7/x', networkId: 'net-a' });
  ck('往返一致(含特殊字符)', JSON.stringify(parseTaskOpenAlias(alias)) === JSON.stringify({ requirementId: 'req:7/x', networkId: 'net-a' }), alias);
  ck('没有网络也能往返', JSON.stringify(parseTaskOpenAlias(taskOpenAlias({ requirementId: 'req_7', networkId: null }))) === JSON.stringify({ requirementId: 'req_7', networkId: null }));
  ck('普通 agent 别名不是任务', parseTaskOpenAlias('agent-x') === null && parseTaskOpenAlias('任务提醒') === null);
  ck('alias 非空(Rust 对空 alias 直接不发)', alias.trim().length > 0);
}

console.log('# 接线(源码契约)');
{
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const tray = src('./desktop-tray.ts'), listener = src('./DesktopMessageListener.tsx'), app = src('../App.tsx'), runtime = src('./notifier-runtime.ts');
  ck('桌面托盘事件:任务 alias 先解析成任务,不当会话打开', /const task = parseTaskOpenAlias\(payload\.trim\(\)\);\s*if \(task\) \{ onOpenTask\?\.\(task\.requirementId, task\.networkId\); return; \}\s*onOpenChat\(payload\.trim\(\)\);/.test(tray));
  ck('用户流:「任务提醒」交给系统通知那边', listener.includes('if (isSystemNotice(result.notice)) emitSystemNotice(result.notice);'));
  ck('App:托盘 / 手机通知点开任务都接到 openTaskRef', app.includes('(requirementId, networkId) => openTaskRef(requirementId, networkId, cfg, setScreen),') && app.includes('onOpenRequirement={(requirementId, networkId) => openTaskRef(requirementId, networkId, cfg, setScreen)}'));
  ck('App:主窗口 / 双栏 / 手机三处会话都传 onOpenTask(分离聊天窗不传)', (app.match(/onOpenTask=\{\(id, net\) => openTaskRef\(id, net, cfg, setScreen\)\}/g) ?? []).length === 4);
  ck('手机运行时订阅了用户流的系统通知', runtime.includes('unsubs.push(subscribeSystemNotice(onSystemNoticeEvent));'));
}

console.log('# 轮询:首轮登记 / 已读 / 过期 / 去重');
{
  const seen = initialDueSeen();
  const first = pickDueRows(seen, [sysRow('dm_old', { created_at: '2026-10-03 01:01:00' })], NOW);
  ck('首轮只登记,不发(登录时已有的不弹一屏)', first.toNotify.length === 0 && seen.seeded && seen.ids.has('dm_old'));
  const second = pickDueRows(seen, [
    sysRow('dm_old', { created_at: '2026-10-03 01:01:00' }),
    sysRow('dm_new', { created_at: '2026-10-03 01:01:30' }),
    sysRow('dm_read', { created_at: '2026-10-03 01:01:30', acked: 1 }),
    sysRow('dm_stale', { created_at: '2026-10-03 00:40:00' }),
    { ...sysRow('dm_agent'), from_session: 'agent-x' },
  ], NOW);
  ck('之后:只发没见过、未读、新鲜的', second.toNotify.map(r => r.messageId).join(',') === 'dm_new', second.toNotify.map(r => r.messageId));
  ck('超过 10 分钟才读到的记 stale', second.stale.map(r => r.messageId).join(',') === 'dm_stale', second.stale);
  ck('用户流先到的(markDueSeen)轮询不再发', !markDueSeen(seen, 'dm_new') && markDueSeen(seen, 'dm_stream') && pickDueRows(seen, [sysRow('dm_stream', { created_at: '2026-10-03 01:01:50' })], NOW).toNotify.length === 0);
}

console.log('# 会话气泡:负责 Agent 发的到期提醒带任务');
{
  const agentRow = { message_id: 'dm_due_agent', from_session: 'agent-x', kind: DUE_REMINDER_KIND, title: '任务今天到期', content: '任务#7 今天到期', meta_json: meta, created_at: '2026-10-03 01:00:00' };
  const plain = { message_id: 'dm_plain', from_session: 'agent-x', kind: 'agent_message', title: null, content: '普通主动消息', meta_json: meta, created_at: '2026-10-03 00:59:00' };
  const items = proactiveItemsForAgent([agentRow, plain] as any, 'agent-x', 'admin');
  const due = items.find(i => i.task_id === 'dm_due_agent');
  const other = items.find(i => i.task_id === 'dm_plain');
  ck('到期提醒气泡带 _taskNotice(req_7 / net-a)', due?._taskNotice?.requirementId === 'req_7' && due?._taskNotice?.networkId === 'net-a', due);
  ck('普通主动消息不带(即使 meta 里碰巧有 task_notice)', !other?._taskNotice, other);
  ck('没有 meta → 不画链接', dueReminderTaskRef({ kind: DUE_REMINDER_KIND, meta_json: null }) === null);
}

console.log('# 诊断日志行');
{
  const line = dueLogLine({ source: 'poll', outcome: 'notified', messageId: 'dm_due_7', requirementId: 'req_7', platform: 'android', appState: 'background' });
  ck('可 grep 的前缀 + 关键字段', line.startsWith('[anet-notify] task_due ') && /source=poll/.test(line) && /outcome=notified/.test(line) && /req=req_7/.test(line) && /app=background/.test(line), line);
}

console.log(`\n${p}/${n} passed`);
process.exit(p === n && n > 0 ? 0 : 1);
