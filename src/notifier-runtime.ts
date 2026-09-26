// 0.2.107 手机端(安卓优先)新消息系统通知的运行时。模块级单例,不挂在某个组件上 ——
// 「后台保持连接」开着时,Activity 被系统销毁、React 树卸载,这里仍要继续拉消息、发通知。
//
// 数据流与桌面端 DesktopNotifier 是同一条:hub → unread-store 快照 → notify-policy(pickNew /
// groupByAgent / decide)。区别只有三处:
//   1. 手机的 Agent 列表只在它显示时轮询(进了会话就卸载了),所以这里自己也拉一次 ——
//      列表刚拉过(unreadLastIngestAt)就跳过,不重复请求;hub 的用户 SSE 推 desktop_message 时
//      立刻拉(notifier-bus);
//   2. 「在看」= AppState 为 active 且正开着那个会话(桌面端是窗口焦点);
//   3. 发出去的是 expo-notifications 的本地通知,按 agent 合并(mobile-notify-model.accumulate)。
//
// 🔴 与桌面端 0.2.81 的教训一致:唯一按「在不在看」抑制的,是**正开着的就是这个会话**。
//    人在应用里看 A,B 来了消息 —— 这是最常见的情形,必须弹。

import { AppState, Platform, type AppStateStatus } from 'react-native';
import { fetchMessages, fetchTasks, fetchUserMessages, replyUnreadSince, type HubConfig } from './api';
import { loadConfig } from './storage';
import {
  decideWithReason,
  groupByAgent,
  incomingFromSnapshot,
  initialSeen,
  pickNew,
  type SeenState,
} from './notify-policy';
import { localMinutes } from './quiet-hours';
import { plainTextForNotification } from './notify-text';
import {
  loadNotifySettings,
  mutedAgents,
  notifyProfileKey,
  saveNotifySettings,
  subscribeNotifySettings,
} from './notify-settings';
import { hydrateNativeNotifySettings } from './notify-settings-native';
import {
  accumulate,
  clearAgent,
  conversationBeingViewed,
  initialTapQueue,
  keepAliveWanted,
  MESSAGE_CHANNEL_ID,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KIND,
  LEGACY_CHANNEL_IDS,
  notificationIdentifier,
  summaryBody,
  QUIET_CHANNEL_ID,
  receiveTap,
  takeRoute,
  shouldAutoRequestPermission,
  shouldSkipFetch,
  watcherIntervalMs,
  type Buckets,
  type TapQueue,
} from './mobile-notify-model';
import {
  clearLastNotificationTap,
  currentInterruptionFilter,
  dismissNotification,
  dndAccessGranted,
  ensureNotificationSetup,
  mobileNotificationsSupported,
  notificationPermission,
  postNotification,
  readNotificationChannels,
  reapplyNotificationChannels,
  requestNotificationPermission,
  subscribeNotificationTaps,
} from './mobile-notifications';
import {
  errorText,
  getNotifyDiagnostics as getNotifyDiagnosticsState,
  patchNotifyDiagnostics,
  recordDecision,
  recordError,
  type DecisionOutcome,
} from './notify-diagnostics';
import {
  initialPairState,
  initialTaskSeen,
  onMessagePosted,
  onTaskFinished,
  pickTaskFinishes,
  takeExpiredMarks,
  taskLabel,
  taskNotificationIdentifier,
  TASK_NOTIFICATION_KIND,
  type PairState,
  type TaskFinish,
  type TaskSeen,
} from './task-notify';
import { keepAliveRunning, keepAliveTaskActive, setKeepAliveBootHook, startKeepAlive, stopKeepAlive } from './keep-alive';
import { setNotifierRefreshHandler } from './notifier-bus';
import { getUnreadSnapshot, ingestInboxMessagesBody, ingestUserMessagesBody, subscribeUnread, unreadHalvesIngested, unreadLastIngestAt } from './unread-store';

type RouteHandler = (alias: string, taskId?: string | null) => void;

let cfg: HubConfig | null = null;
let profileKey = '';
let seen: SeenState = initialSeen();
let buckets: Buckets = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let fetching = false;
let unsubs: Array<() => void> = [];
let routeHandler: RouteHandler | null = null;
let taps: TapQueue = initialTapQueue();
let tapsBound = false;
/** 本账号第一轮拉取(两半各试过一次,成功失败都算)结束了没有。见 baselineReady。 */
let firstRoundDone = false;
let taskSeen: TaskSeen = initialTaskSeen();
let pairs: PairState = initialPairState();
let lastDndBypass: boolean | null = null;

const appActive = () => AppState.currentState === 'active';

