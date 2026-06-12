import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HubConfig } from './api';
import { saveThemeMode } from './storage';
import { colors, onThemeChange, setThemeMode, spacing, themeMode } from './theme';
import { APP_VERSION } from './version';

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
}: {
  cfg: HubConfig;
  onLogout: () => void;
}) {
  const [me, setMe] = useState<Me>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${cfg.serverUrl}/api/auth/me`, {
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
      <Text style={styles.sectionTitle}>连接</Text>
      <View style={styles.card}>
        <Row label="服务器" value={cfg.serverUrl} />
        <Divider />
        <Row label="用户名" value={me.username ?? '—'} />
        <Divider />
        <Row
          label="网络"
          value={me.networkName ? `${me.networkName} (${me.networkId ?? ''})` : cfg.networkId ?? '—'}
        />
      </View>

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
      </View>

      <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
        onPress={onLogout}
      >
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>
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
  root: { flex: 1, padding: spacing.lg },
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
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
