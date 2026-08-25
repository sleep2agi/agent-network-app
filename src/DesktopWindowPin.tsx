import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { applyStoredPinState, pinStorageKey, togglePinState } from './desktop-window-pin';

export default function DesktopWindowPin() {
  const tauri = Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__;
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => StyleSheet.create({
    button: {
      position: 'absolute', top: 10, right: 10, zIndex: 1000,
      width: 34, height: 34, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: pinned ? colors.inputBg : colors.card,
      borderColor: pinned ? colors.accent : colors.border,
      borderWidth: 1,
      opacity: busy ? 0.55 : 0.92,
    },
  }), [busy, pinned]);

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
      <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={17} color={pinned ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}
