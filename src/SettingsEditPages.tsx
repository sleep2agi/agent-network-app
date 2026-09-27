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

type VoiceState = ReturnType<typeof useVoiceSettings>;

function SaveMessage({ v }: { v: VoiceState }) {
  return v.saveMsg ? <SettingsGroup testID="voice-save-msg" footer={v.saveMsg.text} footerTone={v.saveMsg.ok ? 'accent' : 'danger'} /> : null;
}

/** 设置 → 语音输入 → API Key。 */
export function VoiceApiKeyEditPage({ v, ctx }: { v: VoiceState; ctx: PhonePagesCtx }) {
  const { form, setForm, status } = v;
  return (
    <>
      {form.console === 'new' ? (
        <SettingsGroup
          title="豆包语音(火山引擎)API Key"
          footer={v.savedIs('new') && status.configured ? `已保存 ${status.tokenTail},留空不改。` : '火山引擎控制台 → API Key 管理 里复制。'}
        >
          <SettingsTextField
            testID="voice-api-key"
            accessibilityLabel="API Key"
            value={form.apiKey}
            onChangeText={apiKey => setForm(f => ({ ...f, apiKey }))}
            placeholder={v.savedIs('new') && status.configured ? '粘贴新的 API Key' : '粘贴 API Key'}
            secureTextEntry
            textContentType="password"
          />
        </SettingsGroup>
      ) : (
        // 旧版控制台没有 API Key:凭据是 App ID + Access Token,在「高级 / 旧版控制台」里改。
        <SettingsGroup title="旧版控制台" footer="旧版控制台用 App ID + Access Token。">
          <SettingsRow label="App ID / Access Token" onPress={() => ctx.openDetail('voiceAdvanced')} />
        </SettingsGroup>
      )}
      <SettingsButton label="保存" accessibilityLabel="保存语音识别凭据" busy={v.busy} onPress={() => void v.onSave()} testID="voice-save" />
      <SaveMessage v={v} />
      {status.configured ? (
        <SettingsButton variant="destructive" label="清除" accessibilityLabel="清除语音识别凭据" disabled={v.busy} onPress={() => void v.onClear()} testID="voice-clear" />
      ) : null}
      <SettingsGroup footer={`凭据只保存在本机(${voiceStorageLabel(v.storage)}),不会上传到 Hub。`} />
    </>
  );
}

/** 设置 → 语音输入 → 高级 / 旧版控制台。 */
export function VoiceAdvancedEditPage({ v }: { v: VoiceState; ctx: PhonePagesCtx }) {
  const { form, setForm, status } = v;
  const stream = streamingSupported(v.platform);
  return (
    <>
      <SettingsGroup title="控制台版本" testID="voice-advanced">
        {(['new', 'old'] as const).map(c => (
          <SettingsChoiceRow key={c} testID={`voice-console-${c}`} label={CONSOLE_LABELS[c]} selected={form.console === c} onPress={() => v.setConsole(c)} />
        ))}
      </SettingsGroup>
      {form.console === 'old' ? (
        <SettingsGroup title="旧版控制台" footer={v.savedIs('old') && status.configured ? `Access Token 已保存 ${status.tokenTail},留空不改。` : undefined}>
          <SettingsTextField label="App ID" testID="voice-app-id" value={form.appId} onChangeText={appId => setForm(f => ({ ...f, appId }))} placeholder="应用的 APP ID" />
          <SettingsTextField
            label="Access Token"
            testID="voice-access-token"
            value={form.accessToken}
            onChangeText={accessToken => setForm(f => ({ ...f, accessToken }))}
            placeholder={v.savedIs('old') && status.configured ? `已保存 ${status.tokenTail}` : '应用的 Access Token'}
            secureTextEntry
            textContentType="password"
          />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="接口地址" footer={stream ? '留空 = 官方地址。极速版必须 https,流式必须 wss。' : '留空 = 官方 openspeech.bytedance.com(必须 https)。'}>
        <SettingsTextField label="极速版" testID="voice-endpoint" accessibilityLabel="接口地址" value={form.endpoint} onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))} placeholder="https://…" />
        {stream ? <SettingsTextField label="流式" testID="voice-stream-endpoint" accessibilityLabel="流式接口地址" value={form.streamEndpoint} onChangeText={streamEndpoint => setForm(f => ({ ...f, streamEndpoint }))} placeholder="wss://…" /> : null}
      </SettingsGroup>
      {stream ? (
        <SettingsGroup title="流式资源 ID(控制台开通的是哪一种)" footer="1.0 小时版 volc.bigasr.sauc.duration(默认)· 并发版 …concurrent · 2.0 为 volc.seedasr.*">
          {STREAM_RESOURCE_IDS.map(id => (
            <SettingsChoiceRow key={id} testID={`voice-stream-resource-${id}`} label={id} selected={(form.streamResourceId || STREAM_DEFAULT_RESOURCE_ID) === id} onPress={() => setForm(f => ({ ...f, streamResourceId: id }))} />
          ))}
        </SettingsGroup>
      ) : null}
      <SettingsButton label="保存" accessibilityLabel="保存语音识别凭据" busy={v.busy} onPress={() => void v.onSave()} testID="voice-advanced-save" />
      <SaveMessage v={v} />
    </>
  );
}

/** 设置 → 通知 → 免打扰时段 → 时段。离开输入框就存(同宽屏);「完成」两个都存并返回。 */
export function QuietHoursEditPage({ ctx }: { ctx: PhonePagesCtx }) {
  const { notify, saveNotify } = ctx;
  return (
    <>
      <SettingsGroup title="时段" footer="这段时间内不提醒(跨零点也可以,如 22:00 – 08:00)。">
        <SettingsTextField
          label="从"
          testID="notify-quiet-start"
          accessibilityLabel="免打扰开始时间"
          value={ctx.quietStart}
          onChangeText={ctx.setQuietStart}
          onBlur={() => saveNotify({ ...notify, quiet: { ...notify.quiet, start: ctx.quietStart } })}
          placeholder="22:00"
        />
        <SettingsTextField
          label="到"
          testID="notify-quiet-end"
          accessibilityLabel="免打扰结束时间"
          value={ctx.quietEnd}
          onChangeText={ctx.setQuietEnd}
          onBlur={() => saveNotify({ ...notify, quiet: { ...notify.quiet, end: ctx.quietEnd } })}
          placeholder="08:00"
        />
      </SettingsGroup>
      <SettingsButton
        label="完成"
        testID="notify-quiet-done"
        onPress={() => { saveNotify({ ...notify, quiet: { ...notify.quiet, start: ctx.quietStart, end: ctx.quietEnd } }); ctx.closeDetail(); }}
      />
    </>
  );
}
