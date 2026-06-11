import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchStatus, login, HubConfig, Session } from './src/api';
import ChatScreen from './src/ChatScreen';
import MessagesScreen from './src/MessagesScreen';
import { clearConfig, loadConfig, saveConfig } from './src/storage';
import { colors, spacing, statusColor } from './src/theme';
import { APP_VERSION } from './src/version';

type Screen =
  | { name: 'login' }
  | { name: 'agents' }
  | { name: 'messages' }
  | { name: 'chat'; alias: string };

const TABS = [
  { key: 'agents', label: 'Agents' },
  { key: 'messages', label: 'Messages' },
] as const;

export default function App() {
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'login' });
  const [booting, setBooting] = useState(true);

  // Restore the saved session on cold start — login survives app kills.
  useEffect(() => {
    loadConfig().then(saved => {
      if (saved) {
        setCfg(saved);
        setScreen({ name: 'agents' });
      }
      setBooting(false);
    });
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
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
            ) : (
              <AgentsScreen
                cfg={cfg}
                onOpenChat={alias => setScreen({ name: 'chat', alias })}
                onLogout={() => {
                  clearConfig();
                  setCfg(null);
                  setScreen({ name: 'login' });
                }}
              />
            )}
          </View>
          <View style={styles.tabBar}>
            {TABS.map(tab => (
              <Pressable
                key={tab.key}
                style={styles.tab}
                onPress={() =>
                  setScreen(tab.key === 'agents' ? { name: 'agents' } : { name: 'messages' })
                }
              >
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
        placeholder="服务器地址 (http://host:9999)"
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
  onLogout,
}: {
  cfg: HubConfig;
  onOpenChat: (alias: string) => void;
  onLogout: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchStatus(cfg);
      setSessions(data.sessions ?? []);
    } catch {
      /* keep last good list; pull-to-refresh retries */
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

  return (
    <FlatList
      data={sessions}
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
        <View style={styles.listHeaderRow}>
          <Text style={styles.listHeader}>{sessions.length} agents</Text>
          <Pressable onPress={onLogout} hitSlop={8}>
            <Text style={styles.logout}>退出登录</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          onPress={() => onOpenChat(item.alias)}
        >
          <View style={[styles.dot, { backgroundColor: statusColor(item.status, true) }]} />
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
          <Text style={styles.status}>{item.status}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  tabLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  tabActive: { color: colors.text },
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
  alias: { color: colors.text, fontSize: 15, fontWeight: '600' },
  task: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  status: { color: colors.textMuted, fontSize: 11 },
});
