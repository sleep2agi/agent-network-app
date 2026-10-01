// 顶层错误边界的 RN 外壳:兜底页「出错了 · 重新加载」。状态流转在 fatal-boundary.ts。
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { t } from './i18n';
import './i18n-fatal';
import { FatalBoundaryCore } from './fatal-boundary';
import { recordFatal } from './fatal-runtime';

const record = (error: unknown, componentStack?: string | null) => recordFatal(error, 'boundary', componentStack);

function FatalScreen({ onReload }: { onReload: () => void }) {
  return (
    <View style={styles.wrap} testID="fatal-boundary">
      <Text style={styles.title}>{t('fatal.title')}</Text>
      <Text style={styles.body}>{t('fatal.body')}</Text>
      <Pressable testID="fatal-reload" accessibilityRole="button" onPress={onReload} style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}>
        <Text style={styles.buttonText}>{t('fatal.reload')}</Text>
      </Pressable>
    </View>
  );
}

/** Web 驱动专用(tests/test-fatal-recorder):`?fixture=fatal-boundary` 渲染一个首次挂载就抛错的子组件。 */
export function readFatalFixture(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    return new URLSearchParams(String((globalThis as { location?: { search?: string } }).location?.search ?? '')).get('fixture') === 'fatal-boundary';
  } catch {
    return false;
  }
}

// 驱动在点「重新加载」前设 __fatalFixtureHealed(React 出错后会同步重试一次,按次数判会被重试吃掉)。
function FixtureThrower() {
  if (!(globalThis as any).__fatalFixtureHealed) throw new Error('fatal-boundary fixture: render throws');
  return <Text testID="fatal-fixture-ok" style={styles.body}>fixture ok</Text>;
}

export function FatalFixtureScreen() {
  return <FatalBoundary><FixtureThrower /></FatalBoundary>;
}

export default function FatalBoundary({ children }: { children: ReactNode }) {
  return <FatalBoundaryCore record={record} fallback={onReload => <FatalScreen onReload={onReload} />}>{children}</FatalBoundaryCore>;
}

const makeStyles = () => StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.sm },
  body: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  button: { paddingVertical: 8, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.accent },
  buttonText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
