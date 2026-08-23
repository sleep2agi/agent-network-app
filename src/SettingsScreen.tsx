import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { HubConfig } from './api';
import { DesktopStorageDiagnostics, HubProfile, getDesktopStorageDiagnostics, listHubProfiles, removeHubProfile, saveThemeMode } from './storage';
import { colors, onThemeChange, setThemeMode, spacing, themeMode } from './theme';
import { APP_VERSION } from './version';
import { appFetch } from './app-fetch';
import { checkDesktopUpdate, desktopUpdateSnapshot, subscribeDesktopUpdates } from './desktop-updater';

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
  onAddAccount,
  onSwitchProfile,
  onReauthProfile,
}: {
  cfg: HubConfig;
  onLogout: () => void | Promise<void>;
  onAddAccount: () => void;
  onSwitchProfile: (profileId: string) => void | Promise<void>;
  onReauthProfile: (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => void;
}) {
  const [me, setMe] = useState<Me>({});
  const [profiles, setProfiles] = useState<HubProfile[]>([]);
  const [removeTarget, setRemoveTarget] = useState<HubProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [storageDiagnostics, setStorageDiagnostics] = useState<DesktopStorageDiagnostics | null>(null);
  const update = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);

  useEffect(() => {
    void Promise.all([listHubProfiles(), getDesktopStorageDiagnostics()]).then(([registry, diagnostics]) => {
      setProfiles(registry.profiles);
      setStorageDiagnostics(diagnostics);
    }).catch(error => setProfileError(String(error)));
  }, [cfg.profileId]);

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
                <Pressable accessibilityLabel={`移除 ${profile.username || profile.serverUrl}`} onPress={event => { event.stopPropagation(); setRemoveTarget(profile); }} hitSlop={8}>
                  <Text style={styles.removeText}>移除</Text>
                </Pressable>
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

      <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
        onPress={onLogout}
      >
        <Text style={styles.logoutText}>移除当前账号</Text>
      </Pressable>

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
