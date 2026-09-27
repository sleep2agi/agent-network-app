// 手机「设置」的子页(Vincent 2026-09-27「设置界面有点体验太差」,截图是 设置 → 语音输入)。
//
// #439 把列表页做成了微信式分组,子页却还是宽屏右栏那套密排表单:贴边、大圆点单选卡片、控件之间
// 夹长段说明、API Key 是行内输入框加两个小按钮。这里按类重画**全部**子页,只用 settings-kit 的积木:
//   分组卡片(左右 16)· 行(≥48,标签 · 值 · ›)· 单选行(右侧 ✓)· 开关行 · 整宽按钮;
//   说明挪到卡片下面的小灰字;要输入的东西点进三级编辑页(SettingsEditPages.tsx)。
// 状态与动作全部来自 SettingsScreen / useVoiceSettings,和宽屏同一份 —— 这里只换画法。
//
// 🔴 settings-subpages.test.ts 静态守着这个文件:不许直接用 TextInput、不许画单选圆点卡片、
//    不许从 react-native 拿 Switch —— 一律经 settings-kit。
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { SettingsButton, SettingsCardContent, SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsSwitchRow, type SettingsTone } from './settings-kit';
import { VoiceAdvancedEditPage, VoiceApiKeyEditPage, QuietHoursEditPage } from './SettingsEditPages';
import type { HubConfig } from './api';
import type { DesktopStorageDiagnostics, HubProfile } from './storage';
import { saveThemeMode } from './storage';
import { THEME_PREFERENCES, THEME_PREFERENCE_LABEL, setThemePreference, themePreferenceSummary, type ThemePreference } from './theme';
import { APP_VERSION } from './version';
import { LOCAL_HUB_PROFILE_ID, type LocalHubResult } from './local-hub';
import type { NotifySettings } from './notify-settings';
import type { PermissionStatus } from './mobile-notify-model';
import NotifyDiagnosticsPanel from './NotifyDiagnosticsPanel';
import { persistUiScale, UiScalePreview } from './UiScaleSettings';
import { DENSITY_OPTIONS, FONT_SIZE_OPTIONS, uiScale, uiScaleLayoutWide, uiScaleSummary } from './ui-scale';
import { CONSOLE_HELP, useVoiceSettings, VOICE_UNSUPPORTED_TEXT } from './VoiceSettingsSection';
import MicDeviceSetting from './MicDeviceSetting';
import { MODE_LABELS, STREAM_UNAVAILABLE_HINT, streamingSupported } from './voice-stream-policy';
import { statusLabel, VOLC_CONSOLE_URL } from './voice-credentials-model';
import { openExternal } from './open-external';
import type { SettingsCategoryKey, SettingsDetailKey } from './settings-model';

type KeepAliveSnapshot = { available: boolean; running: boolean; error: string | null };

