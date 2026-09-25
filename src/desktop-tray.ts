// 0.2.76 桌面端托盘接线:订阅 unread-store,快照变化 → 算模型 → 变了才 invoke `tray_update`;
// 托盘菜单点某个 agent → Rust 聚焦主窗口并 emit `tray-open-chat` → 这里回调打开会话。
// 只在 Tauri 主窗口生效(分离聊天窗/工作区窗不接托盘)。

import { createTrayPusher, trayModelFrom, type TrayModel } from './tray-menu-model';
import { getUnreadSnapshot, subscribeUnread, type UnreadStoreSnapshot } from './unread-store';
import { agentUnreadCounts } from './agent-unread-counts';
import { ackAgentUnread } from './agent-ack';
import { ackAgentMessages, ackUserMessages, type HubConfig } from './api';
import { markAgentServerUnreadCleared, unackedIdsForAgent } from './unread-store';

export const isTauriDesktop = (): boolean => !!(globalThis as any).__TAURI_INTERNALS__;

/**
 * 每个 agent 的角标数,只挑 > 0 的。实现在 agent-unread-counts.ts —— 节点列表「新消息」组用的是
 * **同一个函数**,所以托盘和列表永远同一组会话。
 */
export function trayCountsFrom(snap: UnreadStoreSnapshot): Record<string, number> {
  return agentUnreadCounts(snap);
}

const pusher = createTrayPusher(async model => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tray_update', { total: model.total, items: model.items });
});

export function pushTrayModel(model: TrayModel): Promise<void> {
  return pusher.push(model);
}

/**
 * 0.2.82:面板的「忽略全部」。面板窗口没有 hub 配置也没有 token,所以它只发事件,
 * 真正的 agent 级 ack 在主窗口这里做 —— 用的就是打开会话时那条同一条路
 * (`ackAgentUnread`),老 hub 不认 `{agent}` 时同样退回按 id。
 */
export async function dismissAllUnread(deps: {
  targets: () => string[];
  ack: (alias: string) => Promise<unknown>;
}): Promise<number> {
  let done = 0;
  for (const alias of deps.targets()) {
    try {
      await deps.ack(alias);
      done++;
    } catch (error) {
      console.warn('tray dismiss-all failed for', alias, error);
    }
  }
  return done;
}

/** 挂上托盘同步 + 菜单点击回调;返回卸载函数。 */
export function bindDesktopTray(onOpenChat: (alias: string) => void, onDismissAll?: () => void): () => void {
  if (!isTauriDesktop()) return () => {};
  let stopped = false;
  const sync = () => {
    if (stopped) return;
    void pushTrayModel(trayModelFrom(trayCountsFrom(getUnreadSnapshot()))).catch(error => console.warn('tray update failed', error));
  };
  const unsubscribe = subscribeUnread(sync);
  sync();
  // 窗口重新获得焦点 / 页面重新可见时强制重推一次:任何一次推送失败或 Rust 侧状态丢失,
  // 都会在用户回到应用时被纠正,而不是一直挂着旧角标。
  const resync = () => {
    if (stopped) return;
    void pusher.resync(trayModelFrom(trayCountsFrom(getUnreadSnapshot()))).catch(error => console.warn('tray resync failed', error));
  };
  const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') resync(); };
  globalThis.addEventListener?.('focus', resync);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  let unlisten: (() => void) | undefined;
  void import('@tauri-apps/api/event').then(async events => {
    if (stopped) return;
    const stopOpen = await events.listen<string>('tray-open-chat', ({ payload }) => {
      if (typeof payload === 'string' && payload.trim()) onOpenChat(payload.trim());
    });
    const stopDismiss = await events.listen('tray-dismiss-all', () => { onDismissAll?.(); });
    unlisten = () => { stopOpen(); stopDismiss(); };
    if (stopped) unlisten();
  }).catch(error => console.warn('tray listener failed', error));
  return () => {
    stopped = true;
    unsubscribe();
    unlisten?.();
    globalThis.removeEventListener?.('focus', resync);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

/** 面板「忽略全部」的实际接线:目标 = 托盘此刻列出的 agent,清法 = 会话里同一条 agent 级 ack。 */
export function dismissAllForConfig(cfg: HubConfig): Promise<number> {
  return dismissAllUnread({
    targets: () => Object.keys(trayCountsFrom(getUnreadSnapshot())),
    ack: alias => ackAgentUnread(alias, {
      ackAgent: agent => ackAgentMessages(cfg, agent),
      ackIds: ids => ackUserMessages(cfg, ids),
      idsFor: agent => unackedIdsForAgent(agent),
      clearServerUnread: agent => markAgentServerUnreadCleared(agent),
      warn: (message, error) => console.warn(message, error),
    }),
  });
}
