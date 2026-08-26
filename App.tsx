import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { purgeLegacyAttachmentCache } from './src/AuthedThumb';
import { prefetchStatus, login, fetchHubNodes, HubConfig } from './src/api';
import { LOGIN_FAILURE_COPY, normalizeServerUrl, type LoginFailureKind } from './src/login-flow';
import { hydrateHubAvatars, initLocalAvatars } from './src/lib/avatars';
import { usePoll } from './src/usePoll'; // R1 avatar 30s hydrate poll (main's App.tsx no longer imports it)
import ChatScreen, { clearChatConversationCache } from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import ServerScreen from './src/ServerScreen';
import ServerSidebar, { type ServerSection } from './src/ServerSidebar';
import HostSupervisorPickerScreen from './src/HostSupervisorPickerScreen';
import CreateNodeWizardScreen from './src/CreateNodeWizardScreen';
import SettingsScreen from './src/SettingsScreen';
import AgentsScreen from './src/AgentsScreen';
import TasksScreen from './src/TasksScreen';
import TaskDetailScreen from './src/TaskDetailScreen';
import NodeDetailScreen from './src/NodeDetailScreen';
import LogsScreen from './src/LogsScreen';
import ScheduledTasksScreen from './src/ScheduledTasksScreen';
import ConnectivityBanner from './src/ConnectivityBanner';
import type { HostSupervisorDaemon } from './src/api';
import { clearConfig, listHubProfiles, loadConfig, loadLocalAvatars, loadOutbox, loadForwardOperations, saveForwardOperations, loadThemeMode, markHubProfileRequiresReauth, onDesktopThemeStorageChange, removeHubProfile, saveConfig, saveLocalAvatars, saveOutbox, switchHubProfile, type HubProfile } from './src/storage';
import { clearProfileUnauthorized, onProfileUnauthorized } from './src/profile-auth-state';
import { initOutbox } from './src/outbox';
import { createForwardPersistence, initForwardController } from './src/forward-controller';
import { colors, onThemeChange, setThemeMode, spacing, themeMode } from './src/theme';
import { installWebScrollbarTheme } from './src/web-scrollbar';
import DesktopWindowPin from './src/DesktopWindowPin';
import { styles } from './src/app-styles';
import { APP_VERSION } from './src/version';
import DesktopUpdatePrompt from './src/DesktopUpdatePrompt';
import { loadPinnedChats, requestedChatAlias, requestedChatProfileId, savePinnedChats } from './src/desktop-chat-menu';
import { openRememberedChatWindow, restoreDetachedChatWindows } from './src/desktop-chat-windows';
import { LOCAL_HUB_PROFILE_ID, localHubStatus, startLocalHub } from './src/local-hub';

type Screen =
  | { name: 'login' }
  | { name: 'agents' }
  | { name: 'tasks' }
  | { name: 'scheduled' }
  | { name: 'messages' }
  | { name: 'server' }
  | { name: 'serverNodes' }
  | { name: 'serverNodeDetail'; alias: string }
  | { name: 'settings' }
  | { name: 'chat'; alias: string }
  | { name: 'nodeInfo'; alias: string }
  | { name: 'taskDetail'; taskId: string }   // full-screen (no tab bar) — hardware back returns to /tasks list
  | { name: 'nodeDetail'; alias: string }  // issue #8 row 4 (V1) — long-press an agent row from AgentsScreen; back returns to agents
  | { name: 'logs' }                        // row 6 — network event stream leaf reached from Server tab; back returns to server
  | { name: 'picker' }       // #338 RFC-026 §9.4 host_supervisor picker (modal-style, back returns to agents)
  | { name: 'wizard'; daemon: HostSupervisorDaemon };  // #338 wizard rest (Plan B) — created after picker selects a daemon

