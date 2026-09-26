// 0.2.107 手机端(安卓优先,iOS 顺带)系统通知的纯模型。不 import react-native / expo ——
// 副作用(expo-notifications、前台服务)在 mobile-notifications.ts / notifier-runtime.ts。
//
// 「通不通知」本身不在这里判:桌面和手机共用 notify-policy.ts 的 decide(见那边的注释,
// 尤其是「不要加『应用不在前台才提醒』的前置」)。这里只管判完之后:
//   · 合并 —— 一个 agent 一条系统通知(同一个 identifier 重发 = 原地更新,不刷屏),
//     正文前面带「［N 条新消息］」;
//   · 响不响 —— mode 'all' 每条都走高优先级渠道(响铃/横幅);'new' 只有这个 agent 第一条
//     没看的消息响,之后的走静默渠道,只更新计数和预览;
//   · 清 —— 打开那个会话时把它的计数和系统通知一起清掉;
//   · 点通知 —— 从 data 里读出 alias,且只认当前账号的通知;
//   · 权限 —— 什么时候弹 POST_NOTIFICATIONS(登录之后第一次,不在登录页之前);
//   · 后台保持连接 —— 什么时候要起前台服务。

import type { NotifyMode } from './notify-settings';

/**
 * 有声/横幅的消息渠道。🔴 安卓渠道一旦建好,声音和重要性就只能由用户在系统设置里改 —— 应用再调
 * setNotificationChannelAsync 也改不动。0.2.107 用 'agent-messages' 建这条渠道时没写 sound
 * (expo-notifications 不带 sound 键就不调 setSound,全靠系统默认),小米/HyperOS 上建出来是
 * 「声音:无」。已装的机器上那条渠道改不回来,所以换新 id,并删掉旧的(LEGACY_CHANNEL_IDS)。
 * 🔴 以后再改这条渠道的声音/重要性,同样只能换 id(-v3…)并把旧 id 加进 LEGACY_CHANNEL_IDS。
 */
export const MESSAGE_CHANNEL_ID = 'agent-messages-v2';
export const MESSAGE_CHANNEL_NAME = 'Agent 消息';
/** 「仅新消息」模式下,同一个 agent 后续消息走这个渠道:只更新通知,不响铃不弹横幅。 */
export const QUIET_CHANNEL_ID = 'agent-messages-quiet';
export const QUIET_CHANNEL_NAME = 'Agent 消息(同一会话的后续消息)';
/**
 * 旧版本建过、现在要删掉的渠道 id。🔴 删掉的 id 永远不能再用来建渠道:安卓对「删了又用同一个 id
 * 重建」会原样恢复被删时的设置(包括没有声音)。
 */
export const LEGACY_CHANNEL_IDS: readonly string[] = ['agent-messages'];

/** 渠道配置(纯数据;expo 的枚举在 toExpoChannelInput 里按名字换成数值)。 */
export type ChannelSpec = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly importance: 'HIGH' | 'MAX' | 'DEFAULT' | 'LOW';
  /** 'default' = 系统默认提示音(必须显式写上);null = 静音。 */
  readonly sound: 'default' | null;
  readonly enableVibrate: boolean;
  readonly vibrationPattern: readonly number[] | null;
  readonly lockscreenVisibility: 'PUBLIC' | 'PRIVATE';
  readonly showBadge: boolean;
};

export const MESSAGE_CHANNEL: ChannelSpec = {
  id: MESSAGE_CHANNEL_ID,
  name: MESSAGE_CHANNEL_NAME,
  description: 'agent 发来新消息时提醒',
  importance: 'HIGH', // HIGH = 悬浮横幅 + 声音
  sound: 'default',
  enableVibrate: true,
  vibrationPattern: [0, 200, 120, 200],
  lockscreenVisibility: 'PRIVATE', // 与 0.2.107 相同:锁屏上显示「有通知」,不露正文
  showBadge: true,
};

export const QUIET_CHANNEL: ChannelSpec = {
  id: QUIET_CHANNEL_ID,
  name: QUIET_CHANNEL_NAME,
  description: '「仅新消息」模式或提示音关闭时:只更新通知,不响铃',
  importance: 'LOW', // LOW = 通知栏里看得到,不响不弹
  sound: null,
  enableVibrate: false,
  vibrationPattern: null,
  lockscreenVisibility: 'PRIVATE',
  showBadge: true,
};

/** ensureNotificationSetup 在安卓上建的全部渠道(前台服务那条在原生里建,不在这里)。 */
export const NOTIFICATION_CHANNELS: readonly ChannelSpec[] = [MESSAGE_CHANNEL, QUIET_CHANNEL];

type EnumLike = Readonly<Record<string, number | string>>;
export type ChannelEnums = {
  readonly AndroidImportance: EnumLike;
  readonly AndroidNotificationVisibility: EnumLike;
  readonly AndroidAudioUsage: EnumLike;
  readonly AndroidAudioContentType: EnumLike;
};

