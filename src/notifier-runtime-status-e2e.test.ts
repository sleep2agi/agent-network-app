// 端到端(同 notifier-runtime-e2e 的假边界):0.2.109 新增的三件事跑真的 notifier-runtime.ts ——
//   1. 任务终态通知 + 与消息通知去重(一次终态最多响一次);点任务通知进任务详情;
//   2. 「免打扰时仍然提醒」:消息渠道 -v3 的 bypassDnd、授权回来后重新下发、关掉时撤回、旧渠道删除;
//   3. 通知诊断:没权限 / 发送报错 / 免打扰 agent / 总开关 —— 原因都记下来,且能格式化成可复制的文本。
// ck 式自执行脚本(不是 bun:test)。
import { advance, agentReply, CFG, finishTask, flush, H, makeCk, setAppState, task } from './test-support/notifier-harness';

const { ck, done } = makeCk();
const runtime = await import('./notifier-runtime');
const diag = await import('./notify-diagnostics');
const settings = await import('./notify-settings');
const model = await import('./mobile-notify-model');
const store = await import('./unread-store');

const tail = (n: number) => H.posted.slice(n).map(x => ({ id: x.identifier, title: x.content.title, ch: x.trigger?.channelId, data: x.content.data }));

// 起步:一个进行中的任务(首份列表只登记)。
const t1 = task('通信牛', '把 0.2.109 的发版说明写好\n细节见 issue');
const tOld = task('测试牛', '早就完成的任务', 'replied');
await runtime.setNotifierConfig(CFG);
await flush();
await advance(20_000);
ck('S0 启动:已完成的旧任务、进行中的任务都不提醒', H.posted.length === 0, tail(0));

// ── 1a. 任务完成,同一轮里 agent 的回复也到了 → 只有一条通知,标题带 ✅ 标签 ──
let base = H.posted.length;
finishTask(t1, 'replied');
agentReply('通信牛', '发版说明写好了,见 PR');
await advance(20_000);
await advance(60_000); // 过了配对窗口,也不该再补一条
const a = tail(base);
ck('T1 完成 + 回复同到:总共只有一条通知', a.length === 1, a);
ck('T1 那条的标题是「✅ 通信牛 完成了任务:把 0.2.109 的发版说明写好」', a[0]?.title === '✅ 通信牛 完成了任务:把 0.2.109 的发版说明写好', a[0]);
ck('T1 走有声渠道(-v3)', a[0]?.ch === 'agent-messages-v3', a[0]);

// ── 1b. 任务失败,没有回复行 → 过了配对窗口,单独一条 ❌ 任务通知,带 taskId ──
store.dispatchUnread({ kind: 'conversation_opened', agent: '通信牛' });
store.dispatchUnread({ kind: 'conversation_left' });
const t2 = task('SDK马', '跑一遍 Docker 回归');
await advance(20_000);
base = H.posted.length;
finishTask(t2, 'failed');
await advance(20_000);
ck('T2 失败刚拉到:先不单独发(等配对窗口里的回复)', H.posted.length === base, tail(base));
await advance(60_000);
const f = tail(base);
ck('T2 等不到回复 → 单独一条「❌ SDK马 任务失败:跑一遍 Docker 回归」', f.length === 1 && f[0].title === '❌ SDK马 任务失败:跑一遍 Docker 回归', f);
ck('T2 任务通知带 taskId,kind 是任务状态', f[0]?.data?.taskId === t2.task_id && f[0]?.data?.kind === model.TASK_STATUS_NOTIFICATION_KIND, f[0]?.data);
const route = model.routeTargetFromNotificationData(f[0]?.data, runtime.notifierProfileKey());
ck('T2 点它:路由到 SDK马 + 任务详情', route?.alias === 'SDK马' && route?.taskId === t2.task_id, route);
ck('T2 消息通知的路由不带 taskId(进会话)', model.routeTargetFromNotificationData(a[0]?.data, runtime.notifierProfileKey())?.taskId === null);

// ── 1c. 回复先到(这一轮),任务终态下一轮才拉到 → 不再响第二次;原地把那条改成 ✅ 标签(静默渠道) ──
const t3 = task('测试牛', '复现 HyperOS 勿扰');
await advance(20_000);
base = H.posted.length;
agentReply('测试牛', '复现了,勿扰开着就不弹');
await advance(20_000);
finishTask(t3, 'completed');
await advance(20_000);
await advance(60_000);
const c = tail(base);
ck('T3 第一条是普通消息通知(有声)', c[0]?.title === '测试牛' && c[0]?.ch === 'agent-messages-v3', c);
ck('T3 第二次是同一个 identifier 的原地更新,走静默渠道,标题 ✅', c.length === 2 && c[1].id === c[0].id && c[1].ch === model.QUIET_CHANNEL_ID && c[1].title.startsWith('✅ 测试牛 完成了任务'), c);

// ── 1d. 正开着这个会话看着 → 任务终态也不弹(与消息同一判据) ──
const t4 = task('通信牛', '看着会话时完成的任务');
await advance(20_000);
store.dispatchUnread({ kind: 'conversation_opened', agent: '通信牛' });
base = H.posted.length;
finishTask(t4, 'replied');
await advance(20_000);
await advance(60_000);
ck('T4 正在看的会话:任务终态不弹', H.posted.length === base, tail(base));
ck('T4 诊断记下原因 = 正在看这个会话', diag.getNotifyDiagnostics().lastDecision?.outcome === 'viewing', diag.getNotifyDiagnostics().lastDecision);
store.dispatchUnread({ kind: 'conversation_left' });