function configKey(c: HubConfig | null): string {
  return c ? `${notifyProfileKey(c)}|${c.serverUrl}|${c.token}` : '';
}

// ── 拉消息 ──
async function fetchOnce(force: boolean): Promise<void> {
  const c = cfg;
  if (!c || fetching) return;
  const interval = watcherIntervalMs(appActive(), keepAliveTaskActive()) ?? 10_000;
  if (!force && shouldSkipFetch(unreadLastIngestAt(), Date.now(), interval)) return;
  fetching = true;
  const result: { user: number | null; inbox: number | null; tasks: number | null; error: string | null } = { user: null, inbox: null, tasks: null, error: null };
  const fail = (where: string, e: unknown) => {
    const msg = `${where}: ${errorText(e)}`;
    result.error = result.error ? `${result.error}; ${msg}` : msg;
  };
  try {
    // 任务状态先处理:同一轮里任务终态和 agent 的回复一起到时,回复那条消息通知直接带上 ✅/❌ 标签(只发一条)。
    // 数据源与「任务」页相同(GET /api/tasks),按 from_name = 登录用户名。
    try {
      if (c.username) {
        const body = await fetchTasks(c, { from_name: c.username, limit: 30, skipStats: true });
        if (cfg === c) { result.tasks = body.tasks?.length ?? 0; onTasks(body.tasks ?? []); }
      }
    } catch (e) { fail('tasks', e); }
    // 🔴 0.2.107 这两处 catch 什么都不记:hub 读失败时通知整条链路静默失效、面板上也看不见。现在记进诊断。
    try {
      const body = await fetchUserMessages(c, 50);
      if (cfg === c) { ingestUserMessagesBody(body); result.user = Array.isArray((body as any)?.messages) ? (body as any).messages.length : 0; }
    } catch (e) { fail('scope=user', e); }
    try {
      const body = await fetchMessages(c, 300, replyUnreadSince());
      if (cfg === c) { ingestInboxMessagesBody(body, c.username); result.inbox = Array.isArray((body as any)?.messages) ? (body as any).messages.length : 0; }
    } catch (e) { fail('inbox', e); }
  } finally {
    fetching = false;
    if (cfg === c) {
      patchNotifyDiagnostics({ lastPollAt: Date.now(), lastPollResult: result });
      if (!firstRoundDone) {
        // 两半都试过一次了(哪怕有一半失败):可以登记首份快照了。
        // 🔴 0.2.107:scope=user 一直失败 → serverBody 永远 null → 永远不登记 → inbox 那半的回复也永远不提醒。
        firstRoundDone = true;
        onSnapshot();
      }
      flushExpiredTaskMarks();
    }
  }
}

function schedule(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!cfg) return;
  const interval = watcherIntervalMs(appActive(), keepAliveTaskActive());
  if (interval === null) return; // 后台且没开「保持连接」:计时器本来也会被 RN 暂停,回前台再拉
  timer = setTimeout(() => {
    timer = null;
    void fetchOnce(false).finally(schedule);
  }, interval);
}

// ── 快照 → 通知 ──
function clearViewed(): void {
  const viewing = conversationBeingViewed(getUnreadSnapshot().ledger.open, appActive());
  if (!viewing) return;
  const res = clearAgent(buckets, viewing, profileKey);
  buckets = res.buckets;
  if (res.dismiss) void dismissNotification(res.dismiss);
}

/**
 * 首份快照什么时候可以登记:两半(user_inbox / inbox)都送进来过,或本账号第一轮拉取已经结束。
 * 只到一半就登记 → 另一半整批到达时被当成新消息(0.2.107:冷启动把 10 分钟内的旧回复又弹一遍)。
 */
function baselineReady(): boolean {
  const halves = unreadHalvesIngested();
  return (halves.user && halves.inbox) || firstRoundDone;
}

