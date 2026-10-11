import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig, HubNode } from './api';
import { readManagedProviders } from './daemon-provider-management-api';
import { PROVIDER_VERIFIED_VERSIONS, type ProviderRead } from './daemon-provider-management';
import DaemonProviderSelection from './DaemonProviderSelection';
import { nodeProviderDaemon } from './node-provider-target';
import { colors, spacing } from './theme';

/** Node detail uses the same daemon catalog/application receipt as management. */
export default function NodeDaemonProviderSection({ cfg, node, onManageBinding }: {
  cfg: HubConfig; node: HubNode; onManageBinding: () => void;
}) {
  const daemonId = nodeProviderDaemon(node);
  const [tick, refresh] = useState(0);
  const identity = JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token, daemonId, node.node_id, tick]);
  const [result, setResult] = useState<{ identity: string; value: ProviderRead } | null>(null);
  useEffect(() => {
    if (!daemonId || !cfg.networkId) return;
    const ctrl = new AbortController();
    void readManagedProviders(cfg, daemonId, ctrl.signal).then(value => {
      if (!ctrl.signal.aborted) setResult({ identity, value });
    });
    return () => ctrl.abort();
  }, [identity]);
  const value = result?.identity === identity ? result.value : null;
  const snapshot = value?.kind === 'ready' ? value.snapshot : null;
  const observed = snapshot?.codex_inventory?.rows.find(row => row.node_id === node.node_id);
  return <View testID="node-daemon-provider" style={{ gap: spacing.md, marginTop: spacing.lg }}>
    <Text style={{ color: colors.text, fontWeight: '600' }}>Provider 与模型</Text>
    <Text style={{ color: colors.textSecondary }}>当前配置：{observed?.configured_provider ?? '未上报 Provider'} · {observed?.configured_model ?? node.model ?? '未上报模型'}</Text>
    {!daemonId ? <>
      <Text style={{ color: colors.textSecondary }}>此节点尚未绑定 Daemon。先在概览确认所属 Daemon，随后可在此选择 Provider 与模型；不会自动接管或复制登录账号。</Text>
      <Pressable testID="node-provider-manage-binding" accessibilityRole="button" onPress={onManageBinding}>
        <Text style={{ color: colors.accent }}>去概览绑定 Daemon ›</Text>
      </Pressable>
    </> : <>
      <Text style={{ color: colors.textSecondary }}>所属 Daemon：{daemonId}。仅切换当前节点，确认后由 Daemon 应用并回读。</Text>
      {!value ? <ActivityIndicator color={colors.accent} /> : null}
      {value && value.kind !== 'ready' ? <Text style={{ color: colors.textSecondary }}>Provider 目录未读到（{value.kind}）。请确认 Daemon 在线及版本；已验证版本：CLI {PROVIDER_VERIFIED_VERSIONS.cli} / runtime {PROVIDER_VERIFIED_VERSIONS.runtime} / Hub {PROVIDER_VERIFIED_VERSIONS.hub}。</Text> : null}
      {snapshot && !observed ? <Text style={{ color: colors.textSecondary }}>Daemon 尚未确认该节点的配置，暂不能提交切换。请刷新目录，核实绑定和 Daemon 状态。</Text> : null}
      {snapshot ? <DaemonProviderSelection cfg={cfg} identity={identity} snapshot={snapshot} nodeId={node.node_id} /> : null}
      <Pressable testID="node-provider-refresh" accessibilityRole="button" onPress={() => refresh(n => n + 1)}>
        <Text style={{ color: colors.accent }}>刷新 Provider 与节点配置</Text>
      </Pressable>
    </>}
  </View>;
}
