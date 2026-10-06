import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { settingsText } from './i18n-settings';
// 手机设置的三级编辑页(微信 设置 → 个人信息 → 名字 那种):子页上只有一行「API Key  已配置 …a1b2 ›」,
// 点进来才是输入框 + 整宽「保存」+ 红字「清除」+ 一句说明。输入框只出现在这个文件里,且只经
// settings-kit 的 SettingsTextField(settings-subpages.test.ts 守着)。
//
// 状态与动作仍是 useVoiceSettings / SettingsScreen 那一份:保存后清空密钥栏、不回显全文,
// 留空点保存 = 不改 —— 与宽屏 VoiceSettingsSection 完全相同的行为,只是画法不同。
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsTextField } from './settings-kit';
import type { PhonePagesCtx } from './SettingsPhonePages';
import type { useVoiceSettings } from './VoiceSettingsSection';
import { voiceStorageLabel } from './VoiceSettingsSection';
import { CONSOLE_LABELS } from './voice-credentials-model';
import { STREAM_DEFAULT_RESOURCE_ID, STREAM_RESOURCE_IDS } from './doubao-stream-protocol';
import { streamingSupported } from './voice-stream-policy';
import './i18n-password';
import { strengthHintText } from './useChangePassword';

type VoiceState = ReturnType<typeof useVoiceSettings>;

function SaveMessage({ v }: { v: VoiceState }) {
  useTranslation();
  return v.saveMsg ? <SettingsGroup testID="voice-save-msg" footer={v.saveMsg.text} footerTone={v.saveMsg.ok ? 'accent' : 'danger'} /> : null;
}

/** 设置 → 语音输入 → API Key。 */
export function VoiceApiKeyEditPage({ v, ctx }: { v: VoiceState; ctx: PhonePagesCtx }) {
  useTranslation();
  const { form, setForm, status } = v;
  return (
    <>
      {form.console === 'new' ? (
        <SettingsGroup
          title={tr('settings.copy.134')}
          footer={v.savedIs('new') && status.configured ? tr('settings.copy.197', { v0: status.tokenTail }) : tr('settings.copy.135')}
        >
          <SettingsTextField
            testID="voice-api-key"
            accessibilityLabel="API Key"
            value={form.apiKey}
            onChangeText={apiKey => setForm(f => ({ ...f, apiKey }))}
            placeholder={v.savedIs('new') && status.configured ? tr('settings.copy.136') : tr('settings.copy.137')}
            secureTextEntry
            textContentType="password"
          />
        </SettingsGroup>
      ) : (
        // 旧版控制台没有 API Key:凭据是 App ID + Access Token,在「高级 / 旧版控制台」里改。
        <SettingsGroup title={tr('settings.copy.138')} footer={tr('settings.copy.139')}>
          <SettingsRow label="App ID / Access Token" onPress={() => ctx.openDetail('voiceAdvanced')} />
        </SettingsGroup>
      )}
      <SettingsButton label={tr('settings.copy.140')} accessibilityLabel={tr('settings.copy.141')} busy={v.busy} onPress={() => void v.onSave()} testID="voice-save" />
      <SaveMessage v={v} />
      {status.configured ? (
        <SettingsButton variant="destructive" label={tr('settings.copy.142')} accessibilityLabel={tr('settings.copy.143')} disabled={v.busy} onPress={() => void v.onClear()} testID="voice-clear" />
      ) : null}
      <SettingsGroup footer={tr('settings.copy.198', { v0: voiceStorageLabel(v.storage) })} />
    </>
  );
}

/** 设置 → 语音输入 → 高级 / 旧版控制台。 */
export function VoiceAdvancedEditPage({ v }: { v: VoiceState; ctx: PhonePagesCtx }) {
  useTranslation();
  const { form, setForm, status } = v;
  const stream = streamingSupported(v.platform);
  return (
    <>
      <SettingsGroup title={tr('settings.copy.144')} testID="voice-advanced">
        {(['new', 'old'] as const).map(c => (
          <SettingsChoiceRow key={c} testID={`voice-console-${c}`} label={settingsText(CONSOLE_LABELS[c])} selected={form.console === c} onPress={() => v.setConsole(c)} />
        ))}
      </SettingsGroup>
      {form.console === 'old' ? (
        <SettingsGroup title={tr('settings.copy.138')} footer={v.savedIs('old') && status.configured ? tr('settings.copy.199', { v0: status.tokenTail }) : undefined}>
          <SettingsTextField label="App ID" testID="voice-app-id" value={form.appId} onChangeText={appId => setForm(f => ({ ...f, appId }))} placeholder={tr('settings.copy.145')} />
          <SettingsTextField
            label="Access Token"
            testID="voice-access-token"
            value={form.accessToken}
            onChangeText={accessToken => setForm(f => ({ ...f, accessToken }))}
            placeholder={v.savedIs('old') && status.configured ? tr('settings.copy.200', { v0: status.tokenTail }) : tr('settings.copy.146')}
            secureTextEntry
            textContentType="password"
          />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title={tr('settings.copy.147')} footer={stream ? tr('settings.copy.148') : tr('settings.copy.149')}>
        <SettingsTextField label={tr('settings.copy.123')} testID="voice-endpoint" accessibilityLabel={tr('settings.copy.147')} value={form.endpoint} onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))} placeholder="https://…" />
        {stream ? <SettingsTextField label={tr('settings.copy.122')} testID="voice-stream-endpoint" accessibilityLabel={tr('settings.copy.150')} value={form.streamEndpoint} onChangeText={streamEndpoint => setForm(f => ({ ...f, streamEndpoint }))} placeholder="wss://…" /> : null}
      </SettingsGroup>
      {stream ? (
        <SettingsGroup title={tr('settings.copy.151')} footer={tr('settings.copy.152')}>
          {STREAM_RESOURCE_IDS.map(id => (
            <SettingsChoiceRow key={id} testID={`voice-stream-resource-${id}`} label={id} selected={(form.streamResourceId || STREAM_DEFAULT_RESOURCE_ID) === id} onPress={() => setForm(f => ({ ...f, streamResourceId: id }))} />
          ))}
        </SettingsGroup>
      ) : null}
      <SettingsButton label={tr('settings.copy.140')} accessibilityLabel={tr('settings.copy.141')} busy={v.busy} onPress={() => void v.onSave()} testID="voice-advanced-save" />
      <SaveMessage v={v} />
    </>
  );
}