function onSnapshot(): void {
  if (!cfg) return;
  clearViewed();
  const snap = getUnreadSnapshot();
  if (!seen.seeded && !baselineReady()) return;
  const wasSeeded = seen.seeded;
  const picked = pickNew(seen, incomingFromSnapshot(snap), Date.now());
  seen = picked.seen;
  if (!wasSeeded) patchNotifyDiagnostics({ baselineReady: true });
  if (picked.stale.length) recordDecision({ agent: picked.stale[picked.stale.length - 1].agent, outcome: 'stale', kind: 'message' });
  if (!picked.toNotify.length) return;
  const stored = loadNotifySettings();
  const settings = { ...stored, muted: mutedAgents(stored, profileKey) };
  const presence = { windowFocused: appActive(), openConversation: snap.ledger.open };
  const minutes = localMinutes();
  const groups = groupByAgent(picked.toNotify).filter(g => {
    const d = decideWithReason(g.agent, presence, settings, minutes);
    if (!d.notify) recordDecision({ agent: g.agent, outcome: d.reason as DecisionOutcome, kind: 'message' });
    return d.notify;
  }).map(g => ({ ...g, body: plainTextForNotification(g.body) }));
  if (!groups.length) return;
  const acc = accumulate(buckets, groups, { mode: stored.mode, profileKey, sound: stored.soundEnabled });
  buckets = acc.buckets;
  const now = Date.now();
  const plans = acc.posts.map(post => {
    // 任务终态先到、消息后到:这条消息通知就是那次完成/失败的提醒,标题加标签(不另发一条)。
    const paired = onMessagePosted(pairs, post.agent, { identifier: post.identifier, body: post.body, channelId: post.channelId }, now);
    pairs = paired.state;
    return { post: paired.mark ? { ...post, title: taskLabel(paired.mark) } : post, kind: paired.mark ? (paired.mark.outcome === 'done' ? 'task_done' as const : 'task_failed' as const) : 'message' as const };
  });
  void deliver(plans);
}

type Plan = { post: Parameters<typeof postNotification>[0] & { agent: string }; kind: 'message' | 'task_done' | 'task_failed' };

/** 发出去之前先看权限(没权限时 scheduleNotificationAsync 在安卓上不报错也不显示 —— 以前就是这么「静默」的)。 */
async function deliver(plans: Plan[]): Promise<void> {
  if (!plans.length) return;
  let status: string = 'unknown';
  try { status = (await notificationPermission()).status; } catch (e) { recordError(e, 'getPermissionsAsync'); }
  patchNotifyDiagnostics({ permission: status });
  for (const { post, kind } of plans) {
    if (status !== 'granted' && status !== 'unknown') { recordDecision({ agent: post.agent, outcome: 'no_permission', kind }); continue; }
    try {
      await postNotification(post);
      const d = getDiag();
      patchNotifyDiagnostics({ postedCount: d.postedCount + 1, lastPostedAt: Date.now() });
      recordDecision({ agent: post.agent, outcome: 'notified', kind, detail: post.title });
    } catch (e) {
      recordError(e, 'scheduleNotificationAsync');
      recordDecision({ agent: post.agent, outcome: 'error', kind, detail: errorText(e) });
    }
  }
}

// ── 任务终态 ──
function onTasks(tasks: Parameters<typeof pickTaskFinishes>[1]): void {
  if (!cfg) return;
  const picked = pickTaskFinishes(taskSeen, tasks, cfg.username ?? '', Date.now());
  taskSeen = picked.seen;
  for (const f of picked.finished) {
    const res = onTaskFinished(pairs, f, Date.now());
    pairs = res.state;
    if (res.action === 'relabel') relabelMessage(f);
  }
}

/** 消息通知刚为这个 agent 发过:原地把它的标题换成「✅/❌ …」,走静默渠道(已经响过一次了)。 */
function relabelMessage(f: TaskFinish): void {
  const bucket = buckets[f.agent];
  if (!bucket) return; // 已经被打开/清掉了:不再补
  const plan: Plan = {
    post: {
      agent: f.agent,
      identifier: notificationIdentifier(profileKey, f.agent),
      title: taskLabel(f),
      body: summaryBody(bucket.count, bucket.preview),
      channelId: QUIET_CHANNEL_ID,
      alert: false,
      data: { kind: NOTIFICATION_KIND, alias: f.agent, profileKey },
    },
    kind: f.outcome === 'done' ? 'task_done' : 'task_failed',
  };
  void deliver([plan]);
}

/** 等不到对应消息的任务终态(失败/超时常常没有回复行):单独发一条任务通知,点它进任务详情。 */
function flushExpiredTaskMarks(): void {
  if (!cfg) return;
  const res = takeExpiredMarks(pairs, Date.now());
  pairs = res.state;
  if (!res.expired.length) return;
  const stored = loadNotifySettings();
  const settings = { ...stored, muted: mutedAgents(stored, profileKey) };
  const presence = { windowFocused: appActive(), openConversation: getUnreadSnapshot().ledger.open };
  const minutes = localMinutes();
  const plans: Plan[] = [];
  for (const m of res.expired) {
    const kind = m.outcome === 'done' ? 'task_done' as const : 'task_failed' as const;
    const d = decideWithReason(m.agent, presence, settings, minutes);
    if (!d.notify) { recordDecision({ agent: m.agent, outcome: d.reason as DecisionOutcome, kind }); continue; }
    const alert = stored.soundEnabled;
    plans.push({
      post: {
        agent: m.agent,
        identifier: taskNotificationIdentifier(profileKey, m.taskId),
        title: taskLabel(m),
        body: m.outcome === 'done' ? '点开查看结果' : '点开查看失败原因',
        channelId: alert ? MESSAGE_CHANNEL_ID : QUIET_CHANNEL_ID,
        alert,
        data: { kind: TASK_NOTIFICATION_KIND, alias: m.agent, profileKey, taskId: m.taskId } as any,
      },
      kind,
    });
  }
  void deliver(plans);
}

