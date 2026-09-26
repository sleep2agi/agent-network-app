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
import { fetchMessages, fetchUserMessages, replyUnreadSince, type HubConfig } from './api';
import { loadConfig } from './storage';
import {
  decide,
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
  dismissNotification,
  ensureNotificationSetup,
  mobileNotificationsSupported,
  notificationPermission,
  postNotification,
  requestNotificationPermission,
  subscribeNotificationTaps,
} from './mobile-notifications';
import { keepAliveRunning, keepAliveTaskActive, setKeepAliveBootHook, startKeepAlive, stopKeepAlive } from './keep-alive';
import { setNotifierRefreshHandler } from './notifier-bus';
import { getUnreadSnapshot, ingestInboxMessagesBody, ingestUserMessagesBody, subscribeUnread, unreadLastIngestAt } from './unread-store';

type RouteHandler = (alias: string) => void;

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
  try {
    try { if (cfg === c) ingestUserMessagesBody(await fetchUserMessages(c, 50)); } catch { /* 下一拍再试 */ }
    try { if (cfg === c) ingestInboxMessagesBody(await fetchMessages(c, 300, replyUnreadSince()), c.username); } catch { /* 同上 */ }
  } finally {
    fetching = false;
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

function onSnapshot(): void {
  if (!cfg) return;
  clearViewed();
  const snap = getUnreadSnapshot();
  // 与桌面端相同:user_inbox 还没拉到时不登记首份快照,否则随后到达的历史会被当成新消息弹一屏。
  if (!seen.seeded && !snap.serverBody) return;
  const picked = pickNew(seen, incomingFromSnapshot(snap), Date.now());
  seen = picked.seen;
  if (!picked.toNotify.length) return;
  const stored = loadNotifySettings();
  const settings = { ...stored, muted: mutedAgents(stored, profileKey) };
  const presence = { windowFocused: appActive(), openConversation: snap.ledger.open };
  const minutes = localMinutes();
  const groups = groupByAgent(picked.toNotify)
    .filter(g => decide(g.agent, presence, settings, minutes).notify)
    .map(g => ({ ...g, body: plainTextForNotification(g.body) }));
  if (!groups.length) return;
  const acc = accumulate(buckets, groups, { mode: stored.mode, profileKey, sound: stored.soundEnabled });
  buckets = acc.buckets;
  for (const post of acc.posts) void postNotification(post).catch(() => { /* 没权限 / 渠道被关 */ });
}

// ── 点通知 ──
function deliverRoute(): void {
  const handler = routeHandler;
  const taken = takeRoute(taps, { loggedIn: !!cfg, uiAttached: !!handler, profileKey });
  taps = taken.queue;
  if (!taken.consumed) return;
  void clearLastNotificationTap();
  if (taken.alias && handler) handler(taken.alias);
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
  }
  cfg = next;
  profileKey = nextProfile;
  if (!next) { syncKeepAlive(); return; }
  await hydrateNativeNotifySettings();
  if (cfg !== next) return;
  bindTaps();
  try { await ensureNotificationSetup(); } catch { /* 渠道建不成也不影响拉消息 */ }
  if (cfg !== next) return;
  const onAppState = (status: AppStateStatus) => {
    if (status === 'active') { clearViewed(); void fetchOnce(true).finally(schedule); }
    else schedule();
  };
  const appSub = AppState.addEventListener('change', onAppState);
  unsubs.push(() => appSub.remove());
  unsubs.push(subscribeUnread(onSnapshot));
  unsubs.push(subscribeNotifySettings(syncKeepAlive));
  setNotifierRefreshHandler(() => { void fetchOnce(true); });
  onSnapshot();
  syncKeepAlive();
  void fetchOnce(false).finally(schedule);
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
