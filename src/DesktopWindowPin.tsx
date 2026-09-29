import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from './icons';
import { colors, radius } from './theme';
import { ds } from './ui-scale';
import { applyStoredPinState, pinStorageKey, togglePinState } from './desktop-window-pin';

// One state per JS context (= per Tauri window): the 📌 button (rail or floating) and the 聊天信息 row
// 「窗口置顶」 (ChatInfoPanel) read and flip the same value.
let state = { pinned: false, busy: false, restored: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
const isTauri = () => Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__;

function restoreOnce() {
  if (state.restored || !isTauri()) return;
  set({ restored: true });
  void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const key = pinStorageKey(win.label);
    const value = await applyStoredPinState(localStorage, key, next => win.setAlwaysOnTop(next));
    set({ pinned: value });
  }).catch(error => console.error('Failed to restore window pin state', error));
}

function toggleWindowPin() {
  if (state.busy) return;
  set({ busy: true });
  void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const next = await togglePinState(state.pinned, localStorage, pinStorageKey(win.label), value => win.setAlwaysOnTop(value));
    set({ pinned: next });
  }).catch(error => console.error('Failed to change window pin state', error))
    .finally(() => set({ busy: false }));
}

/** Tauri 窗口置顶(always-on-top)。available=false:不是桌面壳(手机 / 纯 web)。 */
export function useDesktopWindowPin(): { available: boolean; pinned: boolean; busy: boolean; toggle: () => void } {
  const tauri = isTauri();
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { if (tauri) restoreOnce(); }, [tauri]);
  return { available: tauri, pinned: s.pinned, busy: s.busy, toggle: toggleWindowPin };
}

/**
 * `floating` (the detached chat window, which has no rail): pinned to the window's top-right corner.
 * `rail` (the main workspace): a real slot in the left nav rail. The floating form sat on top of
 * whatever the right pane put in its top-right corner (0.2.124: over 事件与日志's 「已连接」 pill),
 * so the main window never renders it floating — desktop-window-pin-placement.test.ts.
 */
export type WindowPinPlacement = 'floating' | 'rail';

/**
 * `hidden` while a chat is on screen (floating only): there the toggle lives in the 聊天信息 panel
 * (「窗口置顶」), so the chat header keeps a single ⋯ on its right.
 */
export default function DesktopWindowPin({ placement = 'floating', hidden = false }: { placement?: WindowPinPlacement; hidden?: boolean }) {
  const { available, pinned, busy, toggle } = useDesktopWindowPin();
  const styles = useMemo(() => StyleSheet.create({
    button: placement === 'rail' ? {
      width: ds(40), height: ds(40), borderRadius: radius.control, marginBottom: ds(12),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: pinned ? colors.railActiveBg : 'transparent',
      opacity: busy ? 0.55 : 1,
    } : {
      position: 'absolute', top: 10, right: 10, zIndex: 1000,
      width: 34, height: 34, borderRadius: radius.item,
      alignItems: 'center', justifyContent: 'center',
      // 极简:未置顶时是无底无框的图标;置顶时一档中性底色表示「开着」。
      backgroundColor: pinned ? colors.rowActive : 'transparent',
      opacity: busy ? 0.55 : 0.92,
    },
  }), [busy, pinned, placement]);

  if (!available || hidden) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pinned ? '取消窗口置顶' : '窗口置顶'}
      accessibilityState={{ selected: pinned, disabled: busy }}
      disabled={busy}
      style={styles.button}
      testID={`window-pin-${placement}`}
      onPress={toggle}
    >
      <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={placement === 'rail' ? 20 : 17} color={pinned ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}
