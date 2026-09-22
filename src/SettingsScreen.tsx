import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HubConfig } from './api';
import { DesktopStorageDiagnostics, HubProfile, getDesktopStorageDiagnostics, listHubProfiles, removeHubProfile, saveThemeMode } from './storage';
import { colors, onThemeChange, setThemeMode, spacing, themeMode } from './theme';
import { APP_VERSION } from './version';
import { appFetch } from './app-fetch';
import { checkDesktopUpdate, desktopUpdateSnapshot, subscribeDesktopUpdates } from './desktop-updater';
import { backupLocalHubData, deleteLocalHubData, LOCAL_HUB_PROFILE_ID, localHubStatus, openLocalHubLogs, restartLocalHub, stopLocalHub, type LocalHubResult } from './local-hub';
import { openWorkspaceWindow } from './desktop-chat-menu';
import { loadNotifySettings, saveNotifySettings, subscribeNotifySettings } from './notify-settings';
import { playChime } from './chime';
import { SETTINGS_CATEGORIES, activeCategoryKey, filterSettings, visibleRowKeys, type SettingsCategoryKey } from './settings-model';

// Settings (Vincent tg 720): who am I, where am I connected, which network, which build —
// and the destructive actions live here instead of cluttering the agents list header.
//
// 0.2.83(Vincent 2026-09-20「设置改为这种样式和交互吧」,参照 Claude 桌面端):
//   左栏 = 搜索框 + 分类列表(图标 + 名字,当前项高亮);右栏 = 分类标题 + 「标签在左、控件在右」
//   的行,需要说明的行下面一句灰字;段与段之间细线。搜索按行标签跨分类筛。
//   分类与可搜行的**模型**在 settings-model.ts(纯逻辑、有测试);这里只负责把真实状态渲染进去。
//   0.2.80 的滚动修复保留:右栏是 ScrollView,padding 在 contentContainer 上。

interface Me {
  username?: string;
  networkName?: string;
  networkId?: string;
}