// 跟微信的学一学 (Vincent tg 807): icon over small label, active tint.
// Desktop keeps operational modules together and pins Settings to the bottom.
const DESKTOP_TABS = [
  { key: 'agents', label: 'Agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'tasks', label: 'Tasks', icon: 'list-outline', iconActive: 'list' },
  { key: 'scheduled', label: '定时', icon: 'time-outline', iconActive: 'time' },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
  { key: 'server', label: '服务器设置', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: '设置', icon: 'settings-outline', iconActive: 'settings' },
] as const;

const MOBILE_TABS = [
  { key: 'agents', label: 'Agent', icon: 'people-outline', iconActive: 'people' },
  { key: 'scheduled', label: '定时任务', icon: 'time-outline', iconActive: 'time' },
  { key: 'server', label: '服务器', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: '设置', icon: 'settings-outline', iconActive: 'settings' },
] as const;

const DESKTOP_MAIN_TABS = DESKTOP_TABS.filter(tab => tab.key !== 'settings');
const DESKTOP_SETTINGS_TAB = DESKTOP_TABS.find(tab => tab.key === 'settings')!;

export default function App() {
  // One-time cleanup of attachment caches written before the download fix.
  // Versions before it wrote HTTP error bodies to the real filename, and a
  // non-empty error body is indistinguishable from a valid cached file, so
  // affected devices never retry and never recover on their own. Runs once
  // (guarded by a marker in the cache dir), fire-and-forget: a cache we
  // cannot clean is not a reason to block app start.
  useEffect(() => {
    purgeLegacyAttachmentCache().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <AppRoot />
      <DesktopUpdatePrompt />
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'login' });
  const [booting, setBooting] = useState(true);
  const [reauthProfile, setReauthProfile] = useState<Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'> | null>(null);
  const [showRemoteLogin, setShowRemoteLogin] = useState(false);
  const [localHubStarting, setLocalHubStarting] = useState(false);
  const [localHubStage, setLocalHubStage] = useState<'preparing' | 'starting' | 'migrating' | null>(null);
  const [localHubError, setLocalHubError] = useState<string | null>(null);
  const initialChat = useMemo(() => requestedChatAlias(), []);
  const initialChatProfile = useMemo(() => requestedChatProfileId(), []);
  // Keyed remount on theme switch: module-level styles were already
  // rebuilt by the onThemeChange listeners, the new key re-renders the tree.
  const [theme, setTheme] = useState(themeMode());
  useEffect(() => onThemeChange(setTheme), []);
  // Scrollbars are painted by the browser, outside React Native's style
  // system, so they need the palette pushed to them explicitly.
  useEffect(() => installWebScrollbarTheme(), []);
  useEffect(() => onDesktopThemeStorageChange(mode => {
    if (mode === 'light' || mode === 'dark') setThemeMode(mode);
  }), []);
  // RN's SafeAreaView only covers iOS; Android edge-to-edge draws the
  // tab bar under the gesture bar (Vincent tg 802) — pad by the real inset.
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tauriDesktop = Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__;
  const desktop = tauriDesktop && width >= 860;
  const dedicatedChatWindow = tauriDesktop && !!initialChat;
  const tabBarInset = Platform.OS === 'android' ? insets.bottom : 0;
  const workspaceKey = `${theme}:${cfg?.profileId ?? cfg?.serverUrl ?? 'login'}`;

  const hydrateProfileLocalState = async (profileCfg: HubConfig | null) => {
    const profileId = profileCfg?.profileId;
    const [localAvatars, outbox, forwards] = await Promise.all([loadLocalAvatars(profileId), loadOutbox(profileId), loadForwardOperations(profileId)]);
    initLocalAvatars(localAvatars, (map) => { void saveLocalAvatars(map, profileId); });
    initOutbox(outbox, (all) => { void saveOutbox(all, profileId); });
    initForwardController(forwards, createForwardPersistence(saveForwardOperations, profileId));
  };

  const removeActiveProfile = async () => {
    clearChatConversationCache(cfg?.profileId, cfg?.serverUrl);
    if (cfg?.profileId) await removeHubProfile(cfg.profileId);
    else await clearConfig();
    const next = await loadConfig();
    await hydrateProfileLocalState(next);
    setCfg(next);
    setScreen(next ? { name: 'agents' } : { name: 'login' });
  };

  const finishLocalDataDeletion = async () => {
    const next = await loadConfig();
    await hydrateProfileLocalState(next);
    setCfg(next);
    setShowRemoteLogin(false);
    setScreen(next ? { name: 'agents' } : { name: 'login' });
  };

  const activateProfile = async (profileId: string) => {
    const next = await switchHubProfile(profileId);
    await hydrateProfileLocalState(next);
    setCfg(next);
    setScreen({ name: 'agents' });
    prefetchStatus(next);
  };

  const requestProfileReauth = (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => {
    clearChatConversationCache(profile.profileId, profile.serverUrl);
    setReauthProfile(profile);
    setScreen({ name: 'login' });
  };

  useEffect(() => onProfileUnauthorized(profileId => {
    if (profileId !== cfg?.profileId) return;
    void (async () => {
      try {
        await markHubProfileRequiresReauth(profileId);
      } finally {
        requestProfileReauth({ profileId, serverUrl: cfg.serverUrl, username: cfg.username ?? '', displayName: cfg.displayName });
      }
    })();
  }), [cfg]);

  // Restore the saved session on cold start — login survives app kills.
  // Desktop credential-store failures are not treated as "no session": keep
  // the app usable, log the diagnostic, and require a fresh login whose save
  // path now reports the error visibly.
  useEffect(() => {
    Promise.all([initialChatProfile ? switchHubProfile(initialChatProfile).catch(() => loadConfig()) : loadConfig(), loadThemeMode()]).then(async ([stored, mode]) => {
      let saved = stored;
      if (tauriDesktop && stored?.profileId === LOCAL_HUB_PROFILE_ID) {
        const local = await startLocalHub();
        if (!local.session) throw new Error(local.error || '本地工作区启动后没有返回会话');
        saved = local.session;
      }
      if (mode === 'light' || mode === 'dark') setThemeMode(mode);
      // R2 avatar: seed the per-device local echo layer + wire its writer, so
      // session-only aliases keep their user-set avatar across restarts.
      await hydrateProfileLocalState(saved);
      // PR3 判据C:恢复未送达 outbox(pending 一律恢复为 failed=命运未知按未送达),
      // 注入落盘写手——此后 提交即落盘/确认才删。
      if (saved) {
        setCfg(saved);
        setScreen(initialChat ? { name: 'chat', alias: initialChat } : { name: 'agents' });
        // Fire the status request now so its RTT overlaps the boot→AgentsScreen
        // mount; AgentsScreen's first load consumes this in-flight promise.
        prefetchStatus(saved);
        if (!initialChat) void restoreDetachedChatWindows().catch(error => console.error('Failed to restore detached chats', error));
      }
      setBooting(false);
    }).catch(error => {
      console.error('Failed to restore desktop session', error);
      setBooting(false);
    });
  }, [initialChat, initialChatProfile, tauriDesktop]);

  // R1 avatar (通信龙 07-31): hydrate the hub avatar layer from GET /api/nodes
  // so node-backed aliases render their cross-device avatar_url (Vincent changed
  // an avatar on web → phone should match, not the old pool image). Best-effort:
  // one immediate load when logged in, then a slow foreground poll to pick up
  // web-side changes. Failure just leaves pool avatars — never blocks/crashes.
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    fetchHubNodes(cfg).then(r => { if (alive) hydrateHubAvatars(r.nodes); }).catch(() => {});
    return () => { alive = false; };
  }, [cfg]);
  usePoll(() => {
    if (cfg) fetchHubNodes(cfg).then(r => hydrateHubAvatars(r.nodes)).catch(() => {});
  }, 30000, [cfg]);

  // System back (button or fullscreen gesture) navigates within the app
  // instead of exiting (Vincent tg 730). Agents/login fall through to
  // the default exit behavior.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // taskDetail is a full-screen leaf under the tasks tab — hardware
      // back should return to the tasks list, not skip past it back to
      // agents (that would lose the user's place in the task list).
      if (screen.name === 'taskDetail') {
        setScreen({ name: 'tasks' });
        return true;
      }
      // logs is a full-screen leaf under the Server tab — hardware back
      // returns to Server, not skipping past to Agents.
      if (screen.name === 'logs') {
        setScreen({ name: 'server' });
        return true;
      }
      if (screen.name === 'nodeInfo') {
        setScreen({ name: 'chat', alias: screen.alias });
        return true;
      }
      if (screen.name !== 'agents' && screen.name !== 'login') {
        setScreen({ name: 'agents' });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, styles.center, bootStyles.root]}>
        <Image source={require('./assets/splash-icon.png')} style={bootStyles.logo} resizeMode="contain" />
        <Text style={bootStyles.title}>Agent Network</Text>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  // A window opened from the agent context menu is a WeChat-style detached
  // conversation: chat chrome only. Never mount DesktopWorkspace here, even
  // when the detached window is wide enough for the normal three-column UI.
  if (dedicatedChatWindow && cfg && (screen.name === 'chat' || screen.name === 'nodeInfo')) {
    const detachedAlias = screen.alias;
    return (
      <SafeAreaView key={workspaceKey} style={styles.root} testID="dedicated-chat-window">
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={colors.bg} />
        {screen.name === 'chat' ? (
          <ChatScreen
            cfg={cfg}
            alias={detachedAlias}
            onBack={() => {}}
            onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: detachedAlias })}
            desktop
          />
        ) : (
          <NodeDetailScreen
            cfg={cfg}
            alias={detachedAlias}
            onBack={() => setScreen({ name: 'chat', alias: detachedAlias })}
            readOnly
          />
        )}
        <DesktopWindowPin />
      </SafeAreaView>
    );
  }

  if (desktop && cfg && screen.name !== 'login') {
    return (
      <SafeAreaView key={workspaceKey} style={styles.root}>
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={colors.bg} />
        <ConnectivityBanner />
        <DesktopWorkspace cfg={cfg} screen={screen} setScreen={setScreen} onLogout={removeActiveProfile} onLocalDataDeleted={finishLocalDataDeletion} onAddAccount={() => { setReauthProfile(null); setScreen({ name: 'login' }); }} onSwitchProfile={activateProfile} onReauthProfile={requestProfileReauth} />
        <DesktopWindowPin />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView key={workspaceKey} style={styles.root}>
      <StatusBar
        barStyle={theme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.bg}
      />
      {/* 全局连接状态横幅(App战线①):断连时所有已登录界面顶部出现,声明缓存数据+
          诚实的"截至"时间(最后一次成功,非尝试)。登录页不挂(还没有 hub 可言)。 */}
      {screen.name !== 'login' && cfg ? <ConnectivityBanner /> : null}
      {screen.name === 'login' || !cfg ? (
        tauriDesktop && !reauthProfile && !showRemoteLogin ? (
          <FirstRunScreen
            busy={localHubStarting}
            stage={localHubStage}
            error={localHubError}
            onStartLocal={async () => {
              setLocalHubStarting(true);
              setLocalHubStage('preparing');
              setLocalHubError(null);
              try {
                const status = await localHubStatus();
                setLocalHubStage(status.requiresMigration ? 'migrating' : 'starting');
                await new Promise(resolve => setTimeout(resolve, 0));
                const local = await startLocalHub();
                if (!local.session) throw new Error(local.error || '本地工作区启动后没有返回会话');
                await hydrateProfileLocalState(local.session);
                setCfg(local.session);
                setScreen({ name: 'agents' });
                prefetchStatus(local.session);
              } catch (error) {
                setLocalHubError(error instanceof Error ? error.message : String(error));
              } finally {
                setLocalHubStarting(false);
                setLocalHubStage(null);
              }
            }}
            onRemote={() => setShowRemoteLogin(true)}
          />
        ) : (
        <LoginScreen
          key={reauthProfile?.profileId ?? 'new-profile'}
          initialProfile={reauthProfile}
          onCancelReauth={reauthProfile ? async () => {
            const registry = await listHubProfiles();
            const fallback = registry.profiles.find(profile => profile.profileId !== reauthProfile.profileId && !profile.requiresReauth);
            if (!fallback) throw new Error('没有其他可用账号，请重新验证当前账号');
            setReauthProfile(null);
            await activateProfile(fallback.profileId);
          } : undefined}
          onLogin={async c => {
            const saved = await saveConfig(reauthProfile ? { ...c, profileId: reauthProfile.profileId, displayName: reauthProfile.displayName } : c);
            clearProfileUnauthorized(saved.profileId);
            setReauthProfile(null);
            await hydrateProfileLocalState(saved);
            setCfg(saved);
            setScreen(initialChat ? { name: 'chat', alias: initialChat } : { name: 'agents' });
          }}
        />
        )
      ) : screen.name === 'chat' ? (
        <ChatScreen
          cfg={cfg}
          alias={screen.alias}
          onBack={() => setScreen({ name: 'agents' })}
          onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: screen.alias })}
        />
      ) : screen.name === 'nodeInfo' ? (
        <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'chat', alias: screen.alias })} readOnly />
      ) : screen.name === 'nodeDetail' ? (
        // issue #8 row 4 (V1) — long-press an agent row in AgentsScreen
        // opens this. Back returns to agents. Rendered as its own screen
        // (not a tab) so the tab bar doesn't compete for the header slot.
        <NodeDetailScreen
          cfg={cfg}
          alias={screen.alias}
          onBack={() => setScreen({ name: 'agents' })}
        />
      ) : screen.name === 'picker' ? (
        // #338 RFC-026 §9.4 — modal-style screen, hides tab bar to keep
        // the wizard flow focused. System back / on-screen back returns
        // to the agents tab.
        <HostSupervisorPickerScreen
          cfg={cfg}
          onBack={() => setScreen({ name: 'agents' })}
          // #338 wizard rest (Plan B) — replaces the previous Alert TODO
          // with a real navigation into the create-node wizard.
          onPicked={d => setScreen({ name: 'wizard', daemon: d })}
        />
      ) : screen.name === 'wizard' ? (
        // #338 wizard rest — multi-step create-node form. Back returns
        // to picker (to re-pick daemon); Exit (after done / cancel)
        // returns to Agents.
        <CreateNodeWizardScreen
          cfg={cfg}
          daemon={screen.daemon}
          onBack={() => setScreen({ name: 'picker' })}
          onExit={() => setScreen({ name: 'agents' })}
        />
      ) : screen.name === 'taskDetail' ? (
        // Task detail — full-screen (no tab bar), matches the mobile
        // two-level pattern: list → detail → back. Hardware back and
        // the on-screen chevron both return to the tasks tab.
        <TaskDetailScreen
          cfg={cfg}
          taskId={screen.taskId}
          onBack={() => setScreen({ name: 'tasks' })}
        />
      ) : screen.name === 'logs' ? (
        // Row 6 — network event stream (SSE). Full-screen leaf reached
        // from the Server tab's "查看事件流" button. Same routing shape
        // as taskDetail. Back returns to Server.
        <LogsScreen
          cfg={cfg}
          onBack={() => setScreen({ name: 'server' })}
        />
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {screen.name === 'tasks' ? (
              <TasksScreen
                cfg={cfg}
                onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })}
              />
            ) : screen.name === 'scheduled' ? (
              <ScheduledTasksScreen cfg={cfg} />
            ) : screen.name === 'messages' ? (
              <MessagesScreen cfg={cfg} />
            ) : screen.name === 'server' ? (
              <ServerScreen
                cfg={cfg}
                onOpenLogs={() => setScreen({ name: 'logs' })}
              />
            ) : screen.name === 'settings' ? (
              <SettingsScreen
                cfg={cfg}
                onLogout={removeActiveProfile}
                onAddAccount={() => { setReauthProfile(null); setScreen({ name: 'login' }); }}
                onSwitchProfile={activateProfile}
                onReauthProfile={requestProfileReauth}
                onLocalDataDeleted={finishLocalDataDeletion}
              />
            ) : (
              <AgentsScreen
                cfg={cfg}
                onOpenChat={alias => setScreen({ name: 'chat', alias })}
                onOpenPicker={() => setScreen({ name: 'picker' })}
                onOpenNodeDetail={alias => setScreen({ name: 'nodeDetail', alias })}
              />
            )}
          </View>
          <View style={[styles.tabBar, { paddingBottom: tabBarInset }]}>
            {MOBILE_TABS.map(tab => (
              <Pressable
                key={tab.key}
                style={styles.tab}
                onPress={() => setScreen({ name: tab.key } as Screen)}
              >
                <Ionicons
                  name={screen.name === tab.key ? tab.iconActive : tab.icon}
                  size={26}
                  color={screen.name === tab.key ? colors.accent : colors.textSecondary}
                />
                <Text style={[styles.tabLabel, screen.name === tab.key && styles.tabActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

export function FirstRunScreen({ busy, stage, error, onStartLocal, onRemote }: {
  busy: boolean;
  stage: 'preparing' | 'starting' | 'migrating' | null;
  error: string | null;
  onStartLocal: () => Promise<void>;
  onRemote: () => void;
}) {
  const entryStyles = useMemo(makeEntryStyles, []);
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <View style={entryStyles.root} testID="first-run-local-hub">
      <View pointerEvents="none" style={[entryStyles.glow, entryStyles.glowTop]} />
      <View pointerEvents="none" style={[entryStyles.glow, entryStyles.glowBottom]} />
      <ScrollView style={loginStylesShared.scrollView} contentContainerStyle={loginStylesShared.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={[entryStyles.card, compact && entryStyles.cardCompact]}>
        <View style={entryStyles.logoHalo}>
          <Image source={require('./assets/splash-icon.png')} style={entryStyles.logo} resizeMode="contain" />
        </View>
        <Text style={entryStyles.eyebrow}>YOUR AI WORKSPACE</Text>
        <Text style={entryStyles.title}>让 Agent 在这里协作</Text>
        <Text style={entryStyles.copy}>在这台电脑创建安全的本地工作区，几秒钟即可开始。无需配置服务器，数据默认留在本机。</Text>
        <View style={[entryStyles.benefits, compact && entryStyles.benefitsCompact]}>
          <View style={entryStyles.benefit}>
            <View style={entryStyles.benefitIcon}><Ionicons name="flash-outline" size={16} color={colors.accent} /></View>
            <View style={entryStyles.benefitCopy}><Text style={entryStyles.benefitTitle}>开箱即用</Text><Text style={entryStyles.benefitText}>自动启动本地服务</Text></View>
          </View>
          <View style={entryStyles.benefit}>
            <View style={entryStyles.benefitIcon}><Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} /></View>
            <View style={entryStyles.benefitCopy}><Text style={entryStyles.benefitTitle}>本地优先</Text><Text style={entryStyles.benefitText}>工作数据保存在 ~/.anet/app</Text></View>
          </View>
        </View>
        {error ? <View style={entryStyles.errorBox}><Ionicons name="alert-circle-outline" size={17} color={colors.failed} /><Text style={entryStyles.error}>{error}</Text></View> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={({ pressed }) => [entryStyles.primary, busy && entryStyles.disabled, pressed && entryStyles.pressed]}
          onPress={() => { void onStartLocal(); }}
        >
          {busy ? (
            <View style={entryStyles.busyRow} testID={`local-hub-stage-${stage ?? 'preparing'}`}>
              <ActivityIndicator color="#fff" />
              <Text style={entryStyles.primaryText}>{stage === 'migrating' ? '正在备份并迁移…' : stage === 'starting' ? '正在启动本地服务…' : '正在准备本地工作区…'}</Text>
            </View>
          ) : <View style={entryStyles.buttonRow}><Text style={entryStyles.primaryText}>创建本地工作区</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></View>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={({ pressed }) => [entryStyles.secondary, pressed && entryStyles.secondaryPressed]} onPress={onRemote}>
          <Ionicons name="globe-outline" size={17} color={colors.textSecondary} />
          <Text style={entryStyles.secondaryText}>使用已有服务器登录</Text>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}

const makeEntryStyles = () => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg, overflow: 'hidden' },
  glow: { position: 'absolute', width: 420, height: 420, borderRadius: 210, opacity: themeMode() === 'light' ? 0.13 : 0.09, backgroundColor: colors.accent },
  glowTop: { top: -280, right: -120 },
  glowBottom: { bottom: -330, left: -160 },
  card: { width: '100%', maxWidth: 480, gap: 16, paddingHorizontal: 38, paddingVertical: 36, borderRadius: 28, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: themeMode() === 'light' ? 0.12 : 0.35, shadowRadius: 42, elevation: 12 },
  cardCompact: { paddingHorizontal: 22, paddingVertical: 26, borderRadius: 22 },
  logoHalo: { width: 74, height: 74, borderRadius: 23, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: themeMode() === 'light' ? '#e8f8fa' : '#102b32', borderWidth: 1, borderColor: themeMode() === 'light' ? '#c9eef2' : '#19434b' },
  logo: { width: 58, height: 58 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.8, textAlign: 'center', marginTop: 2 },
  title: { color: colors.text, fontSize: 27, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  copy: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 390, alignSelf: 'center' },
  benefits: { flexDirection: 'row', gap: 10, marginVertical: 2 },
  benefitsCompact: { flexDirection: 'column' },
  benefit: { flex: 1, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 14, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  benefitIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: themeMode() === 'light' ? '#ddf5f7' : '#123038' },
  benefitCopy: { flex: 1, minWidth: 0 },
  benefitTitle: { color: colors.text, fontSize: 12, fontWeight: '700' },
  benefitText: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: 12, backgroundColor: themeMode() === 'light' ? '#fff1f2' : '#291417', borderWidth: 1, borderColor: themeMode() === 'light' ? '#fecdd3' : '#552329' },
  error: { flex: 1, color: colors.failed, fontSize: 12, lineHeight: 18 },
  primary: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 5 },
  disabled: { opacity: 0.6 },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondary: { height: 46, borderRadius: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: themeMode() === 'light' ? '#fafbfc' : colors.inputBg },
  secondaryPressed: { backgroundColor: colors.border },
  secondaryText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});

const loginStylesShared = StyleSheet.create({
  scrollView: { width: '100%' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
});

const bootStyles = StyleSheet.create({
  root: { backgroundColor: '#07152f' },
  logo: { width: 156, height: 156, borderRadius: 34 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8 },
});

function DesktopWorkspace({ cfg, screen, setScreen, onLogout, onLocalDataDeleted, onAddAccount, onSwitchProfile, onReauthProfile }: {
  cfg: HubConfig;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onLogout: () => void | Promise<void>;
  onLocalDataDeleted: () => void | Promise<void>;
  onAddAccount: () => void;
  onSwitchProfile: (profileId: string) => void | Promise<void>;
  onReauthProfile: (profile: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username' | 'displayName'>) => void;
}) {
  // AppRoot is keyed by theme, so this component remounts after every theme
  // switch. Build desktop styles on that mount instead of freezing the dark
  // palette once at module import time.
  const desktopStyles = useMemo(makeDesktopStyles, []);
  const [pinnedAliases, setPinnedAliases] = useState(() => loadPinnedChats(cfg.profileId));
  useEffect(() => setPinnedAliases(loadPinnedChats(cfg.profileId)), [cfg.profileId]);
  const togglePin = (alias: string) => setPinnedAliases(current => {
    const next = current.includes(alias) ? current.filter(item => item !== alias) : [alias, ...current];
    savePinnedChats(next, cfg.profileId);
    return next;
  });
  const serverWorkspace = ['server', 'serverNodes', 'serverNodeDetail', 'logs', 'picker', 'wizard'].includes(screen.name);
  const active = serverWorkspace ? 'server' : ['chat', 'nodeDetail', 'nodeInfo'].includes(screen.name) ? 'agents' : screen.name;
  const content = screen.name === 'chat' ? (
    <ChatScreen
      cfg={cfg}
      alias={screen.alias}
      onBack={() => setScreen({ name: 'agents' })}
      onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: screen.alias })}
      desktop
    />
  ) : screen.name === 'tasks' ? (
    <TasksScreen cfg={cfg} onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })} />
  ) : screen.name === 'scheduled' ? <ScheduledTasksScreen cfg={cfg} />
  : screen.name === 'messages' ? <MessagesScreen cfg={cfg} />
  : screen.name === 'server' ? <ServerScreen cfg={cfg} onOpenLogs={() => setScreen({ name: 'logs' })} />
  : screen.name === 'serverNodes' ? <AgentsScreen cfg={cfg} onOpenChat={alias => setScreen({ name: 'serverNodeDetail', alias })} onOpenPicker={() => setScreen({ name: 'picker' })} onOpenNodeDetail={alias => setScreen({ name: 'serverNodeDetail', alias })} />
  : screen.name === 'serverNodeDetail' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'serverNodes' })} />
  : screen.name === 'settings' ? <SettingsScreen cfg={cfg} onLogout={onLogout} onLocalDataDeleted={onLocalDataDeleted} onAddAccount={onAddAccount} onSwitchProfile={onSwitchProfile} onReauthProfile={onReauthProfile} />
  : screen.name === 'taskDetail' ? <TaskDetailScreen cfg={cfg} taskId={screen.taskId} onBack={() => setScreen({ name: 'tasks' })} />
  : screen.name === 'nodeDetail' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'agents' })} />
  : screen.name === 'nodeInfo' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'chat', alias: screen.alias })} readOnly />
  : screen.name === 'logs' ? <LogsScreen cfg={cfg} onBack={() => setScreen({ name: 'server' })} />
  : screen.name === 'picker' ? <HostSupervisorPickerScreen cfg={cfg} onBack={() => setScreen({ name: 'server' })} onPicked={d => setScreen({ name: 'wizard', daemon: d })} />
  : screen.name === 'wizard' ? <CreateNodeWizardScreen cfg={cfg} daemon={screen.daemon} onBack={() => setScreen({ name: 'picker' })} onExit={() => setScreen({ name: 'serverNodes' })} />
  : (
    <View style={desktopStyles.empty}>
      <Ionicons name="chatbubbles-outline" size={52} color={colors.textMuted} />
      <Text style={desktopStyles.emptyTitle}>选择一个 agent 开始聊天</Text>
      <Text style={desktopStyles.emptyHint}>会话显示在右侧，列表始终保留</Text>
    </View>
  );

  return (
    <View style={desktopStyles.shell}>
      <View style={desktopStyles.rail}>
        <View style={desktopStyles.railBrand}>
          {themeMode() === 'light' ? (
            <Image
              source={require('./assets/icon.png')}
              style={desktopStyles.railBrandImageLight}
              resizeMode="cover"
            />
          ) : (
            <Image source={require('./assets/icon.png')} style={desktopStyles.railBrandImage} resizeMode="cover" />
          )}
        </View>
        <View style={desktopStyles.railTabs}>
          {DESKTOP_MAIN_TABS.map(tab => (
            <Pressable key={tab.key} accessibilityLabel={tab.label} onPress={() => setScreen({ name: tab.key } as Screen)} style={[desktopStyles.railButton, active === tab.key && desktopStyles.railButtonActive]}>
              <Ionicons name={active === tab.key ? tab.iconActive : tab.icon} size={22} color={active === tab.key ? colors.accent : colors.textSecondary} />
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityLabel={DESKTOP_SETTINGS_TAB.label}
          onPress={() => setScreen({ name: DESKTOP_SETTINGS_TAB.key })}
          style={[desktopStyles.railButton, desktopStyles.railSettings, active === DESKTOP_SETTINGS_TAB.key && desktopStyles.railButtonActive]}
        >
          <Ionicons
            name={active === DESKTOP_SETTINGS_TAB.key ? DESKTOP_SETTINGS_TAB.iconActive : DESKTOP_SETTINGS_TAB.icon}
            size={22}
            color={active === DESKTOP_SETTINGS_TAB.key ? colors.accent : colors.textSecondary}
          />
        </Pressable>
        <Text style={desktopStyles.railVersion}>v{APP_VERSION}</Text>
      </View>
      <View style={desktopStyles.conversations}>
        {serverWorkspace ? (
          <ServerSidebar cfg={cfg} active={serverSectionForScreen(screen)} onSelect={section => {
            if (section === 'overview') setScreen({ name: 'server' });
            else if (section === 'nodes') setScreen({ name: 'serverNodes' });
            else if (section === 'create') setScreen({ name: 'picker' });
            else setScreen({ name: 'logs' });
          }} />
        ) : (
          <AgentsScreen cfg={cfg} compact selectedAlias={screen.name === 'chat' || screen.name === 'nodeInfo' ? screen.alias : undefined} pinnedAliases={pinnedAliases} onTogglePin={togglePin} onOpenChatWindow={alias => { void openRememberedChatWindow(alias, cfg.profileId, cfg.username || cfg.serverUrl); }} onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenPicker={() => setScreen({ name: 'picker' })} onOpenNodeDetail={alias => setScreen({ name: 'nodeDetail', alias })} />
        )}
      </View>
      <View style={desktopStyles.content}>{content}</View>
    </View>
  );
}

function serverSectionForScreen(screen: Screen): ServerSection {
  if (screen.name === 'serverNodes' || screen.name === 'serverNodeDetail') return 'nodes';
  if (screen.name === 'picker' || screen.name === 'wizard') return 'create';
  if (screen.name === 'logs') return 'logs';
  return 'overview';
}

const makeDesktopStyles = () => StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  rail: { width: 58, backgroundColor: themeMode() === 'light' ? '#f0f1f3' : colors.inputBg, borderRightWidth: 1, borderRightColor: colors.border, alignItems: 'center', paddingVertical: 12 },
  railBrand: {
    width: 38,
    height: 38,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: themeMode() === 'light' ? '#e5f5f6' : 'transparent',
    borderWidth: themeMode() === 'light' ? 1 : 0,
    borderColor: themeMode() === 'light' ? '#c8e7e9' : 'transparent',
  },
  railBrandImage: { width: 38, height: 38 },
  railBrandImageLight: { width: 30, height: 30, borderRadius: 8 },
  railTabs: { flex: 1, paddingTop: 20, gap: 6 },
  railButton: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  railButtonActive: { backgroundColor: themeMode() === 'light' ? '#dde2e7' : colors.card },
  railSettings: { marginBottom: 10 },
  railVersion: { color: colors.textMuted, fontSize: 9 },
  conversations: { width: 310, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: themeMode() === 'light' ? '#fafafb' : colors.bg },
  content: { flex: 1, minWidth: 0, backgroundColor: themeMode() === 'light' ? '#f2f4f7' : colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyTitle: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: colors.textMuted, fontSize: 12 },
});

