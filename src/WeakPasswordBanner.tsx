// 「当前密码过于简单，请修改」顶部横幅(#653)。hub 在弱密码登录时回 must_change_password: true(weak-password-flag.ts 记着),
// 点一下打开 设置 → 账号 → 修改密码;改成功后标记清掉,横幅随之消失。
// 手机:内容区最上面一条整宽横幅(≥44 高,触控);桌面:右侧内容栏顶上一条细横幅(36 高,鼠标悬停变深)。
// 颜色只用主题色:浅蓝底(tonalBg)+ 主色字。
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing } from './theme';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-password';
import type { HubConfig } from './api';
import { useWeakPassword } from './weak-password-flag';

export default function WeakPasswordBanner({ cfg, desktop, onOpen }: { cfg: Pick<HubConfig, 'serverUrl' | 'username'> | null; desktop?: boolean; onOpen: () => void }) {
  useTranslation();
  const weak = useWeakPassword(cfg);
  if (!cfg || !weak) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tr('password.weakBanner')} · ${tr('password.weakBannerAction')}`}
      onPress={onOpen}
      style={({ hovered, pressed }: any) => [styles.bar, desktop ? styles.barDesktop : styles.barPhone, (hovered || pressed) && styles.barActive]}
      testID="weak-password-banner"
    >
      <Ionicons name="shield-outline" size={desktop ? 15 : 17} color={colors.accent} />
      <Text style={[styles.text, desktop && styles.textDesktop]} numberOfLines={1} testID="weak-password-banner-text">{tr('password.weakBanner')}</Text>
      <View style={styles.action} testID="weak-password-banner-action">
        <Text style={[styles.actionText, desktop && styles.textDesktop]}>{tr('password.weakBannerAction')}</Text>
        <Ionicons name="chevron-forward" size={desktop ? 13 : 15} color={colors.accent} />
      </View>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.tonalBg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  barPhone: { minHeight: 44, paddingHorizontal: 16 },
  barDesktop: { height: 36, paddingHorizontal: spacing.lg },
  barActive: { backgroundColor: colors.railActiveBg },
  text: { flex: 1, minWidth: 0, color: colors.accent, fontSize: 14, fontWeight: '600' },
  textDesktop: { fontSize: 13 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  actionText: { color: colors.accent, fontSize: 14 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
