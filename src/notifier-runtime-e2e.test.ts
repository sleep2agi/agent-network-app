// 端到端:跑**真的** notifier-runtime.ts(0.2.107 起手机通知的全部接线),只把边界换成假的
// (src/test-support/notifier-harness.ts)。0.2.107 的 70 条断言全在纯模型层(notify-policy /
// mobile-notify-model),notifier-runtime.ts 这一层(谁先登记快照、错误去了哪、后台计时器有没有排上)
// 一行都没被执行过 —— 这个文件补的就是那一层。A3 / F1 在 0.2.107 的 notifier-runtime 上是红的。
// ck 式自执行脚本(不是 bun:test)。
import { advance, agentReply, CFG, desktopMessage, flush, H, makeCk, setAppState } from './test-support/notifier-harness';

const { ck, done } = makeCk();
const runtime = await import('./notifier-runtime');
const bus = await import('./notifier-bus');
const store = await import('./unread-store');

// ─────────────────────────────────────────────
// 场景 A:冷启动。hub 上已有一条 2 分钟前的回复(人在别的设备上早看过了)+ 一堆更老的历史。
agentReply('通信牛', '更老的回复', H.now - 3 * 3600_000);
agentReply('通信牛', '两分钟前的回复,启动前就在了', H.now - 120_000);
desktopMessage('SDK马', '老的桌面消息', H.now - 3600_000);
await runtime.setNotifierConfig(CFG);
await flush();
ck('A1 运行时起来后建了消息渠道(发通知前渠道已存在)', H.channels.size > 0, [...H.channels.keys()]);
ck('A2 设了前台展示策略 setNotificationHandler(否则前台时静默丢弃)', H.handlerSet);
ck('A3 启动时已存在的消息不提醒(首份快照只登记)—— 含 inbox 那半', H.posted.length === 0, H.posted.map(x => x.content.body));

// 场景 B:前台、没开任何会话(两栏布局右侧占位),09:14 agent 回复了 admin 的任务。
await advance(5_000);
let base = H.posted.length;
agentReply('通信牛', '任务完成:已合并 #399');
await advance(20_000);
const b = H.posted.at(-1);
ck('B1 agent 回复 admin(inbox type=reply)→ 发出一条系统通知', H.posted.length === base + 1, H.posted.map(x => x.content.body));
ck('B2 标题是 agent,正文是回复', b?.content?.title === '通信牛' && /已合并/.test(b?.content?.body ?? ''), b?.content);
ck('B3 走有声渠道,且该渠道此刻存在', !!b && H.channels.has(b.trigger?.channelId) && H.channels.get(b.trigger.channelId)?.importance === 6, b?.trigger);

// 场景 C:desktop_message(user_inbox)经 SSE 敲一下 → 立刻拉 → 提醒。
base = H.posted.length;
desktopMessage('SDK马', '桌面消息:构建好了');
bus.requestNotifierRefresh();
await flush();
ck('C1 desktop_message(user_inbox)→ 经 SSE 敲一下立刻提醒', H.posted.length === base + 1 && H.posted.at(-1)?.content?.title === 'SDK马', H.posted.map(x => x.content.title));

// 场景 D:正开着「通信牛」的会话且在前台 → 通信牛 的新消息不提醒;别人的照常提醒。
store.dispatchUnread({ kind: 'conversation_opened', agent: '通信牛' });
base = H.posted.length;
agentReply('通信牛', '你正在看的会话里的新消息');
agentReply('测试牛', '别的 agent 的消息');
await advance(20_000);
ck('D1 正在看的会话:不提醒;看 A 时 B 来消息:提醒', H.posted.length === base + 1 && H.posted.at(-1)?.content?.title === '测试牛', H.posted.slice(base).map(x => x.content.title));
store.dispatchUnread({ kind: 'conversation_left' });

// 场景 E:锁屏 / 切后台。没开「后台保持连接」→ 不排计时器(RN 本来也会暂停它)。
await setAppState('background');
ck('E1 后台且没开保持连接:不排轮询计时器', H.timers.length === 0, H.timers.map(x => x.ms));
await setAppState('active');
await advance(10_000);

// 场景 G:锁屏 / 后台,开着「后台保持连接」(前台服务 + headless 任务)→ 20 s 一拍继续拉、继续提醒。
const keepAlive = await import('./keep-alive');
const settingsMod = await import('./notify-settings');
settingsMod.saveNotifySettings({ ...settingsMod.loadNotifySettings(), keepAlive: true });
await flush();
ck('G1 打开保持连接 → 起了前台服务', H.keepAliveNativeRunning);
// 原生服务起来后由系统调 headless 任务(index.ts 登记的 AnetKeepAlive);这里直接跑那个任务函数。
keepAlive.registerKeepAliveTask();
void H.headless!();
await flush();
ck('G2 headless 任务在跑', keepAlive.keepAliveTaskActive());
await setAppState('background');
ck('G3 后台 + 保持连接:排了 20 s 的轮询计时器', H.timers.some(x => x.ms === 20_000), H.timers.map(x => x.ms));
base = H.posted.length;
await advance(25_000);
agentReply('SDK马', '锁屏时来的回复');
await advance(25_000);
ck('G4 锁屏/后台时 agent 回复 → 提醒', H.posted.length === base + 1 && H.posted.at(-1)?.content?.title === 'SDK马', H.posted.slice(base).map(x => x.content.body));
await setAppState('active');
keepAlive.stopKeepAlive();
settingsMod.saveNotifySettings({ ...settingsMod.loadNotifySettings(), keepAlive: false });
await flush();

// 场景 F:hub 的 scope=user 读失败(老 hub / 网关 404 / 暂时 5xx),inbox 那半正常。
// agent 回复 admin 在 inbox 那半 —— 不该因为另一半拿不到就永远不提醒。
await runtime.setNotifierConfig(null);
H.userScopeFails = true;
// 冷启动的进程:unread-store 里什么都还没有。
store.replaceUnreadSnapshot({ ...store.getUnreadSnapshot(), serverBody: null, replyRows: [], seenIds: new Set() });
await runtime.setNotifierConfig({ ...CFG, profileId: 'p2' });
await flush();
await advance(20_000);
base = H.posted.length;
agentReply('通信牛', 'scope=user 坏着时的回复');
await advance(20_000);
await advance(20_000);
ck('F1 scope=user 一直失败时,inbox 那半的回复照样提醒', H.posted.length === base + 1, H.posted.slice(base).map(x => x.content.body));
// F2:同样坏着,回复恰好落在第一轮拉取之后、第二轮之前 —— 第一轮一结束就要登记,不能拖到第二轮
// (拖到第二轮登记 = 把这条回复当成「启动前就有的」吞掉)。
await runtime.setNotifierConfig(null);
store.replaceUnreadSnapshot({ ...store.getUnreadSnapshot(), serverBody: null, replyRows: [], seenIds: new Set() });
await runtime.setNotifierConfig({ ...CFG, profileId: 'p3' });
await flush();
base = H.posted.length;
agentReply('通信牛', '第一轮之后马上到的回复');
await advance(20_000);
ck('F2 scope=user 坏着、回复紧跟第一轮到达 → 提醒', H.posted.length === base + 1, H.posted.slice(base).map(x => x.content.body));
H.userScopeFails = false;

done();