/** ChannelSpec → setNotificationChannelAsync 的入参。有声渠道显式带 sound + audioAttributes。 */
export function toExpoChannelInput(spec: ChannelSpec, e: ChannelEnums): Record<string, unknown> {
  const input: Record<string, unknown> = {
    name: spec.name,
    description: spec.description,
    importance: e.AndroidImportance[spec.importance],
    sound: spec.sound,
    enableVibrate: spec.enableVibrate,
    vibrationPattern: spec.vibrationPattern ? [...spec.vibrationPattern] : null,
    lockscreenVisibility: e.AndroidNotificationVisibility[spec.lockscreenVisibility],
    showBadge: spec.showBadge,
    bypassDnd: false, // 勿扰模式不绕过:要在勿扰时收到,由用户把本应用加进「例外应用」
  };
  if (spec.sound) {
    input.audioAttributes = { usage: e.AndroidAudioUsage.NOTIFICATION, contentType: e.AndroidAudioContentType.SONIFICATION };
  }
  return input;
}

/** 建全部渠道,再删掉旧版本的渠道。先建后删:删失败(老系统 / 已被用户删)不影响新渠道。 */
export async function setupAndroidChannels(api: {
  enums: ChannelEnums;
  set: (id: string, input: any) => Promise<unknown>;
  del: (id: string) => Promise<unknown>;
}): Promise<void> {
  for (const spec of NOTIFICATION_CHANNELS) await api.set(spec.id, toExpoChannelInput(spec, api.enums));
  for (const id of LEGACY_CHANNEL_IDS) {
    if (NOTIFICATION_CHANNELS.some(c => c.id === id)) continue;
    try { await api.del(id); } catch { /* 没有这条渠道 / 删不掉:不影响新渠道 */ }
  }
}
/** 前台服务那条常驻通知的渠道 —— 在原生 Service 里建(见 modules/anet-keepalive)。 */
export const KEEPALIVE_CHANNEL_ID = 'anet-keepalive';
export const KEEPALIVE_NOTIFICATION_TEXT = 'Agent Network 正在保持连接';

export const NOTIFICATION_KIND = 'anet-agent-message';

export type AgentBucket = { readonly count: number; readonly preview: string };
export type Buckets = Readonly<Record<string, AgentBucket>>;

export type PostPlan = {
  readonly agent: string;
  readonly identifier: string;
  readonly title: string;
  readonly body: string;
  /** true = 响铃/横幅(MESSAGE_CHANNEL);false = 静默更新(QUIET_CHANNEL)。 */
  readonly alert: boolean;
  readonly channelId: string;
  readonly data: { kind: string; alias: string; profileKey: string };
};

export function notificationIdentifier(profileKey: string, agent: string): string {
  return `anet-msg:${profileKey}:${agent}`;
}

/** 正文:一条 = 预览;多条 =「［N 条新消息］预览」。预览空时退回「新消息」字样。 */
export function summaryBody(count: number, preview: string): string {
  const text = (preview || '').trim();
  if (count <= 1) return text || '新消息';
  return text ? `［${count} 条新消息］${text}` : `${count} 条新消息`;
}

/**
 * 把这一轮判定要提醒的分组(notify-policy.groupByAgent 的输出,且已经过 decide)并进各 agent 的桶,
 * 返回新的桶和要发(或原地更新)的系统通知。不改入参。
 */
export function accumulate(
  buckets: Buckets,
  groups: ReadonlyArray<{ agent: string; count: number; body: string }>,
  opts: { mode: NotifyMode; profileKey: string; sound: boolean },
): { buckets: Buckets; posts: PostPlan[] } {
  const next: Record<string, AgentBucket> = { ...buckets };
  const posts: PostPlan[] = [];
  for (const g of groups) {
    const agent = (g.agent || '').trim();
    if (!agent || g.count <= 0) continue;
    const prev = next[agent];
    const count = (prev?.count ?? 0) + g.count;
    const preview = g.body || prev?.preview || '';
    next[agent] = { count, preview };
    // 'new':只有桶是空的(这个 agent 此前没有未清的通知)才响;'all':每次都响。
    // 提示音关(设置里的「消息提示音」)→ 一律走静默渠道:安卓 8+ 的声音由渠道决定,
    // 单条通知的 sound 字段不起作用,所以「不响」只能换渠道。
    const alert = opts.sound && (opts.mode === 'all' || !prev);
    posts.push({
      agent,
      identifier: notificationIdentifier(opts.profileKey, agent),
      title: agent,
      body: summaryBody(count, preview),
      alert,
      channelId: alert ? MESSAGE_CHANNEL_ID : QUIET_CHANNEL_ID,
      data: { kind: NOTIFICATION_KIND, alias: agent, profileKey: opts.profileKey },
    });
  }
  return { buckets: next, posts };
}

