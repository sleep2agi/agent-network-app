import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './ui-text';
import { colors, spacing } from './theme';
import { readinessFor, type ReadinessInput } from './runtime-readiness';
import type { WizardRuntime } from './wizard-runtime-groups';
import { unavailableAiReason } from './unavailable-ai-reason';

function HelpRow({ ai, daemon }: { ai: WizardRuntime; daemon: ReadinessInput }) {
  const [open, expand] = useState(false), [details, showDetails] = useState(false);
  const [copy, setCopy] = useState('复制');
  const { state, reason } = readinessFor(daemon, ai.id);
  const supported = !daemon.runtimes_supported?.length || daemon.runtimes_supported.includes(ai.id);
  const label = unavailableAiReason(daemon.runtime_readiness?.[ai.id]?.state, supported);
  const login = state === 'not_logged_in', missing = state === 'missing_cli', network = state === 'no_network';
  const command = login && ai.id.startsWith('codex') ? 'codex login --device-auth' : login && ai.id.startsWith('antigravity') ? 'agy acp --login' : 'anet doctor';
  const muted = { color: colors.textSecondary };
  return <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, gap: spacing.sm }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { expand(!open); showDetails(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 }}>
      <Text style={[muted, { flex: 1 }]}>{ai.label}</Text><Text style={muted}>{label}</Text>
    </Pressable>
    {open && <><Text style={{ color: colors.text }}>怎么解决</Text>
      <Text style={muted}>{login ? '在这台机器上登录这个 AI，再回来选择。' : missing ? '请先在这台机器上安装这个 AI，再检查安装结果。' : network ? '请检查这台机器是否能连接这个 AI 的服务。' : '请更新这台机器上的节点服务，再检查是否支持这个 AI。'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}><Text selectable style={{ color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{command}</Text>
        <Pressable accessibilityRole="button" onPress={async () => { try { await Clipboard.setStringAsync(command); setCopy('已复制'); } catch { setCopy('复制失败'); } }}><Text style={{ color: colors.accent }}>{copy}</Text></Pressable></View>
      {reason && <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => showDetails(!details)}><Text style={muted}>查看详情</Text></Pressable>}
      {details && <Text selectable style={muted}>{reason}</Text>}</>}
  </View>;
}

export function UnavailableAi({ rows, daemon }: { rows: WizardRuntime[]; daemon: ReadinessInput }) {
  const [open, expand] = useState(false);
  if (!rows.length) return null;
  return <View><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => expand(!open)} style={{ paddingVertical: spacing.md }}>
    <Text style={{ color: colors.textSecondary }}>{`这台机器上暂时用不了 · ${rows.length}  ${open ? '⌃' : '⌄'}`}</Text>
  </Pressable>{open && rows.map(ai => <HelpRow key={ai.id} ai={ai} daemon={daemon} />)}</View>;
}
