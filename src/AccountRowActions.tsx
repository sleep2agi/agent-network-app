// 设置 → 账号:每行的「复制」「编辑」(Vincent 2026-09-30「账号 支持一下复制 编辑」)。
//
// 桌面 / 宽屏:行尾的文字按钮 复制 · 编辑 · 新窗口 · 移除(SettingsScreen 画),编辑是居中的 DialogFrame。
// 手机:管理账号页里点一行 → 底部 action sheet(微信长按 / 点「⋯」那种)列出同一组动作,编辑同样走 DialogFrame。
// 动作清单、复制文本、保存前的验证都在 account-row-actions.ts(纯逻辑、有测试),这里只负责画。
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text, TextInput } from './ui-text';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-accounts';
import DialogFrame from './DialogFrame';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { appFetch } from './app-fetch';
import { loadSavedProfileConfig, markHubProfileRequiresReauth, updateHubProfile, type HubProfile } from './storage';
import { forgetAuthMe } from './user-admin-api';
import { HUB_EDIT_FAILURE_KEY, accountCopyText, offersRelogin, validateHubEdit, type AccountRowAction, type HubEditFailure } from './account-row-actions';

export const accountName = (p: Pick<HubProfile, 'displayName' | 'username' | 'serverUrl'>): string => p.displayName || p.username || p.serverUrl;

/** 复制一行「Hub 地址 · 用户名 · 网络 ID」。只传元数据的三格进去 —— 令牌不在这条路上。 */
export async function copyAccountLine(profile: HubProfile): Promise<void> {
  const text = accountCopyText({ serverUrl: profile.serverUrl, username: profile.username, networkId: profile.networkId });
  try {
    await Clipboard.setStringAsync(text);
  } catch {
    // RN Web / 旧 WebView 没有原生剪贴板时退回浏览器 API(同 ChatScreen copyValue)
    await (globalThis as any).navigator?.clipboard?.writeText?.(text);
  }
}

export const ACCOUNT_TOAST_MS = 1400;

/** 「已复制」小条,贴在设置页底部中间;不截点击。 */
export function AccountToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.toastLayer} pointerEvents="none">
      <View style={styles.toast} accessibilityLiveRegion="polite" testID="account-toast">
        <Text style={styles.toastText}>{text}</Text>
      </View>
    </View>
  );
}

const ACTION_LABEL: Record<AccountRowAction, string> = {
  copy: 'accounts.copy',
  edit: 'accounts.edit',
  openWindow: 'accounts.openWindow',
  remove: 'accounts.remove',
};

/**
 * 手机:一行账号的底部 action sheet。上面一行灰字是这个账号(名字 + 地址),下面是动作,移除标红,
 * 最底下隔一条灰带是「取消」—— 和 UserManagementPanel 的 RemoveSheet 同一套形状。
 */