// ── 点通知 ──
function deliverRoute(): void {
  const handler = routeHandler;
  const taken = takeRoute(taps, { loggedIn: !!cfg, uiAttached: !!handler, profileKey });
  taps = taken.queue;
  if (!taken.consumed) return;
  void clearLastNotificationTap();
  if (taken.alias && handler) handler(taken.alias, taken.taskId);
}

function onTap(data: unknown, key: string): void {
  taps = receiveTap(taps, data, key);
  deliverRoute();
}

function bindTaps(): void {
  if (tapsBound || !mobileNotificationsSupported()) return;
  tapsBound = true;
  void subscribeNotificationTaps(onTap).catch(() => { tapsBound = false; });
}

// ── 前台服务 ──
function onSettingsChanged(): void {
  const s = loadNotifySettings();
  if (Platform.OS === 'android' && lastDndBypass !== null && lastDndBypass !== s.dndBypass) {
    void reapplyNotificationChannels().catch(e => recordError(e, 'setNotificationChannelAsync'));
  }
  lastDndBypass = s.dndBypass;
  syncKeepAlive();
}

function syncKeepAlive(): void {
  if (Platform.OS !== 'android') return;
  const s = loadNotifySettings();
  const wanted = keepAliveWanted({ platform: Platform.OS, loggedIn: !!cfg, enabled: s.enabled, keepAlive: s.keepAlive });
  if (wanted && !keepAliveRunning()) startKeepAlive();
  else if (!wanted && (keepAliveRunning() || keepAliveTaskActive())) stopKeepAlive();
  schedule();
}

// ── 权限:登录之后第一次,弹一次 ──
async function maybeAutoRequestPermission(): Promise<void> {
  const s = loadNotifySettings();
  if (!cfg) return;
  const { status } = await notificationPermission();
  if (!shouldAutoRequestPermission({ platform: Platform.OS, loggedIn: !!cfg, enabled: s.enabled, prompted: s.permissionPrompted, status })) return;
  saveNotifySettings({ ...loadNotifySettings(), permissionPrompted: true });
  await requestNotificationPermission();
}

function stopRuntime(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  for (const u of unsubs) u();
  unsubs = [];
  setNotifierRefreshHandler(null);
  patchNotifyDiagnostics({ runtimeRunning: false });
}

/**
 * 换账号 / 登录 / 登出(null)。同一账号重复设置是空操作 —— 主题切换会让组件重挂,不能因此重新登记快照。
 */
export async function setNotifierConfig(next: HubConfig | null): Promise<void> {
  if (!mobileNotificationsSupported()) return;
  if (configKey(next) === configKey(cfg)) return;
  stopRuntime();
  const nextProfile = notifyProfileKey(next);
  if (nextProfile !== profileKey) {
    seen = initialSeen();
    buckets = {};
    taskSeen = initialTaskSeen();
    pairs = initialPairState();
  }
  firstRoundDone = false;
  cfg = next;
  profileKey = nextProfile;
  patchNotifyDiagnostics({ platform: Platform.OS, profileKey: nextProfile, baselineReady: seen.seeded });
  if (!next) { syncKeepAlive(); return; }
  await hydrateNativeNotifySettings();
  if (cfg !== next) return;
  lastDndBypass = loadNotifySettings().dndBypass;
  bindTaps();
  try {
    await ensureNotificationSetup();
    patchNotifyDiagnostics({ setupOk: true, setupError: null });
  } catch (e) {
    // 渠道建不成也不影响拉消息;但要看得见(0.2.107 这里什么都不记)。
    patchNotifyDiagnostics({ setupOk: false, setupError: errorText(e) });
    recordError(e, 'ensureNotificationSetup');
  }
  if (cfg !== next) return;
  const onAppState = (status: AppStateStatus) => {
    patchNotifyDiagnostics({ appState: status });
    if (status === 'active') {
      clearViewed();
      // 从系统「勿扰权限」页回来:权限可能刚授予,bypassDnd 要再下发一次才生效。
      if (Platform.OS === 'android' && loadNotifySettings().dndBypass) void reapplyNotificationChannels().catch(e => recordError(e, 'setNotificationChannelAsync'));
      void fetchOnce(true).finally(schedule);
    } else schedule();
  };
  const appSub = AppState.addEventListener('change', onAppState);
  unsubs.push(() => appSub.remove());
  unsubs.push(subscribeUnread(onSnapshot));
  unsubs.push(subscribeNotifySettings(onSettingsChanged));
  patchNotifyDiagnostics({ runtimeRunning: true, runtimeStartedAt: Date.now(), appState: AppState.currentState ?? null });
  setNotifierRefreshHandler(() => { void fetchOnce(true); });
  onSnapshot();
  syncKeepAlive();
  // 第一轮强制拉(不因 Agent 列表刚拉过而跳过):首份快照要等本账号第一轮结束才登记(baselineReady),
  // 跳过这一轮 = 登记拖到下一拍,期间到达的消息会被当成「启动前就有的」吞掉。
  void fetchOnce(true).finally(schedule);
  deliverRoute();
  void maybeAutoRequestPermission().catch(() => { /* 权限框没弹出来不是错误 */ });
}