/** SettingsScreen 交给子页的全部状态与动作(和宽屏右栏读的是同一份)。 */
export type PhonePagesCtx = {
  cfg: HubConfig;
  show: (cat: SettingsCategoryKey, row: string) => boolean;
  detail: SettingsDetailKey | null;
  openDetail: (key: SettingsDetailKey) => void;
  closeDetail: () => void;
  // 账号
  profiles: HubProfile[];
  me: { username?: string };
  profileError: string;
  storageDiagnostics: DesktopStorageDiagnostics | null;
  tauriDesktop: boolean;
  onPickProfile: (profile: HubProfile) => void;
  onOpenProfileWindow: (profile: HubProfile) => void;
  onRemoveProfile: (profile: HubProfile) => void;
  onAddAccount: () => void;
  // 本地 Hub
  localHub: LocalHubResult | null;
  localHubBusy: boolean;
  localBackupMessage: string;
  localHubActions: { upgrade: () => void; restart: () => void; stop: () => void; logs: () => void; backup: () => void; openDelete: () => void };
  // 外观
  themePref: ThemePreference;
  themeModeNow: 'light' | 'dark';
  // 通知
  notify: NotifySettings;
  saveNotify: (next: NotifySettings) => void;
  nativeNotify: boolean;
  permission: { status: PermissionStatus; canAskAgain: boolean } | null;
  ensurePermission: () => Promise<boolean>;
  muted: readonly string[];
  unmute: (alias: string) => void;
  keepAliveState: KeepAliveSnapshot;
  keepAliveStatus: string;
  onKeepAliveChange: (value: boolean) => void;
  dndAccess: boolean | null | undefined;
  onDndBypassChange: (value: boolean) => void;
  openDndAccess: () => void;
  openXiaomiGuide: () => void;
  testMessage: string;
  sendTest: () => void;
  onSoundChange: (value: boolean) => void;
  notifyPreview: boolean;
  quietStart: string;
  quietEnd: string;
  setQuietStart: (v: string) => void;
  setQuietEnd: (v: string) => void;
  // 快捷键(只在窄的桌面窗口里会进到这一页):沿用宽屏那段渲染,放进一张卡片里。
  renderShortcuts: () => ReactNode;
  // 关于
  updateView: { label: string; detail?: string; tone: string; busy: boolean; actionable: boolean };
  onCheckUpdate: () => void;
};

export default function SettingsPhonePage({ page, ctx }: { page: SettingsCategoryKey; ctx: PhonePagesCtx }) {
  switch (page) {
    case 'account': return ctx.detail === 'manageAccounts' ? <ManageAccountsPage ctx={ctx} /> : <AccountPage ctx={ctx} />;
    case 'localHub': return <LocalHubPage ctx={ctx} />;
    case 'appearance': return <AppearancePage ctx={ctx} />;
    case 'notifications': return ctx.detail === 'quietHours' ? <QuietHoursEditPage ctx={ctx} /> : <NotificationsPage ctx={ctx} />;
    case 'voice': return <VoicePhonePage ctx={ctx} />;
    case 'shortcuts': return <ShortcutsPage ctx={ctx} />;
    case 'about': return <AboutPage ctx={ctx} />;
    default: return null;
  }
}

const profileName = (p: HubProfile) => p.displayName || p.username || 'Hub 账号';

// ── 账号 ─────────────────────────────────────────────────────────────────────────────────────
function AccountPage({ ctx }: { ctx: PhonePagesCtx }) {
  const { cfg, profiles, show } = ctx;
  const manageable = profiles.some(p => p.profileId !== LOCAL_HUB_PROFILE_ID) || ctx.tauriDesktop;
  return (
    <>
      {show('account', 'profiles') ? (
        <SettingsGroup
          title="Hub 账号"
          testID="settings-account-profiles"
          footer={ctx.profileError || (ctx.storageDiagnostics
            ? `本地数据:${ctx.storageDiagnostics.root} · ${ctx.storageDiagnostics.profile_count} 个账号${ctx.storageDiagnostics.corrupt_backups.length ? ` · 已保留 ${ctx.storageDiagnostics.corrupt_backups.length} 个损坏备份` : ''}`
            : undefined)}
          footerTone={ctx.profileError ? 'danger' : undefined}
        >
          {profiles.length ? profiles.map(profile => (
            // 点一行 = 切到这个账号(单选,当前的打 ✓);要重新登录的点了去验证。
            <SettingsChoiceRow
              key={profile.profileId}
              testID={`settings-profile-${profile.profileId}`}
              label={profileName(profile)}
              subtitle={profile.requiresReauth ? '需要重新登录 · 点击验证' : `${profile.serverUrl} · ${profile.username || '未知用户'}`}
              subtitleTone={profile.requiresReauth ? 'danger' : undefined}
              selected={profile.profileId === cfg.profileId}
              onPress={() => ctx.onPickProfile(profile)}
            />
          )) : [
            <SettingsRow key="server" label="服务器" value={cfg.serverUrl} />,
            <SettingsRow key="user" label="用户名" value={ctx.me.username ?? cfg.username ?? '—'} />,
          ]}
        </SettingsGroup>
      ) : null}
      {show('account', 'addAccount') || manageable ? (
        <SettingsGroup>
          {show('account', 'addAccount') ? <SettingsRow label="添加 Hub / 账号" onPress={ctx.onAddAccount} testID="settings-add-account" /> : null}
          {manageable && profiles.length ? <SettingsRow label="管理账号" onPress={() => ctx.openDetail('manageAccounts')} testID="settings-manage-accounts" /> : null}
        </SettingsGroup>
      ) : null}
    </>
  );
}

