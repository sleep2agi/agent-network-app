// Hub #3711 —— 机器别名编辑卡（节点详情页）。
//
// 维度是 **hostname**（一台机器一个别名，不是节点别名）；同一台机器上的多个节点会显示同一个值。
// 契约：GET 人/节点令牌都能读；PUT 仅人类令牌（节点令牌 403 user_token_required）；
//       1–64 字、trim、禁控制字符；非法 400 invalid_machine_alias。
// 只读页（聊天里的「节点信息」）不出现编辑入口。
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { fetchMachineAlias, putMachineAlias, type HubConfig } from './api';
import { machineAliasErrorText, normalizeMachineAlias } from './machine-alias';
import { setMachineAliasCache } from './machine-alias-store';
import { colors, radius, spacing, type as typeScale, weight } from './theme';

export default function MachineAliasCard(props: { cfg: HubConfig; hostname?: string | null; onSaved?: (alias: string | null) => void }) {
  const { cfg, hostname, onSaved } = props;
  const host = String(hostname ?? '').trim();
  const [loading, setLoading] = useState(!!host);
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!host) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    void fetchMachineAlias(cfg, host).then(res => {
      if (!live) return;
      setCurrent(res?.alias ?? null);
      setDraft(res?.alias ?? '');
      setLoading(false);
    });
    return () => { live = false; };
  }, [cfg.serverUrl, cfg.profileId, cfg.token, host]);

  const save = async () => {
    if (!host || saving) return;
    const checked = normalizeMachineAlias(draft);
    if (!checked.ok) { setNotice(machineAliasErrorText(checked.error)); return; }
    setSaving(true);
    setNotice(null);
    const res = await putMachineAlias(cfg, host, checked.value);
    setSaving(false);
    if (!res.ok) { setNotice(machineAliasErrorText(res.error)); return; }
    setCurrent(res.alias);
    setDraft(res.alias ?? '');
    setMachineAliasCache(cfg, host, res.alias);
    onSaved?.(res.alias);
    setNotice('已保存');
  };

  const styles = makeStyles();
  return (
    <View>
      <Text style={styles.sectionTitle}>机器别名</Text>
      <View style={styles.card} testID="node-machine-alias-card">
        <Text style={styles.hint}>
          {host ? `这台机器的 hostname：${host}。别名只影响显示，同一台机器上的节点共用。` : '这个节点没有上报 hostname，暂时无法设置机器别名。'}
        </Text>
        {host ? (
          loading ? (
            <View style={styles.row}><ActivityIndicator size="small" color={colors.textMuted} /><Text style={styles.hint}>正在读取…</Text></View>
          ) : (
            <>
              <TextInput
                testID="node-machine-alias-input"
                value={draft}
                onChangeText={text => { setDraft(text); setNotice(null); }}
                placeholder={host}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                style={styles.input}
              />
              <View style={styles.row}>
                <Pressable
                  testID="node-machine-alias-save"
                  accessibilityRole="button"
                  accessibilityState={{ busy: saving, disabled: saving }}
                  onPress={() => { void save(); }}
                  style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.buttonText}>{saving ? '保存中…' : '保存'}</Text>
                </Pressable>
                <Text style={styles.hint}>当前：{current ?? '未设置（显示 hostname）'}</Text>
              </View>
            </>
          )
        ) : null}
        {notice ? <Text testID="node-machine-alias-notice" style={styles.notice}>{notice}</Text> : null}
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  sectionTitle: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: weight.strong, marginBottom: spacing.xs, marginTop: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.surface, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.card },
  hint: { color: colors.textMuted, fontSize: typeScale.small },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  button: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.control, backgroundColor: colors.accent },
  buttonText: { color: '#fff', fontSize: typeScale.small, fontWeight: weight.strong },
  notice: { color: colors.textMuted, fontSize: typeScale.small },
});
