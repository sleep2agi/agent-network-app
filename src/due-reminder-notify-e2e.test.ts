// #499 端到端:跑**真的** notifier-runtime.ts(手机通知的全部接线),边界是假的(test-support/notifier-harness.ts)。
// 「任务提醒」发的到期提醒(system-notice.ts)在 #686 里被摘出 agent 链路 ⇒ 手机在后台时没有任何系统通知。
// 这里钉住:用户流 / 轮询两路都会发、标题「任务提醒」、点它打开任务、总开关关 → 不发、Agent 别名发的照旧走 agent 分组。
// ck 式自执行脚本(不是 bun:test)。
import { advance, CFG, flush, H, hubTs, makeCk, setAppState } from './test-support/notifier-harness';

const { ck, done } = makeCk();
const runtime = await import('./notifier-runtime');
const bus = await import('./notifier-bus');
const settingsMod = await import('./notify-settings');
const diag = await import('./notify-diagnostics');
const { DUE_REMINDER_KIND, DUE_REMINDER_SENDER } = await import('./system-notice');

const logs: string[] = [];
const realInfo = console.info;
console.info = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };

const meta = (req: string) => JSON.stringify({ task_notice: { requirement_id: req, seq: 7, network_id: 'net-1', due_reminder: 'overdue', due: '2026-09-24', overdue_days: 2 } });
let seq = 1;
function sysRow(req: string, content: string, at = H.now) {
  const row = { message_id: `dm_due_${seq++}`, network_id: 'net-1', user_id: 'u1', from_session: DUE_REMINDER_SENDER, kind: DUE_REMINDER_KIND, title: '任务已逾期', content, severity: 'warning', meta_json: meta(req), acked: 0, created_at: hubTs(at), acked_at: null };
  H.userRows.push(row);
  return row;
}
function agentDueRow(agent: string, req: string, content: string, at = H.now) {
  const row = sysRow(req, content, at);
  row.from_session = agent; // 同一行(已在 H.userRows 里)改成负责 Agent 发的
  return row;
}
/** DesktopMessageListener 收到「任务提醒」的 desktop_message 时交给 bus 的形状(desktop-message-consume 解析后)。 */
const streamNotice = (row: ReturnType<typeof sysRow>) => ({
  messageId: row.message_id, message: row.content, title: row.title, from: row.from_session, kind: row.kind, createdAt: row.created_at,
  taskNotice: { requirementId: JSON.parse(row.meta_json).task_notice.requirement_id, networkId: 'net-1' },
});
const dueNotes = () => H.posted.filter(x => x.content?.data?.kind === 'anet-task-due');

// 启动:hub 上已经有一条旧的系统提醒(登录前的),只登记不弹。
sysRow('req_old', '任务#1 已逾期(启动前就有)', H.now - 60_000);
const opened: Array<{ req: string; net: string | null }> = [];
const detach = runtime.attachNotifierUi(() => {}, (req, net) => opened.push({ req, net }));
await runtime.setNotifierConfig(CFG);
await flush();
ck('A1 启动时已存在的「任务提醒」只登记,不发系统通知', dueNotes().length === 0, H.posted.map(x => x.content.title));

// B:应用在后台(开着保持连接,React 树仍在、用户流在推)→ 用户流推来「任务提醒」→ 发系统通知。
settingsMod.saveNotifySettings({ ...settingsMod.loadNotifySettings(), keepAlive: true });
await flush();
const keepAlive = await import('./keep-alive');
keepAlive.registerKeepAliveTask();
void H.headless!();
await flush();
await setAppState('background');
ck('B0 后台 + 保持连接:轮询计时器在排', H.timers.some(x => x.ms === 20_000), H.timers.map(x => x.ms));
const b = sysRow('req_7', '任务#7「示例任务」已逾期 2 天(预计完成 2026-09-24),还没有完成。');
bus.emitSystemNotice(streamNotice(b));
await flush();
const bn = dueNotes().at(-1);
ck('B1 后台 + 用户流:发出一条系统通知', dueNotes().length === 1, H.posted.map(x => x.content.title));
ck('B2 标题「任务提醒」,正文 = 提醒原文', bn?.content?.title === '任务提醒' && /已逾期 2 天/.test(bn?.content?.body ?? ''), bn?.content);
ck('B3 data 带任务 id + 当前账号', bn?.content?.data?.requirementId === 'req_7' && bn?.content?.data?.networkId === 'net-1' && bn?.content?.data?.profileKey === runtime.notifierProfileKey(), bn?.content?.data);
ck('B4 走有声渠道且渠道存在', !!bn && H.channels.has(bn.trigger?.channelId) && H.channels.get(bn.trigger.channelId)?.importance === 6, bn?.trigger);
ck('B5 诊断记下了这一条(上次任务提醒 = 已通知)', diag.getNotifyDiagnostics().lastDueReminder?.outcome === 'notified' && diag.getNotifyDiagnostics().lastDueReminder?.requirementId === 'req_7', diag.getNotifyDiagnostics().lastDueReminder);
ck('B6 打了一行可 grep 的日志', logs.some(l => l.startsWith('[anet-notify] task_due source=stream outcome=notified') && /req=req_7/.test(l)), logs);
// 下一拍轮询同一条:用户流先到的不再重复发。
let base = dueNotes().length;
await advance(25_000);
ck('B7 轮询读到同一条 → 不重复发', dueNotes().length === base, dueNotes().map(x => x.content.data.messageId));

