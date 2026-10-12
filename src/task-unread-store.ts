// 「任务」tab 未读角标的状态与后台读(判据全在 task-unread.ts,这里只接线)。
//
// AppRoot 调一次 useTaskUnreadDriver(当前账号、在不在任务页);手机底栏、安卓左栏、桌面左栏各自用
// useTaskUnreadCount 读同一个数。lastSeen 按账号 + 网络落盘:web(Tauri 桌面 / web 导出)用 localStorage,
// 原生用 documentDirectory 下一个小 JSON(与 agent-list-prefs.ts 同法)。读写都尽力而为:存不下就只在本次有效。
import { useEffect, useSyncExternalStore } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import type { HubConfig } from './api';
import { fetchMyUserId, listRequirementChanges, listRequirementsFull } from './requirements-hub';
import { recallBoard } from './swr-cache';
import { subscribeTaskBoard, taskBoardState, taskScopeKey } from './task-board-store';
import { applyUnreadDelta, applyUnreadList, emptyUnread, markUnreadSeen, planUnreadRead, seenMark, unreadBadgeCount, unreadKey, type UnreadState } from './task-unread';

const SEEN_KEY = 'task_unread_seen_v1';
const SEEN_FILE = () => `${FileSystem.documentDirectory}task_unread_seen_v1.json`;
/** 后台检查的节拍;真正读不读由 planUnreadRead 按间隔决定。 */
const TICK_MS = 15_000;

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

async function readSeenMap(): Promise<Record<string, string>> {
  try {
    const ls = webStorage();
    const raw = ls ? ls.getItem(SEEN_KEY) : FileSystem.documentDirectory && (await FileSystem.getInfoAsync(SEEN_FILE())).exists ? await FileSystem.readAsStringAsync(SEEN_FILE()) : null;
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

let seenWrite: Promise<unknown> = Promise.resolve();
function saveSeen(key: string, lastSeen: string): void {
  seenWrite = seenWrite.then(async () => {
    const map = await readSeenMap();
    if (map[key] === lastSeen) return;
    map[key] = lastSeen;
    const ls = webStorage();
    if (ls) ls.setItem(SEEN_KEY, JSON.stringify(map));
    else if (FileSystem.documentDirectory) await FileSystem.writeAsStringAsync(SEEN_FILE(), JSON.stringify(map));
  }).catch(() => { /* session only */ });
}

let state: UnreadState = emptyUnread('', null);
let meId: string | null = null;
let onTasks = false;
/** 这个 Hub 的 capabilities:看板读到的优先,其次磁盘缓存,再次后台读回来的。 */
let caps: string[] = [];
let count = 0;
const listeners = new Set<() => void>();

const emit = () => {
  const next = unreadBadgeCount(state, meId, onTasks);
  if (next === count) return;
  count = next;
  listeners.forEach(l => l());
};
const setState = (next: UnreadState) => { state = next; emit(); };

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => count;

/** 角标数字(0 = 不显示)。 */
export function useTaskUnreadCount(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 任务页上的看板(当前账号的那份)。 */
const boardFor = (cfg: HubConfig) => {
  const st = taskBoardState();
  return st.scope === taskScopeKey(cfg) && st.loaded ? st : null;
};

/** 在任务页上:按看板现在画出来的卡记 lastSeen(并落盘)。 */
function markFromBoard(cfg: HubConfig): void {
  const board = boardFor(cfg);
  if (!board) return;
  caps = board.capabilities;
  const next = seenMark(board.items, null, state.lastSeen);
  if (next && next !== state.lastSeen) {
    setState(markUnreadSeen(state, next));
    saveSeen(state.key, next);
  }
}

/** 唯一的驱动:AppRoot 里调一次。cfg = null(没登录)时清空。 */
export function useTaskUnreadDriver(cfg: HubConfig | null, onTasksNow: boolean): void {
  const key = cfg ? unreadKey(cfg.profileId, cfg.networkId) : '';

  // 换账号 / 网络:从这个账号自己的 lastSeen 重新开始,别的账号的表和游标一概不带过来。
  useEffect(() => {
    if (!cfg) { meId = null; caps = []; setState(emptyUnread('', null)); return; }
    let alive = true;
    meId = null;
    caps = [];
    setState(emptyUnread(key, null));
    void readSeenMap().then(map => { if (alive && state.key === key && !state.lastSeen && map[key]) setState(markUnreadSeen(state, map[key])); });
    void fetchMyUserId(cfg).then(id => { if (alive && state.key === key) { meId = id; emit(); } });
    void recallBoard(cfg.profileId, cfg.networkId).then(snap => { if (alive && !caps.length && snap?.capabilities?.length) caps = snap.capabilities; });
    return () => { alive = false; };
  }, [key, cfg?.serverUrl, cfg?.token]);

  // 进 / 出任务页:在页上时跟着看板记 lastSeen,离开那一刻再记一次。
  useEffect(() => {
    onTasks = onTasksNow;
    emit();
    if (!cfg || !onTasksNow) return;
    markFromBoard(cfg);
    const off = subscribeTaskBoard(() => markFromBoard(cfg));
    return () => { off(); markFromBoard(cfg); };
  }, [onTasksNow, key, cfg?.serverUrl, cfg?.token]);

  // 不在任务页:按节拍问 Hub 有没有别人改了什么。
  useEffect(() => {
    if (!cfg || onTasksNow) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      const plan = planUnreadRead(caps, state, onTasks, Date.now());
      if (busy || plan.kind === 'none') return;
      busy = true;
      const at = state;
      try {
        if (plan.kind === 'changes') {
          const delta = await listRequirementChanges(cfg, plan.since);
          if (!alive || state !== at) return;
          if (delta.capabilitiesKnown) caps = delta.capabilities;
          setState(applyUnreadDelta(state, delta, Date.now()));
        } else {
          const list = await listRequirementsFull(cfg, { summary: caps.includes('list_summary') });
          if (!alive || state !== at) return;
          caps = list.capabilities;
          setState(applyUnreadList(state, list.rows, Date.now()));
        }
      } catch {
        // 连不上:下一拍再试(不退避:间隔本来就是分钟级)。
        if (alive && state === at) state = { ...state, readAt: Date.now() };
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, TICK_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [onTasksNow, key, cfg?.serverUrl, cfg?.token]);
}