export function LoginScreen({ onLogin, initialProfile, onCancelReauth }: { onLogin: (cfg: HubConfig) => Promise<void>; initialProfile?: Pick<HubProfile, 'profileId' | 'serverUrl' | 'username'> | null; onCancelReauth?: () => Promise<void> }) {
  const [serverUrl, setServerUrl] = useState(initialProfile?.serverUrl ?? '');
  const [username, setUsername] = useState(initialProfile?.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const entryStyles = useMemo(makeEntryStyles, []);
  const loginStyles = useMemo(makeLoginStyles, []);
  const { width } = useWindowDimensions();
  const compact = width < 520;

  // PR4:失败按 kind 分开渲染(凭据错/网络不可达/地址不对/服务器异常——用户下一步
  // 动作完全不同,不许合并成一句「登录失败」)。error=null 即无错。
  const [failKind, setFailKind] = useState<LoginFailureKind | null>(null);
  const [failDetail, setFailDetail] = useState('');

  const submit = async () => {
    setFailKind(null); setFailDetail(''); setError('');
    // 预检:URL 规范化(自动补 https://·去尾斜杠);不合法 → bad-url,不发网络请求。
    const norm = normalizeServerUrl(serverUrl);
    if (!norm.ok) { setFailKind('bad-url'); return; }
    setBusy(true);
    const result = await login(norm.url, username.trim(), password);
    if (result.ok) {
      try {
        await onLogin(result.cfg);
      } catch (saveError) {
        setError(`无法保存登录状态：${saveError instanceof Error ? saveError.message : String(saveError)}`);
      }
    } else {
      setFailKind(result.kind); setFailDetail(result.error);
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={entryStyles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID="login-screen">
      <View pointerEvents="none" style={[entryStyles.glow, entryStyles.glowTop]} />
      <View pointerEvents="none" style={[entryStyles.glow, entryStyles.glowBottom]} />
      <ScrollView style={loginStyles.scrollView} contentContainerStyle={loginStyles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={[entryStyles.card, loginStyles.card, compact && entryStyles.cardCompact]}>
        <View style={entryStyles.logoHalo}>
          <Image source={require('./assets/splash-icon.png')} style={entryStyles.logo} resizeMode="contain" />
        </View>
        <View style={loginStyles.heading}>
          <Text style={entryStyles.eyebrow}>{initialProfile ? 'RECONNECT ACCOUNT' : 'WELCOME BACK'}</Text>
          <Text style={entryStyles.title}>{initialProfile ? '重新验证账号' : '连接你的工作区'}</Text>
          <Text style={entryStyles.copy}>{initialProfile ? '登录状态已失效。重新验证只会更新这个账号，其他工作区不会受到影响。' : '输入服务器和账号信息，继续与你的 Agent 协作。'}</Text>
        </View>
        <View style={loginStyles.form}>
          <View style={loginStyles.field}>
            <Text style={loginStyles.label}>服务器地址</Text>
            <View style={loginStyles.inputShell}>
              <Ionicons name="server-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={loginStyles.input}
                placeholder="https://your-hub.example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={serverUrl}
                onChangeText={setServerUrl}
                accessibilityLabel="服务器地址"
              />
            </View>
          </View>
          <View style={loginStyles.field}>
            <Text style={loginStyles.label}>用户名</Text>
            <View style={loginStyles.inputShell}>
              <Ionicons name="person-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={loginStyles.input}
                placeholder="输入用户名"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                accessibilityLabel="用户名"
              />
            </View>
          </View>
          <View style={loginStyles.field}>
            <Text style={loginStyles.label}>密码</Text>
            <View style={loginStyles.inputShell}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={loginStyles.input}
                placeholder="输入密码"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                secureTextEntry={!passwordVisible}
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="密码"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'}
                hitSlop={8}
                onPress={() => setPasswordVisible(current => !current)}
                style={loginStyles.eyeButton}
              >
                <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={19} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        </View>
      {/* 每种失败分开渲染:testID=login-error-<kind>(结构可断言·不耦合文案);
          文案=发生了什么+下一步做什么;服务器原始信息作小字辅助不当主文案。 */}
      {failKind ? (
        <View testID={`login-error-${failKind}`} style={loginStyles.errorBox} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color={colors.failed} />
          <View style={loginStyles.errorCopy}>
          <Text style={loginStyles.errorTitle}>{LOGIN_FAILURE_COPY[failKind].what}</Text>
          <Text style={loginStyles.errorNext}>{LOGIN_FAILURE_COPY[failKind].next}</Text>
          {failDetail ? (
            <Text style={loginStyles.errorDetail} numberOfLines={2}>{failDetail}</Text>
          ) : null}
          </View>
        </View>
      ) : error ? (
        <View style={loginStyles.errorBox} accessibilityRole="alert"><Ionicons name="alert-circle-outline" size={18} color={colors.failed} /><Text style={loginStyles.errorTitle}>{error}</Text></View>
      ) : null}
      <Pressable
        style={({ pressed }) => [entryStyles.primary, (!serverUrl || !username || !password) && loginStyles.inactive, pressed && entryStyles.pressed]}
        onPress={submit}
        disabled={busy || !serverUrl || !username || !password}
        testID="login-submit"
      >
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="login-busy">
            <ActivityIndicator color="#fff" />
            <Text style={entryStyles.primaryText}>正在安全连接…</Text>
          </View>
        ) : (
          <View style={entryStyles.buttonRow}><Text style={entryStyles.primaryText}>登录工作区</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></View>
        )}
      </Pressable>
      {onCancelReauth ? (
        <Pressable style={entryStyles.secondary} onPress={() => { void onCancelReauth().catch(cancelError => setError(String(cancelError))); }}>
          <Text style={entryStyles.secondaryText}>暂不处理，切换其他账号</Text>
        </Pressable>
      ) : null}
      {/* Version on the login page so device screenshots are
          unambiguous about which build is installed (tg 692). */}
      <View style={loginStyles.securityNote}><Ionicons name="shield-checkmark-outline" size={13} color={colors.textMuted} /><Text style={loginStyles.version}>安全连接 · v{APP_VERSION}</Text></View>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeLoginStyles = () => StyleSheet.create({
  scrollView: { width: '100%' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  card: { maxWidth: 450, gap: 18 },
  heading: { gap: 7 },
  form: { gap: 13, marginTop: 1 },
  field: { gap: 7 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginLeft: 2 },
  inputShell: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 13, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 12 },
  eyeButton: { width: 28, height: 34, alignItems: 'center', justifyContent: 'center' },
  inactive: { opacity: 0.45, shadowOpacity: 0 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 12, backgroundColor: themeMode() === 'light' ? '#fff1f2' : '#291417', borderWidth: 1, borderColor: themeMode() === 'light' ? '#fecdd3' : '#552329' },
  errorCopy: { flex: 1 },
  errorTitle: { flex: 1, color: colors.failed, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  errorNext: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  errorDetail: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  securityNote: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 5, marginTop: -3 },
  version: { color: colors.textMuted, fontSize: 10 },
});
