// 节点运行时（runtime）切换 —— 「进阶」位置的一块独立卡片。
//
// admin 2026-11-21：运行时只能 `anet node edit --runtime` 换。负责人要求：
//   · 放在「更多选项 / 进阶」，别和常规模型切换混在一起（防误触）；
//   · 候选来自已知清单（RUNTIME_GUIDE），允许任意输入，不声称完整；
//   · 文案必须写「需要重启生效」「换运行时可能需要重新配置认证」；
//   · 只写配置 + 回读配置，不声称运行时已经切过去。
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { fetchNodeConfig, updateNodeConfig, type HubConfig, type HubNode } from './api';
import { patchForRuntime, runtimeLoginHint, runtimeOptions, runtimeSwitchErrorText, validateRuntimeSwitch } from './node-runtime-switch';
import { styles } from './app-styles';
import { colors, radius, spacing } from './theme';

export default function NodeRuntimeSwitchCard(props: { cfg: HubConfig; node: HubNode; onChanged?: () => void }) {
  const { cfg, node, onChanged } = props;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(node.runtime ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const options = runtimeOptions();
  const current = String(node.runtime ?? '').trim();

  const save = async () => {
    if (busy) return;
    const checked = validateRuntimeSwitch(draft, current);
    if (!checked.ok) { setError(runtimeSwitchErrorText(checked.reason)); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const read = await fetchNodeConfig(cfg, node.node_id);
      if (!read) { setError('读不到节点配置，先重试一次。'); return; }
      const res = await updateNodeConfig(cfg, { nodeId: node.node_id, baseRevision: read.config_revision, patch: patchForRuntime(checked.value) });
      if (!res.ok) { setError(res.error); return; }
      // 只确认配置写进去了；运行时要重启后才真的换（认证也可能要重配）。
      const after = await fetchNodeConfig(cfg, node.node_id);
      if (after && String(after.runtime ?? '').trim() !== checked.value) {
        setError(`配置回读与写入不一致（期望 ${checked.value}），请重试。`);
        return;
      }
      setNotice(`已写入节点配置：${checked.value}。需要重启节点才生效；换运行时可能需要重新配置认证。`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: spacing.md }} testID="node-runtime-advanced">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => { setOpen(v => !v); setError(null); setNotice(null); }}
        testID="node-runtime-advanced-toggle"
      >
        <Text style={{ color: colors.accent, fontSize: 12 }}>
          {open ? '收起进阶：切换运行时' : '进阶：切换运行时（需要重启）'}
        </Text>
      </Pressable>
      {open ? (
        <View style={[styles.card, { marginTop: spacing.sm, padding: spacing.md, gap: spacing.sm }]} testID="node-runtime-advanced-card">
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            当前运行时：{current || '未知'}。这里只写节点配置，不会立刻切换；换运行时可能需要重新配置认证
            （例如 ACP 系列要重新登录），重启后以节点自报为准。
          </Text>
          <TextInput
            testID="node-runtime-input"
            value={draft}
            onChangeText={text => { setDraft(text); setError(null); setNotice(null); }}
            placeholder={current || 'runtime id（例如 antigravity-acp）'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
          />
          {runtimeLoginHint(draft) ? (
            <Text testID="node-runtime-login-hint" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
              这个运行时的登录命令：<Text selectable style={{ color: colors.textSecondary }}>{runtimeLoginHint(draft)}</Text>（换过去之后可能要在这台机器上重新登录）
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {options.map(option => (
              <Pressable key={option.id} testID={`node-runtime-option-${option.id}`} accessibilityRole="button" onPress={() => { setDraft(option.id); setError(null); setNotice(null); }}>
                <Text style={{ color: colors.textMuted, fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.inputBg, borderRadius: radius.item }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Pressable testID="node-runtime-save" accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} onPress={() => { void save(); }}>
              <Text style={{ color: colors.accent, fontSize: 12 }}>{busy ? '保存中…' : '写入节点配置'}</Text>
            </Pressable>
            {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
          </View>
          {error ? <Text testID="node-runtime-error" style={{ color: colors.failed, fontSize: 12 }}>{error}</Text> : null}
          {notice ? <Text testID="node-runtime-notice" style={{ color: colors.textMuted, fontSize: 12 }}>{notice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