// ── 2. 免打扰时仍然提醒 ──
const v3 = H.channels.get('agent-messages-v3');
ck('D1 建的是 -v3,且默认设置(免打扰时仍然提醒=开)下发了 bypassDnd=true', settings.loadNotifySettings().dndBypass === true && H.channelSets.some(x => x.id === 'agent-messages-v3' && x.input.bypassDnd === true));
ck('D2 没授予勿扰权限时,系统里的渠道 bypassDnd 仍是 false(AOSP 行为,由假模块模拟)', v3?.bypassDnd === false, v3);
ck('D3 旧渠道 agent-messages 与 agent-messages-v2 都被删了', H.deletedChannels.includes('agent-messages') && H.deletedChannels.includes('agent-messages-v2'), H.deletedChannels);
// 人去系统页授予权限后回到应用 → 重新下发 → 生效。
await setAppState('background');
H.dndAccess = true;
await setAppState('active');
await flush();
ck('D4 授权后回到前台:渠道被重新下发,bypassDnd 生效', H.channels.get('agent-messages-v3')?.bypassDnd === true, H.channels.get('agent-messages-v3'));
settings.saveNotifySettings({ ...settings.loadNotifySettings(), dndBypass: false });
await flush();
ck('D5 关掉「免打扰时仍然提醒」→ 重新下发 bypassDnd=false', H.channels.get('agent-messages-v3')?.bypassDnd === false);
settings.saveNotifySettings({ ...settings.loadNotifySettings(), dndBypass: true });
await flush();

// ── 3. 诊断 ──
await runtime.refreshNotifyDiagnostics();
let d = diag.getNotifyDiagnostics();
ck('G1 诊断:运行时在跑、首份快照已登记、有上次拉取时间', d.runtimeRunning && d.baselineReady && !!d.lastPollAt, d);
ck('G2 诊断:拉取结果含三路条数', d.lastPollResult?.user !== null && d.lastPollResult?.inbox !== null && d.lastPollResult?.tasks !== null, d.lastPollResult);
ck('G3 诊断:权限 / 勿扰权限 / 勿扰状态 读到了', d.permission === 'granted' && d.dndAccess === true && d.interruptionFilter === 2, d);
ck('G4 诊断:渠道读数含 -v3(存在)与旧 id(不存在)', !!d.channels?.find(c => c.id === 'agent-messages-v3' && c.exists) && !!d.channels?.find(c => c.id === 'agent-messages-v2' && !c.exists), d.channels);

// 发送报错:不再被吞掉。
H.scheduleError = new Error('Notification channel does not exist');
agentReply('SDK马', '这条会发送失败');
await advance(20_000);
d = diag.getNotifyDiagnostics();
ck('G5 scheduleNotificationAsync 报错 → 最近错误 + 上次判定 = error:<原文>', !!d.lastError?.message.includes('Notification channel does not exist') && d.lastDecision?.outcome === 'error' && d.lastDecision?.detail === 'Notification channel does not exist', { e: d.lastError, dec: d.lastDecision });
H.scheduleError = null;

// 没权限:不发,记原因。
H.permission = 'denied';
base = H.posted.length;
agentReply('SDK马', '没权限时的消息');
await advance(20_000);
ck('G6 没有系统通知权限 → 不发,判定 = no_permission', H.posted.length === base && diag.getNotifyDiagnostics().lastDecision?.outcome === 'no_permission', diag.getNotifyDiagnostics().lastDecision);
H.permission = 'granted';

// 免打扰的 agent / 总开关。
settings.saveNotifySettings(settings.toggleAgentMuted(settings.loadNotifySettings(), runtime.notifierProfileKey(), '测试牛'));
agentReply('测试牛', '被免打扰的 agent');
await advance(20_000);
ck('G7 被设了免打扰的 agent → 判定 = muted', diag.getNotifyDiagnostics().lastDecision?.outcome === 'muted' && diag.getNotifyDiagnostics().lastDecision?.agent === '测试牛', diag.getNotifyDiagnostics().lastDecision);
settings.saveNotifySettings({ ...settings.loadNotifySettings(), enabled: false });
agentReply('SDK马', '总开关关着');
await advance(20_000);
ck('G8 总开关关 → 判定 = master_off', diag.getNotifyDiagnostics().lastDecision?.outcome === 'master_off', diag.getNotifyDiagnostics().lastDecision);
settings.saveNotifySettings({ ...settings.loadNotifySettings(), enabled: true });

// 过期才拉到的消息(应用在后台被暂停、回来时已超过 10 分钟)→ 判定 = stale(以前是无声无息)。
agentReply('SDK马', '十五分钟前的消息', H.now - 15 * 60_000);
await advance(20_000);
ck('G9 超过 10 分钟才拉到 → 判定 = stale', diag.getNotifyDiagnostics().lastDecision?.outcome === 'stale', diag.getNotifyDiagnostics().lastDecision);

// 可复制文本:面板与复制用同一份行。
await runtime.refreshNotifyDiagnostics();
const text = diag.formatDiagnostics(diag.getNotifyDiagnostics(), 'Agent Network 0.2.109 通知诊断');
ck('G10 复制文本含:运行时、权限、渠道 -v3、勿扰、上次拉取、上次判定、后台保持连接、最近错误', ['通知运行时', '系统通知权限', '渠道 agent-messages-v3', '勿扰模式', '勿扰权限', '上次拉取', '上次判定', '后台保持连接', '最近错误'].every(k => text.includes(k)), text);
ck('G11 后台保持连接关着时,复制文本里有「锁屏…不会提醒」的告警', /锁屏或切到后台后不会拉消息/.test(text));
ck('G12 勿扰开着(仅优先)显示为告警行', /⚠ 勿扰模式:开 · 仅优先事项/.test(text), text);

done();
