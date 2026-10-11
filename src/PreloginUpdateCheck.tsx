import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { APP_VERSION } from './version';
import { colors } from './theme';
import { checkDesktopUpdate, desktopUpdateLastCheckedAt, desktopUpdateSnapshot, subscribeDesktopUpdates } from './desktop-updater';
import { androidUpdateLastCheckedAt, androidUpdateSnapshot, checkAndroidUpdate, subscribeAndroidUpdates } from './android-updater';
import { describeUpdateRow } from './update-check-state';
import { describeAndroidUpdateRow } from './android-update-core';

/** Public software updates are independent of Hub credentials and login form state. */
export default function PreloginUpdateCheck() {
  const desktop = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);
  const android = useSyncExternalStore(subscribeAndroidUpdates, androidUpdateSnapshot, androidUpdateSnapshot);
  const isAndroid = Platform.OS === 'android';
  if (!isAndroid && !(Platform.OS === 'web' && (globalThis as any).__TAURI_INTERNALS__)) {
    return <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>v{APP_VERSION}</Text>;
  }
  const options = { currentVersion: APP_VERSION, now: Date.now() };
  const row = isAndroid
    ? describeAndroidUpdateRow(android, { ...options, lastCheckedAt: androidUpdateLastCheckedAt() })
    : describeUpdateRow(desktop, { ...options, lastCheckedAt: desktopUpdateLastCheckedAt() });
  const color = row.tone === 'danger' ? colors.failed : row.tone === 'accent' ? colors.accent : colors.textSecondary;
  return (
    <View testID="prelogin-update" style={{ alignItems: 'center', gap: 5, paddingTop: 8 }}>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>ANet v{APP_VERSION}</Text>
      <Pressable
        testID="prelogin-update-check"
        accessibilityRole="button"
        accessibilityLabel="检查更新"
        accessibilityState={{ busy: row.busy, disabled: !row.actionable }}
        disabled={!row.actionable}
        style={{ minHeight: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 4 }}
        onPress={() => {
          if (isAndroid) void checkAndroidUpdate(APP_VERSION);
          else void checkDesktopUpdate(undefined, { manual: true });
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {row.busy ? <ActivityIndicator size="small" color={color} /> : null}
          <Text testID="prelogin-update-result" style={{ color, fontSize: 13, textAlign: 'center' }}>{row.label}</Text>
        </View>
        {row.detail ? <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>{row.detail}</Text> : null}
      </Pressable>
    </View>
  );
}
