import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, parseStoredThemePreference, setThemePreference, spacing, themeMode } from './theme';
import { useTranslation } from './i18n-react';
import './i18n-daemon';
import { loadHubProfile, onDesktopThemeStorageChange } from './storage';
import type { HostSupervisorDaemon, HubConfig } from './api';
import { readDaemonSettingsWindow } from './daemon-settings-window';
import { closeSettingsWindow, followThemeInSettingsTitleBar } from './desktop-settings-window';
import ChatScreen from './ChatScreen';
import { nodeInfoSectionKey, requestNodeSection } from './node-section-request';
import { applyWindowBackground } from './window-background';
import MacTitleStrip from './mac-title-strip';
import DaemonManagementScreen from './DaemonManagementScreen';
import NodeDetailScreen from './NodeDetailScreen';
import CreateNodeWizardScreen from './CreateNodeWizardScreen';

export default function DaemonSettingsWindow() {
  const { t } = useTranslation();
  const [scope] = useState(() => readDaemonSettingsWindow());
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [theme, setTheme] = useState(themeMode());
  const [page, setPage] = useState<'management' | 'node'>('management');
  const [creating, setCreating] = useState<HostSupervisorDaemon | null>(null);
  const [chatAlias, setChatAlias] = useState<string | null>(null);
  useEffect(() => {
    void applyWindowBackground(themeMode());
    const offTitle = followThemeInSettingsTitleBar();
    const offStorage = onDesktopThemeStorageChange(mode => setThemePreference(parseStoredThemePreference(mode)));
    const offTheme = onThemeChange(mode => { setTheme(mode); void applyWindowBackground(mode); });
    return () => { offTitle(); offTheme(); offStorage(); };
  }, []);
  useEffect(() => {
    let alive = true;
    setError('');
    if (!scope) { setError(t('daemon.window.accountMissing')); return; }
    // Never fall back to the main window's active account when this profile is gone.
    void loadHubProfile(scope.profileId).then(stored => {
      if (!alive) return;
      if (!stored || stored.profileId !== scope.profileId) { setError(t('daemon.window.accountMissing')); return; }
      setCfg({ ...stored, networkId: scope.networkId });
    }).catch(() => { if (alive) setError(t('daemon.window.accountMissing')); });
    return () => { alive = false; };
  }, [scope, attempt, t]);
  const back = () => { setCreating(null); setPage('management'); setChatAlias(null); };
  const openNode = (logs = false) => {
    if (!scope || !cfg) return;
    if (logs) requestNodeSection(nodeInfoSectionKey(cfg.profileId ?? cfg.serverUrl, chatAlias ?? scope.alias), 'logs');
    setPage('node');
  };
  return <View key={theme} testID="daemon-settings-window" style={{ flex: 1, backgroundColor: colors.bg }}>
    <MacTitleStrip />
    {cfg && scope ? creating ? <CreateNodeWizardScreen cfg={cfg} daemon={creating} onBack={back} onExit={back} desktop />
      : page === 'node' ? <NodeDetailScreen cfg={cfg} alias={chatAlias ?? scope.alias} onBack={() => setPage('management')} />
      : chatAlias ? <ChatScreen cfg={cfg} alias={chatAlias} desktop onBack={back} onOpenNodeSettings={() => openNode()} />
      : <DaemonManagementScreen cfg={cfg} alias={scope.alias} desktop hideBack
          onBack={() => { void closeSettingsWindow(); }} onOpenNodeSettings={() => openNode()} onOpenLogs={() => openNode(true)}
          onCreate={setCreating} onOpenManagedChat={setChatAlias} />
      : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
          {error ? <><Text style={{ color: colors.failed }} testID="daemon-window-error">{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)}><Text style={{ color: colors.accent }}>{t('daemon.mgmt.retry')}</Text></Pressable></>
            : <ActivityIndicator color={colors.accent} />}
        </View>}
    {cfg && error ? <Text style={{ color: colors.failed, padding: spacing.md }}>{error}</Text> : null}
  </View>;
}
