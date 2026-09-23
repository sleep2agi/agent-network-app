// 0.2.82 托盘面板(飞书式)—— Vincent 2026-09-20「通知用这个啊」+ 飞书通知面板截图。
//
// 形态:左上应用名、右上「忽略全部」、每行 = 圆头像 + 别名 + 右侧红色未读数;点一行 =
// 聚焦主窗口并打开那个会话。0.2.76 那版是**原生菜单**,一行只能是纯文本「N  <alias>」,
// 画不出头像和红点,所以这一版改成自绘窗口。
//
// 🔴 这个窗口是**独立 webview**,和主窗口不共享 JS 上下文 —— 它读不到 unread-store。
//    数据链路:主窗口 → `tray_update`(Rust 存一份)→ 本面板 `tray_panel_model` 取、
//    并订阅 `tray-model` 事件实时更新。所以「数的来源只有一个」这条不变:仍然是
//    主窗口的 unread-store,Rust 只是把它转了一手。面板**不碰 hub、不拿 token**。
//
// 动作同样不在这里落地:点行 → `tray_open_chat`(Rust 复用 0.2.76 那条 `tray-open-chat`
// 事件),点「忽略全部」→ `tray_dismiss_all` → 主窗口用它已有的 agent 级 ack 去清。
// 面板只负责画和转述。
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import AliasAvatar from './AliasAvatar';
import { colors } from './theme';
import { trayPanelModelFrom, type TrayPanelModel } from './tray-panel-model';
import type { TrayItem } from './tray-menu-model';

/** `?tray=1` 的窗口就是托盘面板(只在桌面壳里)。 */
export function readTrayPanelRoute(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    const search = String((globalThis as { location?: { search?: string } }).location?.search ?? '');
    return new URLSearchParams(search).get('tray') === '1';
  } catch {
    return false;
  }
}

const isTauri = () => !!(globalThis as any).__TAURI_INTERNALS__;

async function hidePanel(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tray_panel_hide');
  } catch (error) {
    console.warn('tray panel hide failed', error);
  }
}

export default function TrayPanel() {
  // 🔴 每次渲染重算:`colors` 是就地 mutate 的单例,模块级字面量会把**导入那一刻**的
  //    值(默认 dark)拷走再也不变 —— 浅色模式下面板会一直是深色的。
  const panelStyles = makePanelStyles();
  const [model, setModel] = useState<TrayPanelModel>(() => trayPanelModelFrom([]));
  const [busy, setBusy] = useState(false);

  // 首次取一份 + 订阅后续变化。面板可能在主窗口推送之后才被打开,所以两者都要。
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const items = await invoke<TrayItem[]>('tray_panel_model');
        if (alive) setModel(trayPanelModelFrom(items));
      } catch (error) {
        console.warn('tray panel model failed', error);
      }
      try {
        const events = await import('@tauri-apps/api/event');
        const stop = await events.listen<TrayItem[]>('tray-model', ({ payload }) => {
          if (alive) setModel(trayPanelModelFrom(payload));
        });
        if (alive) unlisten = stop; else stop();
      } catch (error) {
        console.warn('tray panel listen failed', error);
      }
    })();
    return () => { alive = false; unlisten?.(); };
  }, []);

  // Esc 关面板(失焦关闭在 Rust 侧做 —— 那是窗口事件,前端看不到)。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void hidePanel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const openChat = useCallback((alias: string) => {
    void (async () => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('tray_open_chat', { alias });
      } catch (error) {
        console.warn('tray open chat failed', error);
      }
    })();
  }, []);

  const dismissAll = useCallback(() => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        if (isTauri()) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('tray_dismiss_all');
        }
      } catch (error) {
        console.warn('tray dismiss all failed', error);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy]);

  return (
    <View style={panelStyles.root} testID="tray-panel">
      <View style={panelStyles.header}>
        <Text style={panelStyles.brand} numberOfLines={1}>Agent Network</Text>
        {model.empty ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="忽略全部未读"
            testID="tray-dismiss-all"
            disabled={busy}
            onPress={dismissAll}
            style={({ pressed }) => [panelStyles.dismiss, pressed && panelStyles.dismissPressed]}
          >
            <Text style={[panelStyles.dismissText, busy && panelStyles.dismissTextBusy]}>忽略全部</Text>
          </Pressable>
        )}
      </View>
      {model.empty ? (
        <View style={panelStyles.empty} testID="tray-panel-empty">
          <Text style={panelStyles.emptyText}>没有未读消息</Text>
        </View>
      ) : (
        <ScrollView style={panelStyles.list} contentContainerStyle={panelStyles.listContent}>
          {model.rows.map(row => (
            <Pressable
              key={row.alias}
              accessibilityRole="button"
              accessibilityLabel={`打开与 ${row.alias} 的会话，${row.badge?.a11yLabel ?? ''}`}
              testID={`tray-row-${row.alias}`}
              onPress={() => openChat(row.alias)}
              style={({ pressed, hovered }: any) => [
                panelStyles.row,
                (hovered || pressed) && panelStyles.rowActive,
              ]}
            >
              <AliasAvatar alias={row.alias} size={32} />
              <Text style={panelStyles.alias} numberOfLines={1}>{row.alias}</Text>
              {row.badge ? (
                <View style={panelStyles.badge} accessibilityRole="text" accessibilityLabel={row.badge.a11yLabel}>
                  <Text style={panelStyles.badgeText}>{row.badge.text}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makePanelStyles() {
  return {
  root: { flex: 1, backgroundColor: colors.card },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  brand: { color: colors.text, fontSize: 14, fontWeight: '600' as const, flexShrink: 1 },
  dismiss: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  dismissPressed: { opacity: 0.6 },
  dismissText: { color: colors.accent, fontSize: 12 },
  dismissTextBusy: { color: colors.textMuted },
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rowActive: { backgroundColor: colors.railHover },
  alias: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.failed,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' as const },
  empty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 24 },
  emptyText: { color: colors.textMuted, fontSize: 12 },
  };
}
