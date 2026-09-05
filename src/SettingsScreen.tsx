import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HubConfig } from './api';
import { DesktopStorageDiagnostics, HubProfile, getDesktopStorageDiagnostics, listHubProfiles, removeHubProfile, saveThemeMode } from './storage';
import { colors, onThemeChange, setThemeMode, spacing, themeMode } from './theme';
import { APP_VERSION } from './version';
import { appFetch } from './app-fetch';
import { checkDesktopUpdate, desktopUpdateSnapshot, subscribeDesktopUpdates } from './desktop-updater';
import { backupLocalHubData, deleteLocalHubData, LOCAL_HUB_PROFILE_ID, localHubStatus, openLocalHubLogs, restartLocalHub, stopLocalHub, type LocalHubResult } from './local-hub';

// Settings (Vincent tg 720): who am I, where am I connected, which
// network, which build — and the one destructive action, logout,
// lives here instead of cluttering the agents list header.

interface Me {
  username?: string;
  networkName?: string;
  networkId?: string;
}

export default function SettingsScreen({
  cfg,
  onLogout,
  onLocalDataDeleted,
  onAddAccount,
  onSwitchProfile,
  onReauthProfile,
}: {
  cfg: HubConfig;
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

  return (
    <View style={styles.root}>
      <Text style={styles.sectionTitle}>账号与 Hub</Text>
      <View style={styles.card}>
        {profiles.length ? profiles.map((profile, index) => {
          const active = profile.profileId === cfg.profileId;
          return (
            <View key={profile.profileId}>
              {index ? <Divider /> : null}
              <Pressable
                accessibilityLabel={`切换到 ${profile.displayName || profile.username || profile.serverUrl}`}
                style={({ pressed }) => [styles.profileRow, pressed && { opacity: 0.65 }]}
                onPress={() => {
                  if (profile.requiresReauth) return onReauthProfile(profile);
                  if (!active) void Promise.resolve(onSwitchProfile(profile.profileId)).catch(error => setProfileError(String(error)));
                }}
              >
                <View style={styles.profileCopy}>
                  <Text style={styles.profileTitle}>{profile.displayName || profile.username || 'Hub 账号'}{active ? ' · 当前' : ''}</Text>
                  <Text style={styles.profileMeta} numberOfLines={1}>{profile.serverUrl} · {profile.username || '未知用户'}{profile.networkId ? ` · ${profile.networkId}` : ''}</Text>
                  {profile.requiresReauth ? <Text style={styles.reauthText}>需要重新登录 · 点击验证</Text> : null}
                </View>
                {profile.profileId !== LOCAL_HUB_PROFILE_ID ? (
                  <Pressable accessibilityLabel={`移除 ${profile.username || profile.serverUrl}`} onPress={event => { event.stopPropagation(); setRemoveTarget(profile); }} hitSlop={8}>
                    <Text style={styles.removeText}>移除</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            </View>
          );
        }) : (
          <>
            <Row label="服务器" value={cfg.serverUrl} />
            <Divider />
            <Row label="用户名" value={me.username ?? cfg.username ?? '—'} />
          </>
        )}
        <Divider />
        <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={onAddAccount}>
          <Text style={styles.addText}>＋ 添加 Hub / 账号</Text>
        </Pressable>
      </View>
      {profileError ? <Text style={styles.errorText}>{profileError}</Text> : null}
      {storageDiagnostics ? (
        <Text style={styles.storageHint} numberOfLines={2}>
          本地数据：{storageDiagnostics.root} · {storageDiagnostics.profile_count} profiles
          {storageDiagnostics.corrupt_backups.length ? ` · 已保留 ${storageDiagnostics.corrupt_backups.length} 个损坏备份` : ''}
        </Text>
      ) : null}

      {localHub ? (
        <>
          <Text style={styles.sectionTitle}>本地 Hub</Text>
          <View style={styles.card} testID="local-hub-settings-card">
            <Row label="状态" value={localHub.state === 'running' || localHub.state === 'running_external' ? '运行中' : localHub.state === 'error' ? '异常' : '已停止'} />
            <Divider />
            <Row label="地址" value={localHub.endpoint} />
            <Divider />
            <Row label="版本" value={localHub.hubVersion} />
            {localHub.error ? <Text style={styles.localHubError}>{localHub.error}</Text> : null}
            {/* app#246(Vincent 2026-09-05「版本低了就加个触发安装的按钮」):本地数据还是旧版 Hub 写的
                (requiresMigration)或端口上跑着旧版 sidecar(version mismatch)时,给一个显式的升级入口。
                它做的事 = 重新启动:停掉旧 sidecar → 备份 → 迁移 → 用捆绑的 Hub 接管。 */}
            {localHub.requiresMigration || (localHub.error ?? '').includes('version mismatch') ? (
              <Pressable disabled={localHubBusy} testID="local-hub-upgrade" style={[styles.localHubButton, { alignSelf: 'flex-start', marginHorizontal: spacing.lg, marginTop: spacing.sm }]} onPress={() => {
                setLocalHubBusy(true);
                setProfileError('');
                void restartLocalHub().then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }}><Text style={styles.addText}>{localHubBusy ? '升级中…' : `升级本地 Hub 到 ${localHub.expectedHubVersion ?? '当前捆绑版本'}`}</Text></Pressable>
            ) : null}
            <Divider />
            <View style={styles.localHubActions}>
              <Pressable disabled={localHubBusy} style={styles.localHubButton} onPress={() => {
                setLocalHubBusy(true);
                void restartLocalHub().then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }}><Text style={styles.addText}>{localHubBusy ? '处理中…' : '重新启动'}</Text></Pressable>
              <Pressable disabled={localHubBusy || localHub.state === 'stopped'} style={styles.localHubButton} onPress={() => {
                setLocalHubBusy(true);
                void stopLocalHub().then(() => localHubStatus()).then(setLocalHub).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }}><Text style={styles.rowValue}>停止</Text></Pressable>
              <Pressable style={styles.localHubButton} onPress={() => {
                void openLocalHubLogs().catch(error => setProfileError(String(error)));
              }}><Text style={styles.rowValue}>打开日志</Text></Pressable>
              <Pressable disabled={localHubBusy} style={styles.localHubButton} onPress={() => {
                setLocalHubBusy(true);
                setLocalBackupMessage('');
                void backupLocalHubData().then(result => setLocalBackupMessage(`备份已保存：${result.path}`)).catch(error => setProfileError(String(error))).finally(() => setLocalHubBusy(false));
              }}><Text style={styles.rowValue}>立即备份</Text></Pressable>
            </View>
            {localBackupMessage ? <Text style={styles.storageHint}>{localBackupMessage}</Text> : null}
            <Pressable style={styles.localDeleteButton} onPress={() => { setLocalDeleteText(''); setLocalDeleteVisible(true); }}>
              <Text style={styles.logoutText}>删除本地工作区数据…</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>外观</Text>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          onPress={() => {
            const next = themeMode() === 'dark' ? 'light' : 'dark';
            setThemeMode(next);
            saveThemeMode(next);
          }}
        >
          <Text style={styles.rowLabel}>主题</Text>
          <Text style={styles.rowValue}>{themeMode() === 'dark' ? '深色' : '浅色'}</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>关于</Text>
      <View style={styles.card}>
        <Row label="版本" value={`v${APP_VERSION}`} />
        <Divider />
        <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} onPress={() => { void checkDesktopUpdate(); }} disabled={update.kind === 'checking'}>
          <Text style={styles.rowLabel}>软件更新</Text>
          {update.kind === 'checking' ? <ActivityIndicator color={colors.accent} /> : (
            <Text style={styles.rowValue}>{update.kind === 'available' ? `发现 v${update.version}` : update.kind === 'up-to-date' ? '已是最新版' : update.kind === 'error' ? '检查失败，点击重试' : '检查更新'}</Text>
          )}
        </Pressable>
      </View>

      {cfg.profileId !== LOCAL_HUB_PROFILE_ID ? <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
        onPress={onLogout}
      >
        <Text style={styles.logoutText}>移除当前账号</Text>
      </Pressable> : null}

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
              }}><Text style={styles.logoutText}>移除账号</Text></Pressable>
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
              }}><Text style={styles.logoutText}>备份并删除</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const makeStyles = () =>
  StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, flexShrink: 1 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  profileCopy: { flex: 1, minWidth: 0 },
  profileTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  profileMeta: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  addText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  removeText: { color: colors.failed, fontSize: 12 },
  reauthText: { color: colors.failed, fontSize: 11, marginTop: 3 },
  errorText: { color: colors.failed, fontSize: 12, marginTop: spacing.sm },
  storageHint: { color: colors.textMuted, fontSize: 11, marginTop: spacing.sm },
  localHubError: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  localHubActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, padding: spacing.md },
  localHubButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  localDeleteButton: { margin: spacing.md, marginTop: 0, borderWidth: 1, borderColor: colors.failed, borderRadius: 8, alignItems: 'center', paddingVertical: spacing.sm },
  confirmInput: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  disabled: { opacity: 0.45 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg },
  logoutBtn: {
    marginTop: spacing.xl,
    borderColor: colors.failed,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  logoutText: { color: colors.failed, fontSize: 15, fontWeight: '600' },
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