export default function SettingsScreen({
  cfg,
  onClose,
  onLogout,
  onLocalDataDeleted,
  onAddAccount,
  onSwitchProfile,
  onReauthProfile,
}: {
  cfg: HubConfig;
  /** 桌面端:左上角关闭按钮。不传就不画(手机端设置是一个 tab,没有「关闭」)。 */
  onClose?: () => void;
  onLogout: () => void | Promise<void>;
  onLocalDataDeleted: () => void | Promise<void>;
  onAddAccount: () => void;
  onSwitchProfile: (profileId: string) => void | Promise<void>;
  onReauthProfile: (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => void;
}) {
  const [me, setMe] = useState<Me>({});
  const [profiles, setProfiles] = useState<HubProfile[]>([]);
  const [removeTarget, setRemoveTarget] = useState<HubProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [storageDiagnostics, setStorageDiagnostics] = useState<DesktopStorageDiagnostics | null>(null);
  const [localHub, setLocalHub] = useState<LocalHubResult | null>(null);
  const [localHubBusy, setLocalHubBusy] = useState(false);
  const [localBackupMessage, setLocalBackupMessage] = useState('');
  const [localDeleteVisible, setLocalDeleteVisible] = useState(false);
  const [localDeleteText, setLocalDeleteText] = useState('');
  const update = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);
  // 0.2.76 通知设置(桌面端落 localStorage)
  const notify = useSyncExternalStore(subscribeNotifySettings, loadNotifySettings, loadNotifySettings);
  const [quietStart, setQuietStart] = useState(notify.quiet.start);
  const [quietEnd, setQuietEnd] = useState(notify.quiet.end);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SettingsCategoryKey>('account');
  const { width } = useWindowDimensions();
  const compact = width < 640;

  useEffect(() => {
    void Promise.all([listHubProfiles(), getDesktopStorageDiagnostics()]).then(([registry, diagnostics]) => {
      setProfiles(registry.profiles);
      setStorageDiagnostics(diagnostics);
    }).catch(error => setProfileError(String(error)));
  }, [cfg.profileId]);

  useEffect(() => {
    if (cfg.profileId !== LOCAL_HUB_PROFILE_ID && !profiles.some(profile => profile.profileId === LOCAL_HUB_PROFILE_ID)) return;
    void localHubStatus().then(setLocalHub).catch(error => setProfileError(String(error)));
  }, [cfg.profileId, profiles]);

  useEffect(() => {
    (async () => {
      try {
        const res = await appFetch(`${cfg.serverUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${cfg.token}` },
        });
        const d = await res.json();
        const net =
          d?.networks?.find((n: any) => n.network_id === cfg.networkId) ?? d?.networks?.[0];
        setMe({
          username: d?.user?.username,
          networkName: net?.network_name,
          networkId: net?.network_id,
        });
      } catch {
        /* rows fall back to stored config */
      }
    })();
  }, [cfg]);

  const tauriDesktop = !!(globalThis as any).__TAURI_INTERNALS__;
  const filtered = useMemo(() => filterSettings(query, { localHub: !!localHub }), [query, localHub]);
  const searching = query.trim().length > 0;
  const visible = useMemo(() => visibleRowKeys(query, filtered), [query, filtered]);
  const active = activeCategoryKey(category, filtered);
  const show = (cat: SettingsCategoryKey, row: string) => visible === null || visible.has(`${cat}.${row}`);
  // 不在搜索:只画选中的那一类;搜索中:把所有命中的类都画出来(各带小标题)。
  const sectionsToRender = searching ? filtered.map(c => c.key) : [active];
  const paneTitle = searching ? '搜索结果' : (SETTINGS_CATEGORIES.find(c => c.key === active)?.label ?? '设置');

  const sidebar = (
    <View style={[styles.sidebar, compact && styles.sidebarCompact]} testID="settings-sidebar">
      <View style={styles.sidebarTop}>
        {onClose ? (
          <Pressable accessibilityLabel="关闭设置" accessibilityRole="button" onPress={onClose} hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}>
            <Ionicons name="close" size={18} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={15} color={colors.textMuted} />
          <TextInput
            accessibilityLabel="搜索设置"
            value={query}
            onChangeText={setQuery}
            placeholder="搜索设置"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable accessibilityLabel="清除搜索" onPress={() => setQuery('')} hitSlop={6}>
              <Ionicons name="close-circle" size={15} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={compact ? styles.categoryRow : styles.categoryList}>
        {filtered.map(cat => {
          const isActive = !searching && cat.key === active;
          return (
            <Pressable
              key={cat.key}
              accessibilityLabel={`设置分类 ${cat.label}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => { setCategory(cat.key); if (searching) setQuery(''); }}
              style={({ pressed, hovered }: any) => [styles.categoryItem, compact && styles.categoryChip, (hovered || pressed) && styles.categoryItemHover, isActive && styles.categoryItemActive]}
            >
              <Ionicons name={cat.icon as any} size={17} color={isActive ? colors.text : colors.textSecondary} />
              <Text style={[styles.categoryLabel, isActive && styles.categoryLabelActive]} numberOfLines={1}>{cat.label}</Text>
            </Pressable>
          );
        })}
        {searching && filtered.length === 0 ? <Text style={styles.emptySide}>没有匹配的设置</Text> : null}
      </ScrollView>
    </View>
  );

  const heading = (cat: SettingsCategoryKey) => searching
    ? <Text style={styles.groupTitle}>{SETTINGS_CATEGORIES.find(c => c.key === cat)?.label}</Text>
    : null;

  return (
    <View style={[styles.root, !compact && styles.rootWide]}>
      {sidebar}
      <View style={styles.pane} testID="settings-pane">
        <Text style={styles.paneTitle}>{paneTitle}</Text>
        {/* 0.2.80(Vincent 2026-09-19「设置页面往下面滑动不了」):右栏是 ScrollView,padding 在
            contentContainer 上——留在滚动根上的话它在可滚区域之外,最后一行照样贴着窗口底边。 */}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator
          testID="settings-scroll"
        >
          {searching && filtered.length === 0 ? (
            <Text style={styles.emptyPane}>没有匹配「{query.trim()}」的设置</Text>
          ) : null}

          {sectionsToRender.includes('account') ? (
            <View style={styles.section} testID="settings-section-account">
              {heading('account')}
              {show('account', 'profiles') ? (
                <>
                  {profiles.length ? profiles.map((profile, index) => {
                    const isCurrent = profile.profileId === cfg.profileId;
                    return (
                      <View key={profile.profileId}>
                        {index ? <Divider /> : null}
                        <Pressable
                          accessibilityLabel={`切换到 ${profile.displayName || profile.username || profile.serverUrl}`}
                          style={({ pressed }) => [styles.profileRow, pressed && { opacity: 0.65 }]}
                          onPress={() => {
                            if (profile.requiresReauth) return onReauthProfile(profile);
                            if (!isCurrent) void Promise.resolve(onSwitchProfile(profile.profileId)).catch(error => setProfileError(String(error)));
                          }}
                        >
                          <View style={styles.profileCopy}>
                            <Text style={styles.rowLabelStrong}>{profile.displayName || profile.username || 'Hub 账号'}{isCurrent ? ' · 当前' : ''}</Text>
                            <Text style={styles.rowHint} numberOfLines={1}>{profile.serverUrl} · {profile.username || '未知用户'}{profile.networkId ? ` · ${profile.networkId}` : ''}</Text>
                            {profile.requiresReauth ? <Text style={styles.dangerHint}>需要重新登录 · 点击验证</Text> : null}
                          </View>
                          {tauriDesktop && !profile.requiresReauth ? (
                            // 应用多开(Vincent 2026-09-07):给这个账号开一个独立工作区窗口,主窗口的当前账号不动;同一账号再点就聚焦已开的窗。
                            <Pressable accessibilityLabel={`在新窗口打开 ${profile.displayName || profile.username || profile.serverUrl}`} onPress={event => { event.stopPropagation(); void openWorkspaceWindow(profile).catch(error => setProfileError(String(error))); }} hitSlop={8} style={styles.inlineButton}>
                              <Text style={styles.accentText}>新窗口</Text>
                            </Pressable>
                          ) : null}
                          {profile.profileId !== LOCAL_HUB_PROFILE_ID ? (
                            <Pressable accessibilityLabel={`移除 ${profile.username || profile.serverUrl}`} onPress={event => { event.stopPropagation(); setRemoveTarget(profile); }} hitSlop={8} style={styles.inlineButton}>
                              <Text style={styles.dangerText}>移除</Text>
                            </Pressable>
                          ) : null}
                        </Pressable>
                      </View>
                    );
                  }) : (
                    <>
                      <ValueRow label="服务器" value={cfg.serverUrl} />
                      <Divider />
                      <ValueRow label="用户名" value={me.username ?? cfg.username ?? '—'} />
                    </>
                  )}
                  {profileError ? <Text style={styles.errorText}>{profileError}</Text> : null}
                  {storageDiagnostics ? (
                    <Text style={styles.footHint} numberOfLines={2}>
                      本地数据：{storageDiagnostics.root} · {storageDiagnostics.profile_count} profiles
                      {storageDiagnostics.corrupt_backups.length ? ` · 已保留 ${storageDiagnostics.corrupt_backups.length} 个损坏备份` : ''}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {show('account', 'addAccount') ? (
                <>
                  <Divider />
                  <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={onAddAccount} accessibilityRole="button">
                    <Text style={styles.accentText}>＋ 添加 Hub / 账号</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                </>
              ) : null}
              {show('account', 'logout') && cfg.profileId !== LOCAL_HUB_PROFILE_ID ? (
                <>
                  <Divider />
                  <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={onLogout} accessibilityRole="button">
                    <View style={styles.rowCopy}>
                      <Text style={styles.dangerText}>移除当前账号</Text>
                      <Text style={styles.rowHint}>只删除这个 profile 的凭据和本地目录，不影响其他 Hub。</Text>
                    </View>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {sectionsToRender.includes('localHub') && localHub ? (
            <View style={styles.section} testID="local-hub-settings-card">
              {heading('localHub')}
              {show('localHub', 'status') ? <ValueRow label="状态" value={localHub.state === 'running' || localHub.state === 'running_external' ? '运行中' : localHub.state === 'error' ? '异常' : '已停止'} /> : null}
              {show('localHub', 'endpoint') ? <><Divider /><ValueRow label="地址" value={localHub.endpoint} /></> : null}
              {show('localHub', 'hubVersion') ? <><Divider /><ValueRow label="Hub 版本" value={localHub.hubVersion} /></> : null}
              {localHub.error ? <Text style={styles.errorText}>{localHub.error}</Text> : null}
              {/* app#246(Vincent 2026-09-05「版本低了就加个触发安装的按钮」):本地数据还是旧版 Hub 写的
                  (requiresMigration)或端口上跑着旧版 sidecar(version mismatch)时,给一个显式的升级入口。
                  它做的事 = 重新启动:停掉旧 sidecar → 备份 → 迁移 → 用捆绑的 Hub 接管。 */}
              {(localHub.requiresMigration || (localHub.error ?? '').includes('version mismatch')) && show('localHub', 'restart') ? (
                <>
                  <Divider />
                  <Pressable disabled={localHubBusy} testID="local-hub-upgrade" style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={() => {
                    setLocalHubBusy(true);
                    setProfileError('');
                    void restartLocalHub().then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
                  }}>
                    <Text style={styles.accentText}>{localHubBusy ? '升级中…' : `升级本地 Hub 到 ${localHub.expectedHubVersion ?? '当前捆绑版本'}`}</Text>
                  </Pressable>
                </>
              ) : null}
              {show('localHub', 'restart') ? <><Divider /><ActionRow label="重新启动" hint="停止当前 Hub 进程后用捆绑版本重新拉起。" busy={localHubBusy} onPress={() => {
                setLocalHubBusy(true);
                void restartLocalHub().then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }} /></> : null}
              {show('localHub', 'stop') ? <><Divider /><ActionRow label="停止" disabled={localHubBusy || localHub.state === 'stopped'} onPress={() => {
                setLocalHubBusy(true);
                void stopLocalHub().then(() => localHubStatus()).then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }} /></> : null}
              {show('localHub', 'logs') ? <><Divider /><ActionRow label="打开日志" onPress={() => { void openLocalHubLogs().catch(error => setProfileError(String(error))); }} /></> : null}
              {show('localHub', 'backup') ? <><Divider /><ActionRow label="立即备份" hint={localBackupMessage || undefined} busy={localHubBusy} onPress={() => {
                setLocalHubBusy(true);
                setLocalBackupMessage('');
                void backupLocalHubData().then(result => setLocalBackupMessage(`备份已保存：${result.path}`)).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }} /></> : null}
              {show('localHub', 'deleteLocal') ? (
                // 唯一的毁灭性动作单独一块:红边、和其它按钮隔开、要输入确认词。
                <View style={styles.dangerZone} testID="settings-danger-zone">
                  <Text style={styles.dangerZoneTitle}>危险区</Text>
                  <Pressable style={({ pressed }) => [styles.row, styles.dangerZoneRow, pressed && { opacity: 0.6 }]} onPress={() => { setLocalDeleteText(''); setLocalDeleteVisible(true); }} accessibilityRole="button">
                    <View style={styles.rowCopy}>
                      <Text style={styles.dangerText}>删除本地工作区数据…</Text>
                      <Text style={styles.rowHint}>先完整备份到 ~/.anet/app/backups，再删除本地 Hub 数据与系统凭据。</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.failed} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {sectionsToRender.includes('appearance') ? (
            <View style={styles.section}>
              {heading('appearance')}
              {show('appearance', 'theme') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="主题"
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    const next = themeMode() === 'dark' ? 'light' : 'dark';
                    setThemeMode(next);
                    saveThemeMode(next);
                  }}
                >
                  <Text style={styles.rowLabel}>主题</Text>
                  <View style={styles.dropdownValue}>
                    <Text style={styles.rowValue}>{themeMode() === 'dark' ? '深色' : '浅色'}</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {sectionsToRender.includes('notifications') ? (
            <View style={styles.section} testID="notify-settings-card">
              {heading('notifications')}
              {show('notifications', 'sound') ? (
                <View style={styles.row}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel}>消息提示音</Text>
                    <Text style={styles.rowHint}>新消息到达时响一声。</Text>
                  </View>
                  <Switch
                    accessibilityLabel="消息提示音"
                    value={notify.soundEnabled}
                    onValueChange={value => {
                      const next = { ...notify, soundEnabled: value };
                      saveNotifySettings(next);
                      if (value) playChime();
                    }}
                    trackColor={{ true: colors.accent, false: colors.border }}
                    thumbColor={colors.card}
                  />
                </View>
              ) : null}
              {show('notifications', 'quiet') ? (
                <>
                  <Divider />
                  <View style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowLabel}>免打扰时段</Text>
                      <Text style={styles.rowHint}>{notify.quiet.enabled ? `${notify.quiet.start} – ${notify.quiet.end} 之间不提醒。` : '关闭时全天提醒。'}</Text>
                    </View>
                    <Switch
                      accessibilityLabel="免打扰时段"
                      value={notify.quiet.enabled}
                      onValueChange={value => { saveNotifySettings({ ...notify, quiet: { ...notify.quiet, enabled: value } }); }}
                      trackColor={{ true: colors.accent, false: colors.border }}
                      thumbColor={colors.card}
                    />
                  </View>
                  {notify.quiet.enabled ? (
                    <View style={[styles.row, styles.quietRow]}>
                      <Text style={styles.rowLabel}>从</Text>
                      <TextInput
                        accessibilityLabel="免打扰开始时间"
                        style={styles.quietInput}
                        value={quietStart}
                        onChangeText={setQuietStart}
                        onBlur={() => saveNotifySettings({ ...notify, quiet: { ...notify.quiet, start: quietStart } })}
                        placeholder="22:00"
                        placeholderTextColor={colors.textMuted}
                      />
                      <Text style={styles.rowLabel}>到</Text>
                      <TextInput
                        accessibilityLabel="免打扰结束时间"
                        style={styles.quietInput}
                        value={quietEnd}
                        onChangeText={setQuietEnd}
                        onBlur={() => saveNotifySettings({ ...notify, quiet: { ...notify.quiet, end: quietEnd } })}
                        placeholder="08:00"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}
              {!searching ? <><Divider /><Text style={styles.footHint}>新消息会在系统栏和系统通知里提示;你正开着的会话不提示。</Text></> : null}
            </View>
          ) : null}

          {sectionsToRender.includes('about') ? (
            <View style={styles.section}>
              {heading('about')}
              {show('about', 'version') ? <ValueRow label="版本" value={`v${APP_VERSION}`} /> : null}
              {show('about', 'update') ? (
                <>
                  <Divider />
                  <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={() => { void checkDesktopUpdate(); }} disabled={update.kind === 'checking'} accessibilityRole="button">
                    <Text style={styles.rowLabel}>软件更新</Text>
                    {update.kind === 'checking' ? <ActivityIndicator color={colors.accent} /> : (
                      <View style={styles.dropdownValue}>
                        <Text style={styles.rowValue}>{update.kind === 'available' ? `发现 v${update.version}` : update.kind === 'up-to-date' ? '已是最新版' : update.kind === 'error' ? '检查失败，点击重试' : '检查更新'}</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                      </View>
                    )}
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </View>

      {/* 两个确认弹窗是 ScrollView 的兄弟不是子节点:Modal 套进滚动容器里会继承它的
          触摸处理,背板也不再铺满窗口。 */}
      <Modal visible={!!removeTarget} transparent animationType="fade" onRequestClose={() => setRemoveTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>移除这个账号？</Text>
            <Text style={styles.modalBody}>{removeTarget ? `${removeTarget.serverUrl} · ${removeTarget.username}` : ''}\n只删除这个 profile 的系统凭据和本地目录，不影响其他 Hub。</Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setRemoveTarget(null)}><Text style={styles.rowValue}>返回</Text></Pressable>
              <Pressable style={[styles.modalButton, styles.modalDanger]} onPress={() => {
                const target = removeTarget;
                setRemoveTarget(null);
                if (!target) return;
                if (target.profileId === cfg.profileId) void Promise.resolve(onLogout()).catch(error => setProfileError(String(error)));
                else void removeHubProfile(target.profileId).then(() => setProfiles(current => current.filter(item => item.profileId !== target.profileId))).catch(error => setProfileError(String(error)));
              }}><Text style={styles.dangerText}>移除账号</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={localDeleteVisible} transparent animationType="fade" onRequestClose={() => setLocalDeleteVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>删除本地工作区？</Text>
            <Text style={styles.modalBody}>应用会先在 ~/.anet/app/backups 创建完整备份，再删除本地 Hub 数据和系统凭据。远程 Hub 账号不受影响。请输入“删除本地数据”继续。</Text>
            <TextInput
              value={localDeleteText}
              onChangeText={setLocalDeleteText}
              placeholder="删除本地数据"
              placeholderTextColor={colors.textMuted}
              style={styles.confirmInput}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setLocalDeleteVisible(false)}><Text style={styles.rowValue}>返回</Text></Pressable>
              <Pressable disabled={localDeleteText !== '删除本地数据' || localHubBusy} style={[styles.modalButton, styles.modalDanger, localDeleteText !== '删除本地数据' && styles.disabled]} onPress={() => {
                setLocalHubBusy(true);
                void deleteLocalHubData().then(async backupPath => {
                  setLocalDeleteVisible(false);
                  setLocalBackupMessage(`删除前备份：${backupPath}`);
                  await onLocalDataDeleted();
                }).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }}><Text style={styles.dangerText}>备份并删除</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** 标签在左、只读值在右。 */
function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** 标签在左、动作按钮在右(本地 Hub 的几个操作)。 */
function ActionRow({ label, hint, busy, disabled, onPress }: { label: string; hint?: string; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const off = !!disabled || !!busy;
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={off} onPress={onPress} style={({ pressed }) => [styles.actionButton, off && styles.disabled, pressed && { opacity: 0.6 }]}>
        <Text style={styles.actionButtonText}>{busy ? '处理中…' : label}</Text>
      </Pressable>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const makeStyles = () =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rootWide: { flexDirection: 'row' },
  // 左栏:与导航栏同一色系,细线分隔;宽屏固定宽,窄屏变成顶部一条横向分类。
  sidebar: { width: 232, backgroundColor: colors.railBg, borderRightWidth: 1, borderRightColor: colors.border, paddingTop: spacing.lg },
  sidebarCompact: { width: '100%', borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  sidebarTop: { paddingHorizontal: spacing.md, gap: spacing.md, marginBottom: spacing.md },
  closeButton: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md, height: 36 },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, padding: 0 },
  categoryList: { paddingHorizontal: spacing.sm, gap: 2 },
  categoryRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.sm },
  categoryItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: 10 },
  categoryChip: { borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.xs + 2 },
  categoryItemHover: { backgroundColor: colors.card },
  categoryItemActive: { backgroundColor: colors.railActiveBg },
  categoryLabel: { color: colors.textSecondary, fontSize: 14 },
  categoryLabelActive: { color: colors.text, fontWeight: '600' },
  emptySide: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  // 右栏
  pane: { flex: 1, minWidth: 0 },
  paneTitle: { color: colors.text, fontSize: 20, fontWeight: '700', paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: spacing.lg },
  // 底部多留一个 spacing.xl:最后一行要能完全离开窗口下沿,而不是刚好贴上去——贴上去看起来就和「滚不动」一样。
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  section: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  groupTitle: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs },
  emptyPane: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowLabel: { color: colors.text, fontSize: 14 },
  rowLabelStrong: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowValue: { color: colors.textSecondary, fontSize: 14, flexShrink: 1 },
  rowHint: { color: colors.textMuted, fontSize: 12, flexShrink: 1 },
  footHint: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  dropdownValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  quietRow: { justifyContent: 'flex-start', gap: spacing.sm },
  quietInput: { color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minWidth: 64, textAlign: 'center', backgroundColor: colors.inputBg },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  profileCopy: { flex: 1, minWidth: 0 },
  inlineButton: { paddingHorizontal: spacing.xs },
  accentText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  dangerText: { color: colors.failed, fontSize: 14, fontWeight: '600' },
  dangerHint: { color: colors.failed, fontSize: 11 },
  errorText: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actionButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card },
  actionButtonText: { color: colors.text, fontSize: 13 },
  dangerZone: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.failed, borderRadius: 12, overflow: 'hidden' },
  dangerZoneTitle: { color: colors.failed, fontSize: 12, fontWeight: '600', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  dangerZoneRow: { paddingTop: spacing.sm },
  confirmInput: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  disabled: { opacity: 0.45 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { width: '100%', maxWidth: 440, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  modalBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalButton: { borderColor: colors.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  modalDanger: { borderColor: colors.failed },
});

// Theme styling idiom (shared across screens): `styles` is a module-level
// value rebuilt whenever the theme flips. The reassignment alone does NOT
// re-render an already-mounted screen — App.tsx remounts the whole tree by
// putting key={theme} on the root <SafeAreaView> inside AppRoot, so the next
// render reads these fresh styles. Keep both halves in sync: rebuild here,
// remount there.
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