export function AccountActionSheet({ visible, profile, actions, current, onSelect, onClose }: {
  /** 只在手指端为 true(调用处带 pointer 判定,phone-only-registry 守着)。 */
  visible: boolean;
  profile: HubProfile | null;
  actions: readonly AccountRowAction[];
  current: boolean;
  onSelect: (action: AccountRowAction) => void;
  onClose: () => void;
}) {
  useTranslation();
  const safe = useModalSafePadding('fullScreen');
  if (!profile) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel={tr('accounts.cancel')} testID="account-sheet-backdrop">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(safe.paddingBottom ?? 0, spacing.sm) }]} onPress={() => {}} testID="account-sheet">
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{accountName(profile)}{current ? tr('settings.copy.13') : ''}</Text>
            <Text style={styles.sheetSub} numberOfLines={1}>{accountCopyText(profile)}</Text>
          </View>
          {actions.map(action => (
            <Pressable
              key={action}
              accessibilityRole="button"
              onPress={() => { onClose(); onSelect(action); }}
              style={({ pressed }) => [styles.sheetBtn, styles.sheetDivider, pressed && styles.pressed]}
              testID={`account-sheet-${action}`}
            >
              <Text style={action === 'remove' ? styles.sheetDanger : styles.sheetAction}>{tr(ACTION_LABEL[action])}</Text>
            </Pressable>
          ))}
          <View style={styles.sheetGap} />
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]} testID="account-sheet-cancel">
            <Text style={styles.sheetAction}>{tr('accounts.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type EditError = { kind: HubEditFailure; detail?: string } | { kind: 'save'; detail: string };

/**
 * 编辑一个账号:显示名称 + Hub 地址。地址没变 = 只改名,直接存。地址变了 = 先验(/health → /api/auth/me 带已存的令牌),
 * 不过就不存并说清楚是哪一步;令牌被拒时底部给「重新登录」(去登录页,地址预填新的)。
 * 存完:当前账号 → onSaved 里重连;别的账号只刷新列表。
 */
export function AccountEditDialog({ profile, current, onClose, onSaved, onRelogin }: {
  profile: HubProfile;
  current: boolean;
  onClose: () => void;
  onSaved: (profileId: string, serverChanged: boolean) => void | Promise<void>;
  onRelogin: (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => void;
}) {
  useTranslation();
  const [name, setName] = useState(profile.displayName ?? '');
  const [server, setServer] = useState(profile.serverUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EditError | null>(null);
  useEffect(() => { setError(null); }, [server]);
  const unchanged = (name.trim() || undefined) === (profile.displayName?.trim() || undefined) && server.trim().replace(/\/+$/, '') === profile.serverUrl.replace(/\/+$/, '');

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await loadSavedProfileConfig(profile.profileId);
      if (!saved) throw new Error('saved account is invalid');
      const check = await validateHubEdit(
        { serverUrl: server, currentServerUrl: profile.serverUrl, token: saved.token, username: profile.username || undefined },
        (url, init) => appFetch(url, init),
      );
      if (!check.ok) { setError({ kind: check.kind, detail: check.detail }); return; }
      await updateHubProfile(profile.profileId, { serverUrl: check.serverUrl, displayName: name });
      // 新地址用已存的令牌验过了:之前挂着的「需要重新登录」不再成立。
      if (check.changed && profile.requiresReauth) await markHubProfileRequiresReauth(profile.profileId, false);
      if (check.changed) forgetAuthMe();
      await onSaved(profile.profileId, check.changed);
      onClose();
    } catch (e) {
      setError({ kind: 'save', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const errorText = !error ? '' : error.kind === 'save'
    ? error.detail
    : tr(HUB_EDIT_FAILURE_KEY[error.kind], { detail: error.detail ?? '' });
  const relogin = !!error && error.kind !== 'save' && offersRelogin(error.kind);

  return (
    <DialogFrame
      title={tr('accounts.editTitle')}
      closeLabel={tr('accounts.close')}
      onClose={onClose}
      testID="account-edit-dialog"
      footer={(
        <View style={styles.actions}>
          {relogin ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => { onClose(); onRelogin({ profileId: profile.profileId, serverUrl: server.trim().replace(/\/+$/, ''), username: profile.username, displayName: name.trim() || undefined }); }}
              style={({ pressed }) => [styles.btn, styles.btnPlain, styles.actionsLeft, pressed && styles.pressed]}
              testID="account-edit-relogin"
            >
              <Text style={styles.btnAccentText}>{tr('accounts.relogin')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]} testID="account-edit-cancel">
            <Text style={styles.btnPlainText}>{tr('accounts.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: unchanged || busy, busy }}
            disabled={unchanged || busy}
            onPress={() => void save()}
            style={({ pressed }) => [styles.btn, styles.btnPrimary, (unchanged || busy) && styles.disabled, pressed && styles.pressed]}
            testID="account-edit-save"
          >
            {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
            <Text style={styles.btnPrimaryText}>{tr('accounts.save')}</Text>
          </Pressable>
        </View>
      )}
    >
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('accounts.editName')}</Text>
        <TextInput
          testID="account-edit-name"
          accessibilityLabel={tr('accounts.editName')}
          value={name}
          onChangeText={setName}
          placeholder={tr('accounts.editNamePlaceholder', { name: profile.username || '—' })}
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('accounts.editServer')}</Text>
        <TextInput
          testID="account-edit-server"
          accessibilityLabel={tr('accounts.editServer')}
          value={server}
          onChangeText={setServer}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          onSubmitEditing={() => { if (!unchanged) void save(); }}
        />
      </View>
      <Text style={styles.hint} testID="account-edit-identity">
        {tr('accounts.editIdentity', { user: profile.username || '—', net: profile.networkId || '—' })}
        {current ? ` ${tr('accounts.editCurrentHint')}` : ''}
      </Text>
      {busy ? <Text style={styles.hint} testID="account-edit-checking">{tr('accounts.checking')}</Text> : null}
      {errorText ? <Text style={styles.error} testID="account-edit-error" {...({ dataSet: { kind: error?.kind } } as object)}>{errorText}</Text> : null}
    </DialogFrame>
  );
}

const makeStyles = () => StyleSheet.create({
  toastLayer: { position: 'absolute', left: 0, right: 0, bottom: 48, alignItems: 'center' },
  toast: { paddingVertical: 8, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.card, ...elevated('floating') },
  toastText: { color: colors.text, fontSize: 13 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, overflow: 'hidden' },
  sheetHead: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheetTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sheetSub: { color: colors.textMuted, fontSize: 12 },
  sheetBtn: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetGap: { height: 8, backgroundColor: colors.bg },
  sheetAction: { color: colors.text, fontSize: 16 },
  sheetDanger: { color: colors.failed, fontSize: 16 },
  field: { gap: 6 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  input: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.failed, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  actionsLeft: { marginRight: 'auto' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: spacing.lg, borderRadius: radius.control, justifyContent: 'center' },
  btnPlain: { borderWidth: 1, borderColor: colors.border },
  btnPlainText: { color: colors.text, fontSize: 14 },
  btnAccentText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
