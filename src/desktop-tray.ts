// 0.2.76 桌面端托盘接线:订阅 unread-store,快照变化 → 算模型 → 变了才 invoke `tray_update`;
// 托盘菜单点某个 agent → Rust 聚焦主窗口并 emit `tray-open-chat` → 这里回调打开会话。
// 只在 Tauri 主窗口生效(分离聊天窗/工作区窗不接托盘)。

import { trayModelEqual, trayModelFrom, type TrayModel } from './tray-menu-model';
import { getUnreadSnapshot, replyUnreadCounts, subscribeUnread, type UnreadStoreSnapshot } from './unread-store';
import { unreadCountForAgentRow } from './unread-badge';
import { readServerUnreadByAgent } from './user-unread';

export const isTauriDesktop = (): boolean => !!(globalThis as any).__TAURI_INTERNALS__;

/** 每个 agent 的角标数(和列表行同一函数算),只挑 > 0 的。 */
export function trayCountsFrom(snap: UnreadStoreSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  const authoritative = readServerUnreadByAgent(snap.serverBody);
  const reply = replyUnreadCounts(snap);
  const aliases = new Set<string>([
    ...Object.keys(authoritative ?? {}),
    ...Object.keys(reply),
    ...Object.keys(snap.ledger.counts),
  ]);
  for (const alias of aliases) {
    if (!alias || alias === 'hub') continue;
    const n = unreadCountForAgentRow(snap.serverBody, snap.ledger, alias, reply);
    if (n > 0) out[alias] = n;
  }
  return out;
}

let last: TrayModel | null = null;

export async function pushTrayModel(model: TrayModel): Promise<void> {
  if (trayModelEqual(last, model)) return;
  last = model;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tray_update', { total: model.total, items: model.items });
}

/** 挂上托盘同步 + 菜单点击回调;返回卸载函数。 */
export function bindDesktopTray(onOpenChat: (alias: string) => void): () => void {
  if (!isTauriDesktop()) return () => {};
  let stopped = false;
  const sync = () => {
    if (stopped) return;
    void pushTrayModel(trayModelFrom(trayCountsFrom(getUnreadSnapshot()))).catch(error => console.warn('tray update failed', error));
  };
  const unsubscribe = subscribeUnread(sync);
  sync();
  let unlisten: (() => void) | undefined;
  void import('@tauri-apps/api/event').then(async events => {
    if (stopped) return;
    unlisten = await events.listen<string>('tray-open-chat', ({ payload }) => {
      if (typeof payload === 'string' && payload.trim()) onOpenChat(payload.trim());
    });
    if (stopped) unlisten();
  }).catch(error => console.warn('tray listener failed', error));
  return () => {
    stopped = true;
    unsubscribe();
    unlisten?.();
  };
}