/** 三级页:每个账号一组(新窗口打开 · 移除)。当前账号的「移除」= 列表底部的退出登录,这里同样可用。 */
function ManageAccountsPage({ ctx }: { ctx: PhonePagesCtx }) {
  return (
    <>
      {ctx.profiles.map(profile => {
        const canOpen = ctx.tauriDesktop && !profile.requiresReauth;
        const canRemove = profile.profileId !== LOCAL_HUB_PROFILE_ID;
        if (!canOpen && !canRemove) return null;
        return (
          <SettingsGroup key={profile.profileId} title={`${profileName(profile)}${profile.profileId === ctx.cfg.profileId ? ' · 当前' : ''}`} footer={`${profile.serverUrl}${profile.networkId ? ` · ${profile.networkId}` : ''}`}>
            {canOpen ? <SettingsRow label="在新窗口打开" onPress={() => ctx.onOpenProfileWindow(profile)} accessibilityLabel={`在新窗口打开 ${profile.displayName || profile.username || profile.serverUrl}`} /> : null}
            {canRemove ? <SettingsRow label="移除账号" tone="danger" chevron={false} onPress={() => ctx.onRemoveProfile(profile)} accessibilityLabel={`移除 ${profile.username || profile.serverUrl}`} testID={`settings-remove-${profile.profileId}`} /> : null}
          </SettingsGroup>
        );
      })}
      <SettingsGroup footer="只删除这个账号在本机的凭据和本地目录,不影响其他 Hub。" />
    </>
  );
}

// ── 本地 Hub ─────────────────────────────────────────────────────────────────────────────────
function LocalHubPage({ ctx }: { ctx: PhonePagesCtx }) {
  const { localHub, show, localHubBusy: busy } = ctx;
  const a = ctx.localHubActions;
  if (!localHub) return null;
  const state = localHub.state === 'running' || localHub.state === 'running_external' ? '运行中' : localHub.state === 'error' ? '异常' : '已停止';
  const needsUpgrade = localHub.requiresMigration || (localHub.error ?? '').includes('version mismatch');
  return (
    <>
      <SettingsGroup footer={localHub.error || ctx.profileError || undefined} footerTone="danger" testID="local-hub-settings-card">
        {show('localHub', 'status') ? <SettingsRow label="状态" value={state} valueTone={localHub.state === 'error' ? 'danger' : undefined} /> : null}
        {show('localHub', 'endpoint') ? <SettingsRow label="地址" value={localHub.endpoint} /> : null}
        {show('localHub', 'hubVersion') ? <SettingsRow label="Hub 版本" value={localHub.hubVersion} /> : null}
      </SettingsGroup>
      <SettingsGroup footer={ctx.localBackupMessage || '重新启动:停止当前 Hub 进程后用捆绑版本重新拉起。'}>
        {needsUpgrade && show('localHub', 'restart') ? (
          <SettingsRow testID="local-hub-upgrade" label={busy ? '升级中…' : `升级本地 Hub 到 ${localHub.expectedHubVersion ?? '当前捆绑版本'}`} tone="accent" disabled={busy} onPress={a.upgrade} />
        ) : null}
        {show('localHub', 'restart') ? <SettingsRow label="重新启动" busy={busy} disabled={busy} onPress={a.restart} chevron={false} /> : null}
        {show('localHub', 'stop') ? <SettingsRow label="停止" disabled={busy || localHub.state === 'stopped'} onPress={a.stop} chevron={false} /> : null}
        {show('localHub', 'logs') ? <SettingsRow label="打开日志" onPress={a.logs} /> : null}
        {show('localHub', 'backup') ? <SettingsRow label="立即备份" busy={busy} disabled={busy} onPress={a.backup} chevron={false} /> : null}
      </SettingsGroup>
      {show('localHub', 'deleteLocal') ? (
        <>
          <SettingsButton variant="destructive" label="删除本地工作区数据…" onPress={a.openDelete} testID="settings-danger-zone" />
          <SettingsGroup footer="先完整备份到 ~/.anet/app/backups,再删除本地 Hub 数据与系统凭据。" />
        </>
      ) : null}
    </>
  );
}

