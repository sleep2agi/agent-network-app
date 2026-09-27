import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from './icons';
import { colors } from './theme';
import { ds } from './ui-scale';
import { applyStoredPinState, pinStorageKey, togglePinState } from './desktop-window-pin';

/**
 * `floating` (the detached chat window, which has no rail): pinned to the window's top-right corner.
 * `rail` (the main workspace): a real slot in the left nav rail. The floating form sat on top of
 * whatever the right pane put in its top-right corner (0.2.124: over 事件与日志's 「已连接」 pill),
 * so the main window never renders it floating — desktop-window-pin-placement.test.ts.
 */
export type WindowPinPlacement = 'floating' | 'rail';

export default function DesktopWindowPin({ placement = 'floating' }: { placement?: WindowPinPlacement }) {
  const tauri = Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__;
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => StyleSheet.create({
    button: placement === 'rail' ? {
      width: ds(40), height: ds(40), borderRadius: 10, marginBottom: ds(12),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: pinned ? colors.railActiveBg : 'transparent',
      opacity: busy ? 0.55 : 1,
    } : {
      position: 'absolute', top: 10, right: 10, zIndex: 1000,
      width: 34, height: 34, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
      // 极简:未置顶时是无底无框的图标;置顶时一档中性底色表示「开着」。
      backgroundColor: pinned ? colors.rowActive : 'transparent',
      opacity: busy ? 0.55 : 0.92,
    },
  }), [busy, pinned, placement]);

  useEffect(() => {
    if (!tauri) return;
    let alive = true;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const key = pinStorageKey(win.label);
      const value = await applyStoredPinState(localStorage, key, next => win.setAlwaysOnTop(next));
      if (alive) setPinned(value);
    }).catch(error => console.error('Failed to restore window pin state', error));
    return () => { alive = false; };
  }, [tauri]);

  if (!tauri) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pinned ? '取消窗口置顶' : '窗口置顶'}
      accessibilityState={{ selected: pinned, disabled: busy }}
      disabled={busy}
      style={styles.button}
      testID={`window-pin-${placement}`}
      onPress={() => {
        setBusy(true);
        void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          const next = await togglePinState(pinned, localStorage, pinStorageKey(win.label), value => win.setAlwaysOnTop(value));
          setPinned(next);
        }).catch(error => console.error('Failed to change window pin state', error))
          .finally(() => setBusy(false));
      }}
    >
      <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={placement === 'rail' ? 20 : 17} color={pinned ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}
