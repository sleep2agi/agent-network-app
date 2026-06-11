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
import { fetchStatus, verifyConfig, HubConfig, Session } from './src/api';
import ChatScreen from './src/ChatScreen';
import { colors, spacing, statusColor } from './src/theme';

// Round 1 skeleton: token login → agents list. Chat / messages / settings
// land in later rounds (#220). Config is in-memory for now; persistent
// storage (expo-secure-store) comes with the settings round.

type Screen = { name: 'login' } | { name: 'agents' } | { name: 'chat'; alias: string };

export default function App() {
  const [cfg, setCfg] = useState<HubConfig | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'login' });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {screen.name === 'login' || !cfg ? (
        <LoginScreen
          onLogin={c => {
            setCfg(c);
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
        <AgentsScreen cfg={cfg} onOpenChat={alias => setScreen({ name: 'chat', alias })} />
      )}
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: (cfg: HubConfig) => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const cfg = { serverUrl: serverUrl.replace(/\/$/, ''), token };
    setBusy(true);
    setError('');
    const ok = await verifyConfig(cfg);
    setBusy(false);
    if (ok) onLogin(cfg);
    else setError('无法连接：检查 Server 地址与 Token');
  };

  return (
    <View style={styles.loginWrap}>
      <Text style={styles.brand}>Agent Network</Text>
      <Text style={styles.brandSub}>connect to your CommHub</Text>
      <TextInput
        style={styles.input}
        placeholder="Server URL (https://…)"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={serverUrl}
        onChangeText={setServerUrl}
      />
      <TextInput
        style={styles.input}
        placeholder="Token"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        secureTextEntry
        value={token}
        onChangeText={setToken}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
        onPress={submit}
        disabled={busy || !serverUrl || !token}
      >
        {busy ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.buttonText}>连接</Text>
        )}
      </Pressable>
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
        <Text style={styles.listHeader}>{sessions.length} agents</Text>
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
  listHeader: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.md },
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
