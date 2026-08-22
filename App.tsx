import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
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
import ChatScreen from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import ServerScreen from './src/ServerScreen';
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
import { clearConfig, loadConfig, loadLocalAvatars, loadOutbox, loadThemeMode, saveConfig, saveLocalAvatars, saveOutbox } from './src/storage';
import { initOutbox } from './src/outbox';
import { colors, onThemeChange, setThemeMode, spacing, themeMode } from './src/theme';
import { styles } from './src/app-styles';
import { APP_VERSION } from './src/version';

type Screen =
  | { name: 'login' }
  | { name: 'agents' }
  | { name: 'tasks' }
  | { name: 'scheduled' }
  | { name: 'messages' }
  | { name: 'server' }
  | { name: 'settings' }
  | { name: 'chat'; alias: string }
  | { name: 'taskDetail'; taskId: string }   // full-screen (no tab bar) — hardware back returns to /tasks list
  | { name: 'nodeDetail'; alias: string }  // issue #8 row 4 (V1) — long-press an agent row from AgentsScreen; back returns to agents
  | { name: 'logs' }                        // row 6 — network event stream leaf reached from Server tab; back returns to server
  | { name: 'picker' }       // #338 RFC-026 §9.4 host_supervisor picker (modal-style, back returns to agents)
  | { name: 'wizard'; daemon: HostSupervisorDaemon };  // #338 wizard rest (Plan B) — created after picker selects a daemon

