import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AliasAvatar from './src/AliasAvatar';
import { fetchStatus, prefetchStatus, takeStatusPrefetch, login, HubConfig, Session } from './src/api';
import ChatScreen from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import ServerScreen from './src/ServerScreen';
import SettingsScreen from './src/SettingsScreen';
import { clearConfig, loadConfig, loadThemeMode, saveConfig, saveSessionsCache, loadSessionsCache } from './src/storage';
import { colors, onThemeChange, setThemeMode, spacing, statusColor, themeMode } from './src/theme';
import { usePoll } from './src/usePoll';
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
        // Fire the status request now so its RTT overlaps the boot→AgentsScreen
        // mount; AgentsScreen's first load consumes this in-flight promise.
        prefetchStatus(saved);
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

// Derive a team/group key from an alias so the agent list can be grouped
// (Vincent tg 1094 — "支持分组展示"). The fleet's aliases follow a
// <team><role> convention (通信龙, 工程马, 课程牛, 通信N站马, N站牛 …); we
// drop the trailing role character to recover the team. An explicit separator
// wins first; latin/short aliases fall back to a leading slice so they still
// bucket sensibly.
function teamOf(alias: string): string {
  const a = (alias || '').trim();
  if (!a) return '其他';
  // explicit separator wins (e.g. "team/role" → "team")
  const seg = a.split(/[\s/_\-:|·]+/)[0];
  if (seg && seg !== a) return seg;
  // coarse team = leading 2 chars: the fleet's <team><role> aliases share a
  // 2-char team prefix (通信龙 / 通信N站马 / 通信测试牛 → 通信; 工程马 → 工程;
  // N站牛 → N站). Keeps groups few + findable rather than one-per-agent.
  return a.length <= 2 ? a : a.slice(0, 2);
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
      // First load consumes the boot prefetch if it's still in-flight/fresh;
      // polls and later loads fall through to a normal fetch.
      const data = await (takeStatusPrefetch(cfg) ?? fetchStatus(cfg));
      const next = data.sessions ?? [];
      setSessions(next);
      setFailed(false);
      // Persist for the next cold start's stale-while-revalidate paint.
      saveSessionsCache(next);
    } catch {
      /* keep last good list; with nothing loaded yet, surface the failure */
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cfg]);

  // Perf (load time): paint the last-known agents from the disk cache
  // immediately so cold start shows content instead of a blank spinner; the
  // live fetch below refreshes within the same tick. Only fills in if the
  // fetch hasn't already populated the list (prev.length guard), so fresh
  // data always wins the race.
  useEffect(() => {
    let live = true;
    loadSessionsCache().then(cached => {
      if (live && cached && cached.length) {
        setSessions(prev => (prev.length ? prev : cached));
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, []);

  // Foreground-only polling: 10s while visible, paused in background, instant
  // refresh on resume (shared hook — see usePoll).
  usePoll(load, 10000, [load]);

  // 153 agents on the real hub made the flat list unusable. Vincent (tg
  // 1094): group by team so agents are findable, and stop showing offline
  // ones up front. We bucket by team prefix (derived from the alias), order
  // rows inside each team working → idle-online → offline, and sink teams
  // that have no online member to the bottom — so offline never floats up.
  // NOTE: this useMemo MUST stay above the early returns below — a hook after
  // a conditional return changes hook order between renders and crashes (the
  // v0.1.28 launch-crash regression, Vincent tg 1098).
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    const isOffline = (s: Session) => s.status === 'offline';
    const isWorking = (s: Session) => s.status === 'working' || s.status === 'running';
    const rank = (s: Session) => (isWorking(s) ? 0 : isOffline(s) ? 2 : 1);
    const filtered = sessions.filter(s => !q || s.alias.toLowerCase().includes(q));

    const groups = new Map<string, Session[]>();
    for (const s of filtered) {
      const key = teamOf(s.alias);
      const bucket = groups.get(key);
      if (bucket) bucket.push(s);
      else groups.set(key, [s]);
    }

    return [...groups.entries()]
      .map(([title, items]) => {
        items.sort((a, b) => rank(a) - rank(b) || a.alias.localeCompare(b.alias));
        const online = items.filter(s => !isOffline(s)).length;
        return { title, data: items, online, total: items.length };
      })
      // teams with someone online first; then by online count; then alpha
      .sort(
        (a, b) =>
          (b.online > 0 ? 1 : 0) - (a.online > 0 ? 1 : 0) ||
          b.online - a.online ||
          a.title.localeCompare(b.title),
      );
  }, [sessions, q]);
  const shownCount = sections.reduce((n, g) => n + g.data.length, 0);

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

  return (
    <SectionList
      sections={sections}
      keyExtractor={s => s.alias}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeader}>{section.title}</Text>
          <Text style={styles.sectionCount}>
            {section.online}/{section.total} 在线
          </Text>
        </View>
      )}
      // Perf (render time): the real fleet is 150+ agents. Without these the
      // default virtualization renders/retains far more rows than fit on
      // screen, spiking first-paint cost and scroll jank. Cap the initial
      // batch to ~one screenful and shrink the retained window. (Deliberately
      // NOT using removeClippedSubviews — it can blank rows / break taps on
      // some RN versions, and correctness beats the marginal extra saving.)
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={50}
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
              {q ? `${shownCount} / ${sessions.length} agents` : `${sessions.length} agents`}
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeader: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCount: { color: colors.textMuted, fontSize: 11 },
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