// ── 外观 ─────────────────────────────────────────────────────────────────────────────────────
function AppearancePage({ ctx }: { ctx: PhonePagesCtx }) {
  const r = uiScale();
  const summary = uiScaleSummary(r, uiScaleLayoutWide());
  const anyStored = !r.fontIsDefault || !r.densityIsDefault;
  return (
    <>
      {ctx.show('appearance', 'theme') ? (
        <SettingsGroup title="主题" footer={themePreferenceSummary(ctx.themePref, ctx.themeModeNow)} testID="settings-theme-row">
          {THEME_PREFERENCES.map(option => (
            <SettingsChoiceRow
              key={option}
              testID={`settings-theme-${option}`}
              label={THEME_PREFERENCE_LABEL[option]}
              selected={ctx.themePref === option}
              onPress={() => {
                if (ctx.themePref === option) return;
                setThemePreference(option);
                void saveThemeMode(option);
              }}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {ctx.show('appearance', 'fontSize') ? (
        <SettingsGroup title="字体大小" footer={[summary.font, summary.osNote].filter(Boolean).join(' · ')} testID="settings-font-size-row">
          {FONT_SIZE_OPTIONS.map(o => (
            // 选「只是默认」的那项 = 显式存下来(折叠/展开不再改它);选已存的那项不动。同宽屏 Segmented。
            <SettingsChoiceRow key={o.key} testID={`settings-font-size-${o.key}`} label={o.label} selected={r.font === o.key} onPress={() => { if (r.font !== o.key || r.fontIsDefault) persistUiScale({ font: o.key }); }} />
          ))}
        </SettingsGroup>
      ) : null}
      {ctx.show('appearance', 'density') ? (
        <SettingsGroup title="界面密度" footer={`${summary.density} · 图标、头像、行高和间距`} testID="settings-density-row">
          {DENSITY_OPTIONS.map(o => (
            <SettingsChoiceRow key={o.key} testID={`settings-density-${o.key}`} label={o.label} selected={r.density === o.key} onPress={() => { if (r.density !== o.key || r.densityIsDefault) persistUiScale({ density: o.key }); }} />
          ))}
        </SettingsGroup>
      ) : null}
      {ctx.show('appearance', 'fontSize') || ctx.show('appearance', 'density') ? (
        <>
          <SettingsGroup title="预览">
            <SettingsCardContent><UiScalePreview /></SettingsCardContent>
          </SettingsGroup>
          <SettingsButton variant="plain" label="恢复默认" accessibilityLabel="恢复默认字体大小和界面密度" disabled={!anyStored} onPress={() => persistUiScale({ font: null, density: null })} testID="settings-ui-scale-reset" />
        </>
      ) : null}
    </>
  );
}

// ── 通知 ─────────────────────────────────────────────────────────────────────────────────────
function NotificationsPage({ ctx }: { ctx: PhonePagesCtx }) {
  const { notify, show, saveNotify } = ctx;
  const permissionOff = ctx.nativeNotify && notify.enabled && ctx.permission && ctx.permission.status !== 'granted';
  const androidRows = show('notifications', 'keepAlive') || show('notifications', 'dndBypass') || show('notifications', 'xiaomiGuide');
  const dndNote = notify.dndBypass && ctx.dndAccess === true ? '勿扰权限已授权。' : null;
  return (
    <>
      {show('notifications', 'enabled') ? (
        <SettingsGroup testID="notify-settings-card" footer="agent 发来消息、而你没在看那个会话时,发一条系统通知。">
          <SettingsSwitchRow
            testID="notify-enabled-row"
            label="新消息通知"
            value={notify.enabled}
            onValueChange={value => { saveNotify({ ...notify, enabled: value }); if (value) void ctx.ensurePermission(); }}
          />
          {permissionOff ? <SettingsRow testID="notify-permission-fix" label="系统通知权限未开启" tone="danger" value="去开启" onPress={() => { void ctx.ensurePermission(); }} /> : null}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'mode') ? (
        <SettingsGroup title="提醒方式" footer={notify.mode === 'new' ? '同一个 agent 有未看的通知时,后续消息只更新条数、不再响铃。' : '每条新消息都响铃并弹出横幅。'} testID="notify-mode-row">
          {([['all', '每条消息'], ['new', '仅新消息']] as const).map(([mode, label]) => (
            <SettingsChoiceRow key={mode} testID={`notify-mode-${mode}`} label={label} selected={notify.mode === mode} disabled={!notify.enabled} onPress={() => saveNotify({ ...notify, mode })} />
          ))}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'sound') || show('notifications', 'quiet') ? (
        <SettingsGroup footer={notify.quiet.enabled ? `${notify.quiet.start} – ${notify.quiet.end} 之间不提醒。` : undefined}>
          {show('notifications', 'sound') ? <SettingsSwitchRow label="消息提示音" value={notify.soundEnabled} onValueChange={ctx.onSoundChange} /> : null}
          {show('notifications', 'quiet') ? <SettingsSwitchRow label="免打扰时段" value={notify.quiet.enabled} onValueChange={value => saveNotify({ ...notify, quiet: { ...notify.quiet, enabled: value } })} /> : null}
          {show('notifications', 'quiet') && notify.quiet.enabled ? (
            <SettingsRow testID="notify-quiet-hours" label="时段" value={`${notify.quiet.start} – ${notify.quiet.end}`} onPress={() => ctx.openDetail('quietHours')} />
          ) : null}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'muted') ? (
        <SettingsGroup
          title="消息免打扰的 agent"
          testID="notify-muted-row"
          footer={ctx.muted.length ? '这些 agent 的消息照常收,只是不发系统通知。' : (ctx.nativeNotify ? '在会话右上角点铃铛,可以对单个 agent 免打扰。' : '在 agent 列表里右键 →「消息免打扰」。')}
        >
          {ctx.muted.map(alias => (
            <SettingsRow key={alias} label={alias} value="取消" valueTone="accent" chevron={false} onPress={() => ctx.unmute(alias)} accessibilityLabel={`取消 ${alias} 的免打扰`} />
          ))}
        </SettingsGroup>
      ) : null}
      {androidRows ? (
        <SettingsGroup
          title="后台"
          footer={[ctx.keepAliveStatus || '切到后台后继续接收消息;会常驻一条低优先级通知,耗电多一些。', dndNote].filter(Boolean).join(' ')}
          footerTone={ctx.keepAliveState.error ? 'danger' : undefined}
        >
          {show('notifications', 'keepAlive') ? (
            <SettingsSwitchRow testID="notify-keepalive-row" label="后台保持连接" value={notify.keepAlive} disabled={!notify.enabled || !ctx.keepAliveState.available} onValueChange={ctx.onKeepAliveChange} />
          ) : null}
          {show('notifications', 'dndBypass') ? (
            <SettingsSwitchRow testID="notify-dnd-row" label="免打扰时仍然提醒" subtitle="系统勿扰时照样弹出并响铃" value={notify.dndBypass} disabled={!notify.enabled} onValueChange={ctx.onDndBypassChange} />
          ) : null}
          {show('notifications', 'dndBypass') && notify.dndBypass && ctx.dndAccess === false ? (
            <SettingsRow testID="notify-dnd-grant" label="还没有勿扰权限" tone="danger" value="去授权" onPress={ctx.openDndAccess} />
          ) : null}
          {show('notifications', 'xiaomiGuide') ? <SettingsRow testID="notify-xiaomi-guide" label="小米/HyperOS 后台设置指引" onPress={ctx.openXiaomiGuide} /> : null}
        </SettingsGroup>
      ) : null}
      {show('notifications', 'test') ? (
        <SettingsGroup footer={ctx.testMessage || '立即发一条通知,确认系统通知能弹出来。'} testID="notify-test-row">
          <SettingsRow label="发送测试通知" value="发送" valueTone="accent" chevron={false} onPress={ctx.sendTest} />
        </SettingsGroup>
      ) : null}
      {show('notifications', 'diagnostics') ? (
        <SettingsGroup title="通知诊断" footer={`没收到通知时,把上面的信息复制给维护者。${ctx.nativeNotify ? '你正开着的会话不提示;在应用里看着别的会话时照常提示。' : '新消息会在系统栏和系统通知里提示;你正开着的会话不提示。'}`}>
          {ctx.notifyPreview ? null : <SettingsCardContent><NotifyDiagnosticsPanel /></SettingsCardContent>}
        </SettingsGroup>
      ) : null}
    </>
  );
}

// ── 语音输入 ─────────────────────────────────────────────────────────────────────────────────
function VoicePhonePage({ ctx }: { ctx: PhonePagesCtx }) {
  // 一个 hook 实例同时服务子页和它的两个三级页:表单改到一半在 API Key ↔ 高级 之间切换不丢。
  const v = useVoiceSettings();
  if (ctx.detail === 'voiceApiKey') return <VoiceApiKeyEditPage v={v} ctx={ctx} />;
  if (ctx.detail === 'voiceAdvanced') return <VoiceAdvancedEditPage v={v} ctx={ctx} />;
  if (v.storage === 'unsupported') return <SettingsGroup testID="voice-settings-unsupported" footer={VOICE_UNSUPPORTED_TEXT} />;
  const { show } = ctx;
  const { status } = v;
  const modeNote: { text: string; tone?: SettingsTone } = !streamingSupported(v.platform)
    ? { text: '桌面版只支持极速版(说完再出字);边说边出字目前只在手机 App 上。' }
    : v.mode === 'stream' && v.unavailable ? { text: STREAM_UNAVAILABLE_HINT, tone: 'accent' }
      : v.mode === 'stream' ? { text: '边说边出字;没开通流式会自动改用极速版。' }
        : { text: '松手后整句识别一次。' };
  const credNote = status.configured && (status.console === 'old' || status.customEndpoint || status.customStreamEndpoint)
    ? `${status.console === 'old' ? `旧版控制台 · App ID ${status.appId}` : '新版控制台 · API Key'}${status.customEndpoint || status.customStreamEndpoint ? ' · 自定义接口地址' : ''}`
    : '只保存在本机,不会上传到 Hub。';
  const t = v.test;
  const testValue = t.kind === 'recording' ? `录音中 ${v.secondsLeft}s` : t.kind === 'transcribing' ? '识别中…' : '';
  const testFooter = (t.kind === 'recording' || t.kind === 'transcribing') && v.interim ? v.interim
    : t.kind === 'done' ? `${t.text ? `识别结果(${t.via === 'stream' ? '流式' : '极速版'}):${t.text}` : '没有识别到文字(静音?)'}${t.note ? `\n${t.note}` : ''}`
      : t.kind === 'error' ? t.message
        : status.configured ? '点一下后说 3 秒话,显示识别出的文字。' : '先配置 API Key。';
  return (
    <>
      {show('voice', 'mode') ? (
        <SettingsGroup title="识别模型" footer={modeNote.text} footerTone={modeNote.tone} testID="voice-mode">
          {v.choices.map(m => (
            <SettingsChoiceRow key={m} testID={`voice-mode-${m}`} label={MODE_LABELS[m]} selected={v.mode === m || v.choices.length === 1} onPress={() => v.onPickMode(m)} />
          ))}
        </SettingsGroup>
      ) : null}
      {show('voice', 'credentials') ? (
        <>
          <SettingsGroup title="凭据" footer={credNote}>
            <SettingsRow
              testID="voice-api-key-row"
              label="API Key"
              busy={!v.loaded}
              value={v.loaded ? (status.configured ? statusLabel(status).replace(' ✓', '') : '未配置') : undefined}
              valueTone={status.configured ? 'accent' : undefined}
              onPress={() => ctx.openDetail('voiceApiKey')}
            />
          </SettingsGroup>
          <SettingsGroup title="帮助" footer={CONSOLE_HELP}>
            <SettingsRow testID="voice-console-link" label="在火山引擎控制台开通" external onPress={() => { void openExternal(VOLC_CONSOLE_URL).catch(() => {}); }} />
            <SettingsRow testID="voice-advanced-toggle" label="高级 / 旧版控制台" onPress={() => ctx.openDetail('voiceAdvanced')} />
          </SettingsGroup>
        </>
      ) : null}
      {/* 麦克风选择只在 webview 里有(窄的桌面窗口);手机走原生录音,没有这一栏。 */}
      {show('voice', 'mic') && Platform.OS === 'web' ? (
        // MicDeviceSetting 自带「麦克风」标题,组上不再重复。
        <SettingsGroup>
          <SettingsCardContent><MicDeviceSetting /></SettingsCardContent>
        </SettingsGroup>
      ) : null}
      {show('voice', 'test') ? (
        <SettingsGroup footer={testFooter} footerTone={t.kind === 'error' ? 'danger' : undefined} testID="voice-test-group">
          <SettingsRow testID="voice-test" label="测试语音识别" value={testValue} busy={v.testBusy} disabled={v.testBusy || !status.configured} onPress={() => void v.onTest()} />
        </SettingsGroup>
      ) : null}
    </>
  );
}

// ── 快捷键(窄的桌面窗口)─────────────────────────────────────────────────────────────────────
function ShortcutsPage({ ctx }: { ctx: PhonePagesCtx }) {
  return (
    <SettingsGroup testID="settings-section-shortcuts">
      <SettingsCardContent>{ctx.renderShortcuts()}</SettingsCardContent>
    </SettingsGroup>
  );
}

// ── 关于 ─────────────────────────────────────────────────────────────────────────────────────
function AboutPage({ ctx }: { ctx: PhonePagesCtx }) {
  const view = ctx.updateView;
  const tone: SettingsTone | undefined = view.tone === 'danger' ? 'danger' : view.tone === 'accent' ? 'accent' : undefined;
  return (
    <SettingsGroup footer={view.detail} testID="settings-about">
      {ctx.show('about', 'version') ? <SettingsRow label="版本" value={`v${APP_VERSION}`} /> : null}
      {ctx.show('about', 'update') ? (
        <SettingsRow
          testID="settings-update-row"
          label="软件更新"
          value={view.label}
          valueTone={tone}
          busy={view.busy}
          chevron={view.actionable && !view.busy}
          onPress={view.actionable ? ctx.onCheckUpdate : undefined}
        />
      ) : null}
    </SettingsGroup>
  );
}