/** 打开某个会话:它的桶清空;返回要从通知栏撤掉的 identifier(没有就 null)。 */
export function clearAgent(buckets: Buckets, agent: string, profileKey: string): { buckets: Buckets; dismiss: string | null } {
  if (!agent || !buckets[agent]) return { buckets, dismiss: null };
  const next: Record<string, AgentBucket> = { ...buckets };
  delete next[agent];
  return { buckets: next, dismiss: notificationIdentifier(profileKey, agent) };
}

/**
 * 人此刻正在看的会话(= 该清掉的那个)。应用在前台且开着某个会话才算;
 * 应用在后台时 ledger.open 可能还挂着上次那个会话,那不是「在看」。
 */
export function conversationBeingViewed(open: string | null | undefined, foreground: boolean): string | null {
  return foreground && open ? open : null;
}

/**
 * 点通知 → 该跳去哪个会话(null = 不跳,只把应用拉到前台)。
 * 只认我们自己发的消息通知,且属于当前账号(别的账号的通知点了不能打开一个不存在的会话)。
 */
export function routeFromNotificationData(data: unknown, currentProfileKey: string): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== NOTIFICATION_KIND) return null;
  const alias = typeof d.alias === 'string' ? d.alias.trim() : '';
  if (!alias) return null;
  if (typeof d.profileKey === 'string' && d.profileKey !== currentProfileKey) return null;
  return alias;
}

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * 自动弹系统通知权限的时机:登录后、总开关开、还没弹过、还没授权。
 * 登录页之前不弹(那时连「谁会给你发消息」都还没有,Vincent 明确要求);弹过一次就不再自动弹,
 * 之后只从设置页的开关/按钮触发(permissionOnUserAction)。
 */
export function shouldAutoRequestPermission(input: {
  platform: string;
  loggedIn: boolean;
  enabled: boolean;
  prompted: boolean;
  status: PermissionStatus;
}): boolean {
  if (input.platform !== 'android' && input.platform !== 'ios') return false;
  if (!input.loggedIn || !input.enabled) return false;
  if (input.prompted) return false;
  return input.status !== 'granted';
}

/**
 * 用户在设置页主动开通知 / 点「发送测试通知」:没授权就弹;系统已经不让再弹了(拒绝过且
 * canAskAgain=false)→ 带去应用的系统设置页。
 */
export function permissionOnUserAction(status: PermissionStatus, canAskAgain: boolean): 'none' | 'request' | 'open-settings' {
  if (status === 'granted') return 'none';
  return canAskAgain ? 'request' : 'open-settings';
}

/** 「后台保持连接」前台服务要不要跑:只在安卓、已登录、通知总开关开、且用户开了它。 */
export function keepAliveWanted(input: { platform: string; loggedIn: boolean; enabled: boolean; keepAlive: boolean }): boolean {
  return input.platform === 'android' && input.loggedIn && input.enabled && input.keepAlive;
}

/**
 * 后台轮询间隔(ms);null = 不轮询。前台 10 s(与 Agent 列表同频);后台只有前台服务在跑
 * (JS 计时器才不会被 RN 暂停,见 keep-alive.ts)时才轮询,20 s 一次。
 */
export function watcherIntervalMs(foreground: boolean, keepAliveRunning: boolean): number | null {
  if (foreground) return 10_000;
  return keepAliveRunning ? 20_000 : null;
}

/** 同一份数据最近刚被别处(Agent 列表的轮询)拉过 → 这一拍不重复拉。 */
export function shouldSkipFetch(lastIngestAt: number, nowMs: number, intervalMs: number): boolean {
  return lastIngestAt > 0 && nowMs - lastIngestAt < intervalMs * 0.8;
}

// ── 点通知的排队(冷启动:点击先到,账号恢复和界面挂载后到)──
export type TapQueue = {
  readonly pending: { readonly data: unknown; readonly key: string } | null;
  /** 已经处理过的点击(同一次点击在重挂 / getLastNotificationResponse 重读时会再来一遍)。 */
  readonly handled: ReadonlySet<string>;
};

export const initialTapQueue = (): TapQueue => ({ pending: null, handled: new Set() });

export function receiveTap(q: TapQueue, data: unknown, key: string): TapQueue {
  if (q.handled.has(key)) return q;
  return { ...q, pending: { data, key } };
}

/**
 * 能跳了吗:要已登录(账号恢复完,知道当前账号键)且界面已挂上(有导航可用)。
 * 没就绪 → 原样留着;就绪 → 取出、记为已处理,返回要打开的会话(不是我们的通知 / 别的账号 → null)。
 */
export function takeRoute(
  q: TapQueue,
  ready: { loggedIn: boolean; uiAttached: boolean; profileKey: string },
): { queue: TapQueue; alias: string | null; consumed: boolean } {
  if (!q.pending || !ready.loggedIn || !ready.uiAttached) return { queue: q, alias: null, consumed: false };
  const handled = new Set(q.handled);
  handled.add(q.pending.key);
  return {
    queue: { pending: null, handled },
    alias: routeFromNotificationData(q.pending.data, ready.profileKey),
    consumed: true,
  };
}