// C:点这条通知 → 打开 req_7 那张任务卡片(不是某个会话)。
H.tapListener?.({ notification: { request: { identifier: bn?.identifier, content: { data: bn?.content?.data } }, date: 1 } });
await flush();
ck('C1 点通知 → 打开任务 req_7(网络 net-1)', opened.length === 1 && opened[0].req === 'req_7' && opened[0].net === 'net-1', opened);

// D:用户流没推到(后台、只有轮询)→ 轮询补发,并在 Hub 上标已读。
base = dueNotes().length;
const d = sysRow('req_8', '任务#8 今天到期');
await advance(25_000);
ck('D1 只有轮询看到的 → 也发系统通知', dueNotes().length === base + 1 && dueNotes().at(-1)?.content?.data?.requirementId === 'req_8', dueNotes().map(x => x.content.data.requirementId));
ck('D2 轮询补发的在 Hub 上标已读(不留清不掉的未读)', H.acked.includes(d.message_id), H.acked);

// E:通知总开关关 → 两路都不发。
settingsMod.saveNotifySettings({ ...settingsMod.loadNotifySettings(), enabled: false });
base = dueNotes().length;
const e1 = sysRow('req_9', '任务#9 已逾期');
bus.emitSystemNotice(streamNotice(e1));
sysRow('req_10', '任务#10 已逾期');
await advance(25_000);
ck('E1 总开关关:用户流 / 轮询都不发', dueNotes().length === base, dueNotes().map(x => x.content.data.requirementId));
ck('E2 诊断写明原因(master_off)', diag.getNotifyDiagnostics().lastDueReminder?.outcome === 'master_off', diag.getNotifyDiagnostics().lastDueReminder);
settingsMod.saveNotifySettings({ ...settingsMod.loadNotifySettings(), enabled: true });
await flush();
// 总开关关会连前台服务一起停(keepAliveWanted 要求总开关开);重新打开后系统再拉起 headless 任务。
void H.headless!();
await flush();

// F:应用在前台 + 用户流推来 → 顶部提示已经弹了,不再发系统通知。
await setAppState('active');
await flush();
base = dueNotes().length;
const f = sysRow('req_11', '任务#11 明天到期');
bus.emitSystemNotice(streamNotice(f));
await flush();
ck('F1 前台 + 用户流:不发系统通知(顶部提示)', dueNotes().length === base, dueNotes().map(x => x.content.data.requirementId));
ck('F2 诊断:foreground_notice', diag.getNotifyDiagnostics().lastDueReminder?.outcome === 'foreground_notice', diag.getNotifyDiagnostics().lastDueReminder);

// G:负责 Agent 别名发的到期提醒 → 照旧是那个 agent 的消息通知(标题 = agent,点它进会话),不走「任务提醒」。
await setAppState('background');
base = dueNotes().length;
const before = H.posted.length;
agentDueRow('agent-x', 'req_12', '任务#12 今天到期');
await advance(25_000);
const g = H.posted.slice(before);
ck('G1 Agent 别名发的 → 一条 agent 消息通知(标题 agent-x)', g.length === 1 && g[0].content.title === 'agent-x' && g[0].content.data?.kind === 'anet-agent-message', g.map(x => x.content));
ck('G2 不当成「任务提醒」', dueNotes().length === base);

detach();
keepAlive.stopKeepAlive();
console.info = realInfo;
done();
