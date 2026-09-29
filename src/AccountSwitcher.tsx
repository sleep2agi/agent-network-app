import { t } from './i18n';
import './i18n-accounts';
import { useTranslation } from './i18n-react';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import type { HubProfile } from './storage';
import { accountHost } from './session-registry';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';

// 切换账号(Vincent 2026-09-29「退出登录…这里新增一个切换账号，或者切换服务器…两个登录状态都要留住」)。
// 账号和服务器是同一个入口:每一行 =「账号 @ 服务器」。点别的行直接切过去(用它存着的令牌,不用密码);
// 「添加账号」走登录页,当前账号不退出。「管理」打开每行的「移除」(只删本机)。
// 手机 = 底部面板(照微信);宽屏 / 桌面 = 居中对话框 —— 不把手机的底部面板搬到桌面上。

type Profile = Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName' | 'requiresReauth'>;

export const accountLabel = (p: Pick<Profile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>): string =>
  p.profileId === LOCAL_HUB_PROFILE_ID ? t('accounts.local') : `${p.username || p.displayName || '?'} @ ${accountHost(p.serverUrl)}`;

// 头像:名字首字 + 按账号固定的底色(同一账号每次同色,两个账号一眼分得开)。
const AVATAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#14b8a6', '#ec4899'];
const avatarColor = (key: string): string => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

function AccountAvatar({ profile }: { profile: Profile }) {
  const name = profile.displayName || profile.username || '?';
  const local = profile.profileId === LOCAL_HUB_PROFILE_ID;
  return (
    <View style={[styles.avatar, { backgroundColor: local ? colors.textMuted : avatarColor(`${profile.serverUrl}|${profile.username}`) }]}>
      {local ? <Ionicons name="desktop-outline" size={18} color="#fff" /> : <Text style={styles.avatarText}>{[...name][0]?.toUpperCase()}</Text>}
    </View>
  );
}

