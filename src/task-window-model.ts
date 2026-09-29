// 「在新窗口打开」任务(桌面 Tauri)—— 纯逻辑,不 import react-native / tauri。
// Tauri 那一半是 task-window.ts,窗口里的页面是 TaskWindow.tsx。
//
// 同 #464 的图片预览窗口:
//   · 每个任务一个窗口,标签 task-<hash(账号, 任务 id)>;再点同一个任务 = 聚焦已开的那个。
//   · URL 只是 /?taskWindow=1,里面没有任务、没有账号、更没有 token。窗口页起来后发 READY(带自己的标签),
//     开窗的那个窗口回 SHOW(任务 id + 账号 profileId + Hub 地址 + 网络);token 由新窗口自己从凭据库读。
//   · 任何窗口写成功一次(保存 / 移列 / 检查项 / 批量),广播 CHANGED;别的窗口里同一账号同一网络的看板马上重读。
import { sameServer } from './image-window-model';

export const TASK_WINDOW_URL = '/?taskWindow=1';
export const TASK_WINDOW_READY_EVENT = 'task-window:ready';
export const TASK_WINDOW_SHOW_EVENT = 'task-window:show';
export const TASK_WINDOW_CHANGED_EVENT = 'task-window:changed';
/** 开窗时的大小:放得下详情一整列 + 描述全屏按钮;比抽屉(420)宽得多,读长描述舒服。 */
export const TASK_WINDOW_SIZE = { width: 880, height: 860 } as const;
export const TASK_WINDOW_MIN = { width: 520, height: 560 } as const;

export function readTaskWindowRoute(search: string): boolean {
  try { return new URLSearchParams(search).get('taskWindow') === '1'; } catch { return false; }
}

/** 同一账号(profileId)的同一个任务 → 同一个标签;标签只用 [a-z0-9-](Tauri 标签的字符集)。 */
export function taskWindowLabel(profileId: string | undefined, taskId: string): string {
  let hash = 5381;
  for (const ch of `task\0${profileId ?? ''}\0${taskId}`) hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
  return `task-${(hash >>> 0).toString(16)}`;
}

export type TaskWindowPayload = {
  taskId: string;
  profileId?: string;
  serverUrl: string;
  networkId?: string;
  /** 任务名(窗口标题;窗口读到 Hub 的行后以 Hub 为准)。 */
  title: string;
  at: number;
};

/** 事件里来的东西不可信:形状不对就不认;任何像凭据的字段一律丢掉(本来也不该有)。 */
export function parseTaskWindowPayload(raw: unknown): TaskWindowPayload | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.taskId !== 'string' || !r.taskId || typeof r.serverUrl !== 'string' || !/^https?:\/\//i.test(r.serverUrl)) return null;
  return {
    taskId: r.taskId,
    serverUrl: r.serverUrl,
    title: typeof r.title === 'string' ? r.title : '',
    at: typeof r.at === 'number' ? r.at : 0,
    ...(typeof r.profileId === 'string' && r.profileId ? { profileId: r.profileId } : {}),
    ...(typeof r.networkId === 'string' && r.networkId ? { networkId: r.networkId } : {}),
  };
}

export const taskWindowTitle = (name: string): string => `${name.trim() || '任务'} · Agent Network`;

export type TaskChanged = { profileId?: string; serverUrl: string; networkId?: string; from: string };

export function parseTaskChanged(raw: unknown): TaskChanged | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.serverUrl !== 'string' || typeof r.from !== 'string') return null;
  return {
    serverUrl: r.serverUrl,
    from: r.from,
    ...(typeof r.profileId === 'string' && r.profileId ? { profileId: r.profileId } : {}),
    ...(typeof r.networkId === 'string' && r.networkId ? { networkId: r.networkId } : {}),
  };
}

/** 这条「有东西改了」是不是说我这块看板(同一账号、同一 Hub、同一网络),而且不是我自己发的。 */
export function changeConcernsMe(change: TaskChanged, me: { label: string; profileId?: string; serverUrl: string; networkId?: string }): boolean {
  if (change.from === me.label) return false;
  if ((change.profileId ?? '') !== (me.profileId ?? '')) return false;
  if (!sameServer(change.serverUrl, me.serverUrl)) return false;
  return (change.networkId ?? '') === (me.networkId ?? '');
}
