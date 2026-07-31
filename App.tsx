import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { purgeLegacyAttachmentCache } from './src/AuthedThumb';
import { prefetchStatus, login, HubConfig } from './src/api';
import ChatScreen from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import ServerScreen from './src/ServerScreen';
import HostSupervisorPickerScreen from './src/HostSupervisorPickerScreen';
import CreateNodeWizardScreen from './src/CreateNodeWizardScreen';
import SettingsScreen from './src/SettingsScreen';
import AgentsScreen from './src/AgentsScreen';
import type { HostSupervisorDaemon } from './src/api';
import { clearConfig, loadConfig, loadThemeMode, saveConfig } from './src/storage';
import { colors, onThemeChange, setThemeMode, themeMode } from './src/theme';
import { styles } from './src/app-styles';
import { APP_VERSION } from './src/version';

type Screen =
  | { name: 'login' }
  | { name: 'agents' }
  | { name: 'messages' }
  | { name: 'server' }
  | { name: 'settings' }
  | { name: 'chat'; alias: string }
  | { name: 'picker' }       // #338 RFC-026 §9.4 host_supervisor picker (modal-style, back returns to agents)
  | { name: 'wizard'; daemon: HostSupervisorDaemon };  // #338 wizard rest (Plan B) — created after picker selects a daemon

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
                onOpenPicker={() => setScreen({ name: 'picker' })}
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