// 跟微信的学一学 (Vincent tg 807): icon over small label, active tint.
// Desktop keeps operational modules together and pins Settings to the bottom.
const TABS = [
  { key: 'agents', label: 'Agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'tasks', label: 'Tasks', icon: 'list-outline', iconActive: 'list' },
  { key: 'scheduled', label: '定时', icon: 'time-outline', iconActive: 'time' },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
  { key: 'server', label: '服务器设置', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: '设置', icon: 'settings-outline', iconActive: 'settings' },
] as const;

const DESKTOP_MAIN_TABS = TABS.filter(tab => tab.key !== 'settings');
const DESKTOP_SETTINGS_TAB = TABS.find(tab => tab.key === 'settings')!;

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
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'login' });
  const [booting, setBooting] = useState(true);
  // Keyed remount on theme switch: module-level styles were already
  // rebuilt by the onThemeChange listeners, the new key re-renders the tree.
  const [theme, setTheme] = useState(themeMode());
  useEffect(() => onThemeChange(setTheme), []);
  // RN's SafeAreaView only covers iOS; Android edge-to-edge draws the
  // tab bar under the gesture bar (Vincent tg 802) — pad by the real inset.
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ && width >= 860;
  const tabBarInset = Platform.OS === 'android' ? insets.bottom : 0;

  // Restore the saved session on cold start — login survives app kills.
  // Invariant: loadConfig/loadThemeMode must never reject (both swallow
  // their own errors and return null). A rejection here would skip the
  // .then, leaving `booting` true forever = a permanent boot spinner —
  // so keep those two best-effort if they're ever refactored.
  useEffect(() => {
    Promise.all([loadConfig(), loadThemeMode(), loadLocalAvatars(), loadOutbox()]).then(([saved, mode, localAvatars, outbox]) => {
      if (mode === 'light' || mode === 'dark') setThemeMode(mode);
      // R2 avatar: seed the per-device local echo layer + wire its writer, so
      // session-only aliases keep their user-set avatar across restarts.
      initLocalAvatars(localAvatars, (m) => { void saveLocalAvatars(m); });
      // PR3 判据C:恢复未送达 outbox(pending 一律恢复为 failed=命运未知按未送达),
      // 注入落盘写手——此后 提交即落盘/确认才删。
      initOutbox(outbox, (all) => { void saveOutbox(all); });
      if (saved) {
        setCfg(saved);
        setScreen({ name: 'agents' });
        // Fire the status request now so its RTT overlaps the boot→AgentsScreen
        // mount; AgentsScreen's first load consumes this in-flight promise.
        prefetchStatus(saved);
      }
      setBooting(false);
    });
  }, []);

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

  if (desktop && cfg && screen.name !== 'login') {
    return (
      <SafeAreaView key={theme} style={styles.root}>
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={colors.bg} />
        <ConnectivityBanner />
        <DesktopWorkspace cfg={cfg} screen={screen} setScreen={setScreen} onLogout={() => {
          clearConfig();
          setCfg(null);
          setScreen({ name: 'login' });
        }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView key={theme} style={styles.root}>
      <StatusBar
        barStyle={theme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.bg}
      />
      {/* 全局连接状态横幅(App战线①):断连时所有已登录界面顶部出现,声明缓存数据+
          诚实的"截至"时间(最后一次成功,非尝试)。登录页不挂(还没有 hub 可言)。 */}
      {screen.name !== 'login' && cfg ? <ConnectivityBanner /> : null}
      {screen.name === 'login' || !cfg ? (
        <LoginScreen
          onLogin={c => {
            setCfg(c);
            saveConfig(c);
            setScreen({ name: 'agents' });
          }}
        />
      ) : screen.name === 'chat' ? (
        <ChatScreen
          cfg={cfg}
          alias={screen.alias}
          onBack={() => setScreen({ name: 'agents' })}
        />
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
                onLogout={() => {
                  clearConfig();
                  setCfg(null);
                  setScreen({ name: 'login' });
                }}
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
            {TABS.map(tab => (
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

const bootStyles = StyleSheet.create({
  root: { backgroundColor: '#07152f' },
  logo: { width: 156, height: 156, borderRadius: 34 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8 },
});

function DesktopWorkspace({ cfg, screen, setScreen, onLogout }: {
  cfg: HubConfig;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onLogout: () => void;
}) {
  // AppRoot is keyed by theme, so this component remounts after every theme
  // switch. Build desktop styles on that mount instead of freezing the dark
  // palette once at module import time.
  const desktopStyles = useMemo(makeDesktopStyles, []);
  const active = ['chat', 'nodeDetail', 'picker', 'wizard'].includes(screen.name) ? 'agents' : screen.name;
  const content = screen.name === 'chat' ? (
    <ChatScreen
      cfg={cfg}
      alias={screen.alias}
      onBack={() => setScreen({ name: 'agents' })}
      onOpenSettings={() => setScreen({ name: 'settings' })}
      desktop
    />
  ) : screen.name === 'tasks' ? (
    <TasksScreen cfg={cfg} onOpenTask={taskId => setScreen({ name: 'taskDetail', taskId })} />
  ) : screen.name === 'scheduled' ? <ScheduledTasksScreen cfg={cfg} />
  : screen.name === 'messages' ? <MessagesScreen cfg={cfg} />
  : screen.name === 'server' ? <ServerScreen cfg={cfg} onOpenLogs={() => setScreen({ name: 'logs' })} />
  : screen.name === 'settings' ? <SettingsScreen cfg={cfg} onLogout={onLogout} />
  : screen.name === 'taskDetail' ? <TaskDetailScreen cfg={cfg} taskId={screen.taskId} onBack={() => setScreen({ name: 'tasks' })} />
  : screen.name === 'nodeDetail' ? <NodeDetailScreen cfg={cfg} alias={screen.alias} onBack={() => setScreen({ name: 'agents' })} />
  : screen.name === 'logs' ? <LogsScreen cfg={cfg} onBack={() => setScreen({ name: 'server' })} />
  : screen.name === 'picker' ? <HostSupervisorPickerScreen cfg={cfg} onBack={() => setScreen({ name: 'agents' })} onPicked={d => setScreen({ name: 'wizard', daemon: d })} />
  : screen.name === 'wizard' ? <CreateNodeWizardScreen cfg={cfg} daemon={screen.daemon} onBack={() => setScreen({ name: 'picker' })} onExit={() => setScreen({ name: 'agents' })} />
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
        <View style={desktopStyles.railBrand}><Text style={desktopStyles.railBrandText}>AN</Text></View>
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
        <AgentsScreen cfg={cfg} compact selectedAlias={screen.name === 'chat' ? screen.alias : undefined} onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenPicker={() => setScreen({ name: 'picker' })} onOpenNodeDetail={alias => setScreen({ name: 'nodeDetail', alias })} />
      </View>
      <View style={desktopStyles.content}>{content}</View>
    </View>
  );
}

const makeDesktopStyles = () => StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  rail: { width: 64, backgroundColor: colors.inputBg, borderRightWidth: 1, borderRightColor: colors.border, alignItems: 'center', paddingVertical: 14 },
  railBrand: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  railBrandText: { color: colors.bg, fontSize: 12, fontWeight: '800' },
  railTabs: { flex: 1, paddingTop: 22, gap: 8 },
  railButton: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  railButtonActive: { backgroundColor: colors.card },
  railSettings: { marginBottom: 10 },
  railVersion: { color: colors.textMuted, fontSize: 9 },
  conversations: { width: 304, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.bg },
  content: { flex: 1, minWidth: 0, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyTitle: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: colors.textMuted, fontSize: 12 },
});

function LoginScreen({ onLogin }: { onLogin: (cfg: HubConfig) => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    setBusy(false);
    if (result.ok) onLogin(result.cfg);
    else { setFailKind(result.kind); setFailDetail(result.error); }
  };

  return (
    <View style={styles.loginWrap}>
      <Text style={styles.brand}>Agent Network</Text>
      <TextInput
        style={styles.input}
        placeholder="服务器地址 (https://your-hub.example.com)"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={serverUrl}
        onChangeText={setServerUrl}
      />
      <TextInput
        style={styles.input}
        placeholder="用户名"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="密码"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {/* 每种失败分开渲染:testID=login-error-<kind>(结构可断言·不耦合文案);
          文案=发生了什么+下一步做什么;服务器原始信息作小字辅助不当主文案。 */}
      {failKind ? (
        <View testID={`login-error-${failKind}`} style={{ alignSelf: 'stretch', marginBottom: spacing.sm }}>
          <Text style={styles.error}>{LOGIN_FAILURE_COPY[failKind].what}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{LOGIN_FAILURE_COPY[failKind].next}</Text>
          {failDetail ? (
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }} numberOfLines={2}>{failDetail}</Text>
          ) : null}
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        onPress={submit}
        disabled={busy || !serverUrl || !username || !password}
        testID="login-submit"
      >
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="login-busy">
            <ActivityIndicator color={colors.bg} />
            <Text style={styles.buttonText}>正在连接服务器…</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>登录</Text>
        )}
      </Pressable>
      {/* Version on the login page so device screenshots are
          unambiguous about which build is installed (tg 692). */}
      <Text style={styles.version}>v{APP_VERSION}</Text>
    </View>
  );
}