/**
 * 界面挂上来:登记「跳到某个会话」的回调,并把冷启动时那次点通知交给它。
 * 返回卸载函数 —— 只摘回调,不停运行时(停不停由 setNotifierConfig(null) / 「保持连接」决定)。
 */
export function attachNotifierUi(onRoute: RouteHandler): () => void {
  routeHandler = onRoute;
  bindTaps();
  deliverRoute();
  return () => { if (routeHandler === onRoute) routeHandler = null; };
}

function getDiag() {
  return getNotifyDiagnosticsState();
}

/**
 * 设置 →「通知诊断」打开时调:把权限、渠道、勿扰、前台服务的**现场读数**写进诊断。
 * 与运行时共用 notify-diagnostics 那一份状态(面板和「复制诊断信息」读的都是它)。
 */
export async function refreshNotifyDiagnostics(): Promise<void> {
  const s = loadNotifySettings();
  const patch: Parameters<typeof patchNotifyDiagnostics>[0] = {
    platform: Platform.OS,
    keepAliveSetting: s.keepAlive,
    keepAliveRunning: keepAliveRunning(),
    keepAliveTaskActive: keepAliveTaskActive(),
    appState: AppState.currentState ?? null,
    dndAccess: dndAccessGranted(),
    interruptionFilter: currentInterruptionFilter(),
  };
  if (mobileNotificationsSupported()) {
    try { patch.permission = (await notificationPermission()).status; } catch (e) { recordError(e, 'getPermissionsAsync'); }
    try { patch.channels = await readNotificationChannels([...NOTIFICATION_CHANNELS.map(c => c.id), ...LEGACY_CHANNEL_IDS]); } catch (e) { recordError(e, 'getNotificationChannelAsync'); }
  }
  patchNotifyDiagnostics(patch);
}

/** 当前账号键(测试 / 调试用)。 */
export function notifierProfileKey(): string {
  return profileKey;
}

// 进程由前台服务直接拉起(系统重启了被杀的进程,没有界面):自己从存储里恢复账号。
setKeepAliveBootHook(async () => {
  if (cfg) return;
  const [saved, settings] = await Promise.all([loadConfig().catch(() => null), hydrateNativeNotifySettings()]);
  if (cfg) return;
  if (saved && keepAliveWanted({ platform: Platform.OS, loggedIn: true, enabled: settings.enabled, keepAlive: settings.keepAlive })) {
    await setNotifierConfig(saved);
  } else {
    stopKeepAlive();
  }
});

/** 设置页「发送测试通知」:走和真消息同一个渠道,确认横幅/声音/锁屏的系统设置。 */
export async function sendTestNotification(): Promise<void> {
  try {
    await sendTestNotificationInner();
    const d = getDiag();
    patchNotifyDiagnostics({ postedCount: d.postedCount + 1, lastPostedAt: Date.now() });
  } catch (e) {
    recordError(e, '测试通知');
    throw e;
  }
}

async function sendTestNotificationInner(): Promise<void> {
  await ensureNotificationSetup();
  await postNotification({
    identifier: 'anet-test',
    title: 'Agent Network',
    body: '测试通知:agent 给你发消息时,会像这样提醒你。',
    channelId: MESSAGE_CHANNEL_ID,
    alert: true,
    data: { kind: 'anet-test', alias: '', profileKey },
  });
}
