// #499 到期提醒的系统通知 —— 纯逻辑,不 import react-native / expo。
//
// #686 把「任务提醒」发的到期提醒(system-notice.ts)从 agent 链路里摘掉了,只在应用开着时弹顶部提示。
// 手机通知按 agent 分组(mobile-notify-model.accumulate),这种没有会话的行进不去 ⇒ 应用在后台时一点动静都没有。
// 这里补上:
//   · 路由 —— 发信人是「任务提醒」(+ kind=task_due)走这里;负责 Agent 别名发的到期提醒照旧是那个 agent 的
//     消息(走原来的分组通知,点它进会话,会话里的气泡带「查看任务 ›」);其余消息与这里无关。
//   · 解析 —— 用户流事件(desktop-message-consume 的 notice)或 user_inbox 行(轮询)→ DueReminder;
//   · 判定 —— 通知总开关 / 免打扰时段与 agent 消息同一份判据(notify-policy.decideWithReason);
//     应用在前台且这条是用户流推来的 ⇒ 顶部提示已经弹了,不再发系统通知;
//   · 发什么 —— 标题「任务提醒」、正文 = 提醒原文,data 带 requirementId,点它打开那张任务;
//   · 桌面 —— 点系统通知只会回报一个 alias(Rust chat_notify 的 tray-open-chat),把任务编码进 alias。

import { taskNoticeOf } from './human-dm';
import { DUE_REMINDER_KIND, DUE_REMINDER_SENDER, isSystemNotice, isSystemNoticeRow } from './system-notice';
import { decideWithReason, FRESH_WINDOW_MS, hubTsToMs, type DecisionReason } from './notify-policy';
import type { QuietHours } from './quiet-hours';
import { plainTextForNotification } from './notify-text';
import { MESSAGE_CHANNEL_ID, QUIET_CHANNEL_ID } from './mobile-notify-model';

/** 系统通知的标题(也是 Hub 的发信人名)。 */
export const DUE_NOTIFICATION_TITLE = DUE_REMINDER_SENDER;
/** 系统通知 data.kind:点它打开任务卡片。 */
export const DUE_NOTIFICATION_KIND = 'anet-task-due';

export type DueReminder = {
  messageId: string;
  /** 正文:Hub 推的提醒原文(没有就用标题)。 */
  body: string;
  /** Hub 的 title(「任务已逾期」等),只做正文兜底。 */
  hubTitle: string | null;
  requirementId: string | null;
  networkId: string | null;
  createdAt: string | null;
};

