// 桌面(宽屏设置右栏)的「修改密码」(#653)。手机是另一套画法(SettingsEditPages.tsx ChangePasswordEditPage,
// 微信式:标签在左、输入在右的一张卡 + 整宽按钮);状态与提交两边是同一个 useChangePassword。
//
// 桌面的画法照桌面表单的习惯:标签在输入框上方、一列 360 宽;新密码下面一行实时强度提示,确认框下面一行是否一致;
// 错误在按钮上方;按钮在右下角(取消 · 修改密码),Enter 提交。颜色只用主题色(accent)与错误红(failed)。
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-password';
import { SETTINGS_ROW_PAD_X, SettingsGroup } from './settings-kit';
import { strengthHintText, type ChangePasswordState } from './useChangePassword';

function Field({ id, label, value, onChange, placeholder, visible, onToggle, onSubmit, autoFocus }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
  onSubmit: () => void;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field} testID={`${id}-field`}>
      <Text style={styles.label} testID={`${id}-label`}>{label}</Text>
      <View style={[styles.inputShell, focused && styles.inputShellFocused]} testID={`${id}-shell`}>
        <TextInput
          testID={id}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          textContentType="password"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmit}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? tr('password.hide') : tr('password.show')}
          onPress={onToggle}
          hitSlop={6}
          style={({ hovered }: any) => [styles.eye, hovered && { opacity: 0.7 }]}
          testID={`${id}-eye`}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={17} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export default function ChangePasswordPanel({ pw, weak, onCancel }: { pw: ChangePasswordState; weak: boolean; onCancel: () => void }) {
  useTranslation();
  const [visible, setVisible] = useState(false);
  const toggle = () => setVisible(v => !v);
  const submit = () => { void pw.submit(); };
  const hintTone = pw.hint === 'ok' ? styles.hintOk : pw.hint === 'rule' ? styles.hintMuted : styles.hintBad;
  return (
    <View testID="change-password-desktop">
      {weak ? (
        <View style={styles.notice} testID="change-password-weak-notice">
          <Ionicons name="shield-outline" size={16} color={colors.accent} />
          <Text style={styles.noticeText}>{tr('password.weakBanner')}</Text>
        </View>
      ) : null}
      <SettingsGroup separators={false} testID="change-password-card">
        <View style={styles.body}>
          <Field id="change-password-current" label={tr('password.current')} value={pw.form.current} onChange={v => pw.set('current', v)} placeholder={tr('password.currentPlaceholder')} visible={visible} onToggle={toggle} onSubmit={submit} autoFocus />
          <View>
            <Field id="change-password-new" label={tr('password.new')} value={pw.form.next} onChange={v => pw.set('next', v)} placeholder={tr('password.newPlaceholder')} visible={visible} onToggle={toggle} onSubmit={submit} />
            <View style={styles.hintRow} testID="change-password-strength">
              <Ionicons name={pw.hint === 'ok' ? 'checkmark-circle' : pw.hint === 'rule' ? 'information-circle-outline' : 'alert-circle'} size={14} color={pw.hint === 'ok' ? colors.accent : pw.hint === 'rule' ? colors.textMuted : colors.failed} />
              <Text style={[styles.hint, hintTone]} testID="change-password-strength-text">{strengthHintText(pw.hint, pw.form.next)}</Text>
            </View>
          </View>
          <View>
            <Field id="change-password-confirm" label={tr('password.confirm')} value={pw.form.confirm} onChange={v => pw.set('confirm', v)} placeholder={tr('password.confirmPlaceholder')} visible={visible} onToggle={toggle} onSubmit={submit} />
            {pw.confirmMatches !== null ? (
              <View style={styles.hintRow} testID="change-password-match">
                <Ionicons name={pw.confirmMatches ? 'checkmark-circle' : 'alert-circle'} size={14} color={pw.confirmMatches ? colors.accent : colors.failed} />
                <Text style={[styles.hint, pw.confirmMatches ? styles.hintOk : styles.hintBad]}>{pw.confirmMatches ? tr('password.hint.match') : tr('password.hint.mismatch')}</Text>
              </View>
            ) : null}
          </View>
          {pw.error ? <Text style={styles.error} testID="change-password-error" accessibilityLiveRegion="polite">{pw.error}</Text> : null}
          <View style={styles.actions}>
            <Text style={styles.footer} testID="change-password-footer">{tr('password.footer')}</Text>
            <Pressable accessibilityRole="button" onPress={onCancel} disabled={pw.busy} style={({ hovered, pressed }: any) => [styles.button, styles.buttonPlain, (hovered || pressed) && styles.buttonPlainHover]} testID="change-password-cancel">
              <Text style={styles.buttonPlainText}>{tr('password.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pw.busy, busy: pw.busy }}
              onPress={submit}
              disabled={pw.busy}
              style={({ hovered, pressed }: any) => [styles.button, styles.buttonPrimary, (hovered || pressed) && { opacity: 0.88 }, pw.busy && { opacity: 0.6 }]}
              testID="change-password-submit"
            >
              {pw.busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
              <Text style={styles.buttonPrimaryText}>{tr('password.submit')}</Text>
            </Pressable>
          </View>
        </View>
      </SettingsGroup>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 16, marginTop: spacing.md, paddingHorizontal: SETTINGS_ROW_PAD_X, paddingVertical: spacing.sm + 2, borderRadius: radius.control, backgroundColor: colors.tonalBg },
  noticeText: { color: colors.accent, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  body: { paddingHorizontal: SETTINGS_ROW_PAD_X + 8, paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  field: { gap: 6, maxWidth: 380 },
  label: { color: colors.text, fontSize: 13, fontWeight: '600' },
  inputShell: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg, paddingLeft: 12, paddingRight: 6 },
  inputShellFocused: { borderColor: colors.accent },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 0, height: '100%', outlineStyle: 'none' } as any,
  eye: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.item },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, maxWidth: 380 },
  hint: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  hintOk: { color: colors.accent },
  hintMuted: { color: colors.textMuted },
  hintBad: { color: colors.failed },
  error: { color: colors.failed, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md },
  footer: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 12, lineHeight: 17, marginRight: spacing.sm },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 16, borderRadius: radius.item, flexShrink: 0 },
  buttonPlain: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.groupedRow },
  buttonPlainHover: { backgroundColor: colors.groupedRowPressed },
  buttonPlainText: { color: colors.text, fontSize: 14 },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