/** 设置 → 通知 → 免打扰时段 → 时段。离开输入框就存(同宽屏);「完成」两个都存并返回。 */
export function QuietHoursEditPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const { notify, saveNotify } = ctx;
  return (
    <>
      <SettingsGroup title={tr('settings.copy.109')} footer={tr('settings.copy.153')}>
        <SettingsTextField
          label={tr('settings.copy.53')}
          testID="notify-quiet-start"
          accessibilityLabel={tr('settings.copy.54')}
          value={ctx.quietStart}
          onChangeText={ctx.setQuietStart}
          onBlur={() => saveNotify({ ...notify, quiet: { ...notify.quiet, start: ctx.quietStart } })}
          placeholder="22:00"
        />
        <SettingsTextField
          label={tr('settings.copy.55')}
          testID="notify-quiet-end"
          accessibilityLabel={tr('settings.copy.56')}
          value={ctx.quietEnd}
          onChangeText={ctx.setQuietEnd}
          onBlur={() => saveNotify({ ...notify, quiet: { ...notify.quiet, end: ctx.quietEnd } })}
          placeholder="08:00"
        />
      </SettingsGroup>
      <SettingsButton
        label={tr('settings.copy.154')}
        testID="notify-quiet-done"
        onPress={() => { saveNotify({ ...notify, quiet: { ...notify.quiet, start: ctx.quietStart, end: ctx.quietEnd } }); ctx.closeDetail(); }}
      />
    </>
  );
}

/**
 * 设置 → 账号 → 修改密码(#653)。手机画法照微信 设置 → 账号与安全 → 密码:一张卡三行(标签在左、输入在右),
 * 卡片下面小字说新密码的规则 / 哪条不够;整宽主色按钮。桌面是另一套(ChangePasswordPanel.tsx)。
 */
export function ChangePasswordEditPage({ ctx }: { ctx: PhonePagesCtx }) {
  useTranslation();
  const pw = ctx.password;
  const hintTone = pw.hint === 'ok' ? 'accent' : pw.hint === 'rule' ? undefined : 'danger';
  const footer = pw.confirmMatches === false ? tr('password.hint.mismatch') : strengthHintText(pw.hint, pw.form.next);
  return (
    <>
      {ctx.weakPassword ? <SettingsGroup testID="change-password-weak-notice" footer={tr('password.weakBanner')} footerTone="accent" /> : null}
      <SettingsGroup testID="change-password-card" footer={footer} footerTone={pw.confirmMatches === false ? 'danger' : hintTone}>
        <SettingsTextField
          label={tr('password.current')}
          testID="change-password-current"
          value={pw.form.current}
          onChangeText={v => pw.set('current', v)}
          placeholder={tr('password.currentPlaceholder')}
          secureTextEntry
          textContentType="password"
        />
        <SettingsTextField
          label={tr('password.new')}
          testID="change-password-new"
          value={pw.form.next}
          onChangeText={v => pw.set('next', v)}
          placeholder={tr('password.newPlaceholder')}
          secureTextEntry
          textContentType="newPassword"
        />
        <SettingsTextField
          label={tr('password.confirm')}
          testID="change-password-confirm"
          value={pw.form.confirm}
          onChangeText={v => pw.set('confirm', v)}
          placeholder={tr('password.confirmPlaceholder')}
          secureTextEntry
          textContentType="newPassword"
          onSubmitEditing={() => void pw.submit()}
        />
      </SettingsGroup>
      {pw.error ? <SettingsGroup testID="change-password-error" footer={pw.error} footerTone="danger" /> : null}
      <SettingsButton label={tr('password.submit')} busy={pw.busy} onPress={() => void pw.submit()} testID="change-password-submit" />
      <SettingsGroup footer={tr('password.footer')} />
    </>
  );
}