/** 一条到期提醒往哪走:system = 本模块发系统通知;agent = 负责 Agent 发的,走 agent 消息通知;none = 不是到期提醒。 */
export function dueReminderRoute(n: { kind?: string | null; from?: string | null } | null | undefined): 'system' | 'agent' | 'none' {
  if (!n || n.kind !== DUE_REMINDER_KIND) return 'none';
  return isSystemNotice(n) ? 'system' : 'agent';
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 用户流上的 desktop_message(已解析)→ DueReminder;不是「任务提醒」发的 → null。 */
export function dueReminderFromNotice(notice: {
  messageId: string; message: string; title?: string | null; from?: string | null; kind?: string | null; createdAt?: string | null;
  taskNotice?: { requirementId: string; networkId: string | null } | null;
} | null | undefined): DueReminder | null {
  if (!notice || !isSystemNotice(notice) || !notice.messageId) return null;
  const body = text(notice.message) || text(notice.title);
  if (!body) return null;
  return {
    messageId: notice.messageId,
    body,
    hubTitle: text(notice.title) || null,
    requirementId: notice.taskNotice?.requirementId ?? null,
    networkId: notice.taskNotice?.networkId ?? null,
    createdAt: notice.createdAt ?? null,
  };
}

/** user_inbox 的一行(轮询读到的)→ DueReminder;不是系统通知行 → null。meta_json 是字符串或对象都认。 */
export function dueReminderFromRow(row: Record<string, unknown> | null | undefined): DueReminder | null {
  if (!row || !isSystemNoticeRow(row)) return null;
  const messageId = text(row.message_id);
  const body = text(row.content) || text(row.title);
  if (!messageId || !body) return null;
  const ref = taskNoticeOf(row.meta_json ?? row.meta);
  return {
    messageId,
    body,
    hubTitle: text(row.title) || null,
    requirementId: ref?.requirementId ?? null,
    networkId: ref?.networkId ?? null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  };
}

// ── 轮询这一路的去重 / 首份登记 ──
export type DueSeen = { seeded: boolean; ids: Set<string> };
export const DUE_SEEN_CAP = 500;
export const initialDueSeen = (): DueSeen => ({ seeded: false, ids: new Set() });

/** 记下一条(用户流或轮询任一路先看到的)。返回 true = 第一次见。 */
export function markDueSeen(seen: DueSeen, messageId: string): boolean {
  if (seen.ids.has(messageId)) return false;
  seen.ids.add(messageId);
  if (seen.ids.size > DUE_SEEN_CAP) {
    const first = seen.ids.values().next().value;
    if (first !== undefined) seen.ids.delete(first);
  }
  return true;
}

/**
 * 轮询读到的系统通知行 → 要发的。首轮只登记(登录时已有的提醒不弹一屏,与 agent 消息同一条规矩);
 * 已读(acked)的不发;超过 FRESH_WINDOW_MS 才读到的记 stale 不发。会改 seen(运行时的单例状态)。
 */
export function pickDueRows(seen: DueSeen, rows: ReadonlyArray<Record<string, unknown>>, nowMs: number): { toNotify: DueReminder[]; stale: DueReminder[] } {
  const toNotify: DueReminder[] = [];
  const stale: DueReminder[] = [];
  const seeding = !seen.seeded;
  seen.seeded = true;
  for (const row of rows) {
    const rem = dueReminderFromRow(row);
    if (!rem) continue;
    if (!markDueSeen(seen, rem.messageId)) continue;
    if (seeding || Number(row.acked) === 1) continue;
    const ms = hubTsToMs(rem.createdAt);
    if (ms !== null && nowMs - ms > FRESH_WINDOW_MS) { stale.push(rem); continue; }
    toNotify.push(rem);
  }
  return { toNotify, stale };
}

export type DueSkipReason = Exclude<DecisionReason, 'notify'> | 'foreground_notice';

export type DuePost = {
  identifier: string;
  title: string;
  body: string;
  alert: boolean;
  channelId: string;
  data: { kind: string; alias: string; profileKey: string; requirementId: string | null; networkId: string | null; messageId: string };
};

export function dueNotificationIdentifier(profileKey: string, messageId: string): string {
  return `anet-due:${profileKey}:${messageId}`;
}

/**
 * 发不发、发什么。source = 'stream'(用户流推来,应用此刻会弹顶部提示)/ 'poll'(轮询补到的,没有顶部提示)。
 * foreground = 应用在前台(手机 AppState active / 桌面窗口有焦点)。
 */
export function planDueReminder(
  rem: DueReminder,
  ctx: {
    profileKey: string;
    foreground: boolean;
    source: 'stream' | 'poll';
    settings: { enabled?: boolean; soundEnabled: boolean; quiet: QuietHours };
    minutes: number;
  },
): { post: DuePost } | { skip: DueSkipReason } {
  const d = decideWithReason(DUE_REMINDER_SENDER, { windowFocused: false, openConversation: null }, ctx.settings, ctx.minutes);
  if (!d.notify) return { skip: d.reason as DueSkipReason };
  if (ctx.foreground && ctx.source === 'stream') return { skip: 'foreground_notice' };
  const alert = ctx.settings.soundEnabled;
  return {
    post: {
      identifier: dueNotificationIdentifier(ctx.profileKey, rem.messageId),
      title: DUE_NOTIFICATION_TITLE,
      body: plainTextForNotification(rem.body, 200) || rem.hubTitle || DUE_NOTIFICATION_TITLE,
      alert,
      channelId: alert ? MESSAGE_CHANNEL_ID : QUIET_CHANNEL_ID,
      data: { kind: DUE_NOTIFICATION_KIND, alias: '', profileKey: ctx.profileKey, requirementId: rem.requirementId, networkId: rem.networkId, messageId: rem.messageId },
    },
  };
}

/** 点系统通知 → 要打开的任务(只认本模块发的、当前账号的、带任务 id 的)。 */
export function dueRouteFromNotificationData(data: unknown, currentProfileKey: string): { requirementId: string; networkId: string | null } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== DUE_NOTIFICATION_KIND) return null;
  if (typeof d.profileKey === 'string' && d.profileKey !== currentProfileKey) return null;
  const requirementId = text(d.requirementId);
  if (!requirementId) return null;
  return { requirementId, networkId: text(d.networkId) || null };
}

// ── 桌面:系统通知点击只回报 alias(Rust chat_notify → tray-open-chat),任务编码进去 ──
const TASK_ALIAS_PREFIX = 'anet-task:';

export function taskOpenAlias(ref: { requirementId: string; networkId: string | null }): string {
  return `${TASK_ALIAS_PREFIX}${encodeURIComponent(ref.networkId ?? '')}:${encodeURIComponent(ref.requirementId)}`;
}

export function parseTaskOpenAlias(alias: string): { requirementId: string; networkId: string | null } | null {
  if (typeof alias !== 'string' || !alias.startsWith(TASK_ALIAS_PREFIX)) return null;
  const rest = alias.slice(TASK_ALIAS_PREFIX.length);
  const i = rest.indexOf(':');
  if (i < 0) return null;
  try {
    const networkId = decodeURIComponent(rest.slice(0, i));
    const requirementId = decodeURIComponent(rest.slice(i + 1));
    return requirementId ? { requirementId, networkId: networkId || null } : null;
  } catch {
    return null;
  }
}

/** 设备上排查用的一行日志(adb logcat / Xcode 控制台 / 桌面 devtools 里 grep `[anet-notify] task_due`)。 */
export function dueLogLine(e: { source: 'stream' | 'poll'; outcome: string; messageId: string; requirementId: string | null; platform: string; appState?: string | null }): string {
  return `[anet-notify] task_due source=${e.source} outcome=${e.outcome} msg=${e.messageId} req=${e.requirementId ?? '-'} platform=${e.platform} app=${e.appState ?? '-'}`;
}
