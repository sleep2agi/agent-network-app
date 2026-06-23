import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AliasAvatar from './src/AliasAvatar';
import { fetchStatus, login, HubConfig, Session } from './src/api';
import ChatScreen from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import ServerScreen from './src/ServerScreen';
import SettingsScreen from './src/SettingsScreen';
import { clearConfig, loadConfig, loadThemeMode, saveConfig } from './src/storage';
import { colors, onThemeChange, setThemeMode, spacing, statusColor, themeMode } from './src/theme';
import { APP_VERSION } from './src/version';

type Screen =
  | { name: 'login' }
  | { name: 'agents' }
  | { name: 'messages' }
  | { name: 'server' }
  | { name: 'settings' }
  | { name: 'chat'; alias: string };

// 跟微信的学一学 (Vincent tg 807): icon over small label, active tint.
// Server tab sits left of 设置 (Vincent tg 847).
const TABS = [
  { key: 'agents', label: 'Agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
  { key: 'server', label: 'Server', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: '设置', icon: 'settings-outline', iconActive: 'settings' },
] as const;

// Inside the Tauri shell, WKWebView enforces CORS and the hub sets no
// (valid) CORS headers — swap the global fetch for the Rust-side http
// plugin, which issues requests from native code and so is not subject to
// CORS at all (tg 824). Native iOS/Android use RN's fetch directly and
// never hit this path.
//
// Timing note for future readers: the dynamic import is fire-and-forget,
// so the swap lands a microtask after module eval. Any request issued
// before it resolves would still use the CORS-bound WKWebView fetch — in
// practice the import settles during boot, well before the login screen is
// interactive. api.ts always calls the bare global `fetch` (it never
// captures a reference), so once this assignment runs every later call
// routes through the plugin.
if ((globalThis as any).__TAURI_INTERNALS__) {
  import('@tauri-apps/plugin-http').then(m => {
    (globalThis as any).fetch = m.fetch;
  });
}

export default function App() {
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
  const tabBarInset = Platform.OS === 'android' ? insets.bottom : 0;

  // Restore the saved session on cold start — login survives app kills.
  // Invariant: loadConfig/loadThemeMode must never reject (both swallow
  // their own errors and return null). A rejection here would skip the
  // .then, leaving `booting` true forever = a permanent boot spinner —
  // so keep those two best-effort if they're ever refactored.
  useEffect(() => {
    Promise.all([loadConfig(), loadThemeMode()]).then(([saved, mode]) => {
      if (mode === 'light' || mode === 'dark') setThemeMode(mode);
      if (saved) {
        setCfg(saved);
        setScreen({ name: 'agents' });
      }
      setBooting(false);
    });
  }, []);

  // System back (button or fullscreen gesture) navigates within the app
  // instead of exiting (Vincent tg 730). Agents/login fall through to
  // the default exit behavior.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView key={theme} style={styles.root}>
      <StatusBar
        barStyle={theme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.bg}
      />
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
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {screen.name === 'messages' ? (
              <MessagesScreen cfg={cfg} />
            ) : screen.name === 'server' ? (
              <ServerScreen cfg={cfg} />
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

function LoginScreen({ onLogin }: { onLogin: (cfg: HubConfig) => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    const result = await login(serverUrl.replace(/\/$/, ''), username.trim(), password);
    setBusy(false);
    if (result.ok) onLogin(result.cfg);
    else setError(`登录失败：${result.error}`);
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        onPress={submit}
        disabled={busy || !serverUrl || !username || !password}
      >
        {busy ? (
          <ActivityIndicator color={colors.bg} />
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

function AgentsScreen({
  cfg,
  onOpenChat,
}: {
  cfg: HubConfig;
  onOpenChat: (alias: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchStatus(cfg);
      setSessions(data.sessions ?? []);
      setFailed(false);
    } catch {
      /* keep last good list; with nothing loaded yet, surface the failure */
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cfg]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // First load failed with nothing cached: a spinner forever is a dead end
  // (Vincent tg 841) — say so and give a retry button.
  if (failed && sessions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>连接失败</Text>
        <Text style={styles.errorHint}>网络不稳定或服务器未响应，请重试</Text>
        <Pressable
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={() => {
            setLoading(true);
            load();
          }}
        >
          <Text style={styles.retryBtnText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  // 153 agents on the real hub made the flat list unusable: working
  // sessions float to the top, and a search box narrows by alias.
  const working = (s: Session) => s.status === 'working' || s.status === 'running';
  const q = query.trim().toLowerCase();
  const shown = sessions
    .filter(s => !q || s.alias.toLowerCase().includes(q))
    .sort((a, b) => {
      if (working(a) !== working(b)) return working(a) ? -1 : 1;
      return a.alias.localeCompare(b.alias);
    });

  return (
    <FlatList
      data={shown}
      keyExtractor={s => s.alias}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.accent}
        />
      }
      ListHeaderComponent={
        <View>
          <View style={styles.listHeaderRow}>
            <Text style={styles.listHeader}>
              {q ? `${shown.length} / ${sessions.length} agents` : `${sessions.length} agents`}
            </Text>
          </View>
          {sessions.length > 10 ? (
            <TextInput
              style={styles.search}
              placeholder="搜索 agent…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
            />
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [
            styles.card,
            item.status === 'offline' && styles.cardOffline,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => onOpenChat(item.alias)}
        >
          <AliasAvatar alias={item.alias} size={34} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.alias} numberOfLines={1}>
              {item.alias}
            </Text>
            {item.task ? (
              <Text style={styles.task} numberOfLines={1}>
                {item.task}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.status, { color: statusColor(item.status ?? '', true) }]}>
            {item.status}
          </Text>
        </Pressable>
      )}
    />
  );
}

const makeStyles = () =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    // RN's SafeAreaView is iOS-only; Android edge-to-edge draws content
    // under the status bar (Vincent tg 729: clock overlapped the chat
    // header). Pad the root by the real status-bar height instead.
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  errorTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  errorHint: { color: colors.textMuted, fontSize: 13 },
  retryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  retryBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  loginWrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  brand: { color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  brandSub: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  error: { color: colors.failed, fontSize: 13 },
  version: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.md },
  listHeader: { color: colors.textMuted, fontSize: 12 },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logout: { color: colors.textMuted, fontSize: 12 },
  search: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  tabLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  tabActive: { color: colors.accent, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  // 下线的灰色调，别都亮着 (Vincent tg 753)
  cardOffline: { opacity: 0.45 },
  alias: { color: colors.text, fontSize: 15, fontWeight: '600' },
  task: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  status: { color: colors.textMuted, fontSize: 11 },
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