export default function AccountSwitcher({
  visible,
  variant,
  profiles,
  currentId,
  onPick,
  onAdd,
  onRemove,
  onClose,
}: {
  visible: boolean;
  variant: 'sheet' | 'dialog';
  profiles: readonly Profile[];
  currentId: string | undefined;
  onPick: (profile: Profile) => void;
  onAdd: () => void;
  onRemove: (profile: Profile) => void;
  onClose: () => void;
}) {
  useTranslation();
  const safe = useModalSafePadding('overlay');
  const [managing, setManaging] = useState(false);
  const close = () => { setManaging(false); onClose(); };
  const dialog = variant === 'dialog';
  const removable = (p: Profile) => p.profileId !== LOCAL_HUB_PROFILE_ID;

  const rows = profiles.map((profile, index) => {
    const current = profile.profileId === currentId;
    const label = accountLabel(profile);
    return (
      <View key={profile.profileId}>
        {index ? <View style={styles.divider} /> : null}
        <Pressable
          testID={`account-switch-row-${profile.profileId}`}
          accessibilityRole="button"
          accessibilityLabel={t('accounts.pick', { name: label })}
          accessibilityState={{ selected: current }}
          disabled={managing}
          onPress={() => { close(); if (!current) onPick(profile); }}
          style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && !managing && styles.rowPressed]}
        >
          <AccountAvatar profile={profile} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle} numberOfLines={1} testID={`account-switch-label-${profile.profileId}`}>{label}</Text>
            {profile.requiresReauth ? (
              <Text style={[styles.rowSub, styles.danger]} numberOfLines={1}>{t('accounts.reauth')}</Text>
            ) : current ? (
              <Text style={styles.rowSub} numberOfLines={1}>{t('accounts.current')}</Text>
            ) : profile.displayName && profile.displayName !== profile.username ? (
              <Text style={styles.rowSub} numberOfLines={1}>{profile.displayName}</Text>
            ) : null}
          </View>
          {managing && removable(profile) ? (
            <Pressable
              testID={`account-switch-remove-${profile.profileId}`}
              accessibilityRole="button"
              accessibilityLabel={t('accounts.removeLabel', { name: label })}
              onPress={() => { close(); onRemove(profile); }}
              hitSlop={6}
              style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.removeText}>{t('accounts.remove')}</Text>
            </Pressable>
          ) : current ? (
            <View testID="account-switch-current"><Ionicons name="checkmark" size={20} color={colors.accent} /></View>
          ) : null}
        </Pressable>
      </View>
    );
  });

  const addRow = (
    <Pressable
      testID="account-switch-add"
      accessibilityRole="button"
      accessibilityLabel={t('accounts.add')}
      onPress={() => { close(); onAdd(); }}
      style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && styles.rowPressed]}
    >
      <View style={[styles.avatar, styles.addAvatar]}>
        <Ionicons name="add" size={22} color={colors.textSecondary} />
      </View>
      <Text style={[styles.rowTitle, styles.rowCopy]}>{t('accounts.add')}</Text>
    </Pressable>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {dialog ? null : (
          <Pressable testID="account-switch-close" accessibilityRole="button" accessibilityLabel={t('accounts.close')} onPress={close} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>{t('accounts.switch')}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>
        {profiles.some(removable) ? (
          <Pressable testID="account-switch-manage" accessibilityRole="button" onPress={() => setManaging(m => !m)} hitSlop={8}>
            <Text style={styles.manageText}>{managing ? t('accounts.done') : t('accounts.manage')}</Text>
          </Pressable>
        ) : null}
        {dialog ? (
          <Pressable testID="account-switch-close" accessibilityRole="button" accessibilityLabel={t('accounts.close')} onPress={close} hitSlop={8} style={styles.dialogClose}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const body = (
    <>
      {header}
      <Text style={styles.hint}>{t('accounts.switchHint')}</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <View style={styles.block}>{rows}</View>
        <View style={[styles.block, styles.addBlock]}>{addRow}</View>
      </ScrollView>
    </>
  );

  return (
    <Modal transparent visible={visible} animationType={dialog ? 'fade' : 'slide'} onRequestClose={close}>
      <View style={[styles.root, dialog ? styles.rootCenter : styles.rootBottom, dialog ? { paddingTop: safe.paddingTop + spacing.xl, paddingBottom: safe.paddingBottom + spacing.xl, paddingLeft: safe.paddingLeft + spacing.xl, paddingRight: safe.paddingRight + spacing.xl } : { paddingTop: safe.paddingTop }]}>
        <Pressable testID="account-switch-backdrop" accessibilityLabel={t('accounts.close')} focusable={false} onPress={close} style={[StyleSheet.absoluteFill, styles.backdrop]} />
        {dialog ? (
          <View testID="account-switch-dialog" accessibilityViewIsModal style={[styles.panel, styles.dialog]}>{body}</View>
        ) : (
          <View testID="account-switch-sheet" accessibilityViewIsModal style={[styles.panel, styles.sheet, { paddingBottom: safe.paddingBottom + spacing.sm, paddingLeft: safe.paddingLeft, paddingRight: safe.paddingRight }]}>
            <View style={styles.handleArea}><View style={styles.handle} /></View>
            {body}
            <Pressable testID="account-switch-cancel" accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.cancel, pressed && styles.rowPressed]}>
              <Text style={styles.cancelText}>{t('accounts.cancel')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  rootBottom: { justifyContent: 'flex-end' },
  rootCenter: { alignItems: 'center', justifyContent: 'center' },
  backdrop: { backgroundColor: '#00000073' },
  panel: { backgroundColor: colors.groupedBg, overflow: 'hidden' },
  sheet: { width: '100%', maxHeight: '85%', borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '80%', borderRadius: radius.surface, paddingBottom: spacing.md, ...elevated('floating') } as any,
  handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 2 },
  handle: { width: 36, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg },
  headerSide: { width: 88, flexDirection: 'row', alignItems: 'center' },
  headerRight: { justifyContent: 'flex-end', gap: spacing.md },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '600' },
  manageText: { color: colors.accent, fontSize: 15 },
  dialogClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: spacing.sm },
  block: { backgroundColor: colors.groupedRow, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  addBlock: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.groupedRow },
  rowPressed: { backgroundColor: colors.groupedRowPressed },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 16 },
  rowSub: { color: colors.textMuted, fontSize: 13 },
  danger: { color: colors.failed },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg + 40 + spacing.md },
  avatar: { width: 40, height: 40, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  addAvatar: { backgroundColor: colors.subtleFill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  removeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.control, borderWidth: 1, borderColor: colors.failed },
  removeText: { color: colors.failed, fontSize: 14, fontWeight: '600' },
  cancel: { marginTop: spacing.sm, minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedRow },
  cancelText: { color: colors.text, fontSize: 16 },
});

// Theme idiom shared across screens: rebuilt on theme flip; App.tsx remounts the tree (key={theme}).
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
