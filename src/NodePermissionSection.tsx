// 节点页「权限」分区(board #489,Hub RFC-041 第一阶段):正常 / 只读 / 受限,外加「过去 7 天本来会拦下 N 次」。
//
// 两套布局(node-permission-model.ts permissionLayout):
//   桌面  一行三段的分段控件 + 下面一句选中项的说明;
//   手机  三张竖排的选项卡(单选圆点 + 名字 + 一句说明),整张卡可点,高度 ≥ 64。
// 谁能看到这个分区由 Hub 决定(viewer_can.permission_mode),这里不再判权限。
// 改了立刻 PUT;失败回到原来的选项并说明原因。报表只有网络 owner / admin 读得到(别人 403 ⇒ 不显示那一行)。
//
// 样式约定同 NodeModelSection:colors 用 live binding、不解构;卡片 colors.card / radius.surface / spacing.lg。
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';

import { fetchNodePermissionReport, putNodePermissionMode, type HubConfig, type HubNode } from './api';
import { Ionicons } from './icons';
import {
  NODE_PERMISSION_OPTIONS,
  normalizeMode,
  optionFor,
  permissionLayout,
  reportFootnote,
  reportHeadline,
  saveErrorText,
  shouldSubmit,
  summarizeReport,
  type NodePermissionMode,
  type ReportSummary,
} from './node-permission-model';
import { colors, radius, spacing, type as typeScale, weight } from './theme';

export default function NodePermissionSection({ cfg, node, compact, onChanged }: {
  cfg: HubConfig;
  node: HubNode;
  compact: boolean;
  onChanged?: (mode: NodePermissionMode) => void;
}) {
  const [mode, setMode] = useState<NodePermissionMode>(normalizeMode(node.permission_mode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  // undefined = 读取中;null = 读不到(不是 owner / admin,或旧 Hub)⇒ 不显示报表行
  const [report, setReport] = useState<ReportSummary | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => { setMode(normalizeMode(node.permission_mode)); }, [node.node_id, node.permission_mode]);
  useEffect(() => {
    let alive = true;
    void fetchNodePermissionReport(cfg).then(r => { if (alive) setReport(summarizeReport(r, node.node_id)); });
    return () => { alive = false; };
  }, [cfg, node.node_id]);

  const pick = async (next: NodePermissionMode) => {
    if (!shouldSubmit(mode, next, busy)) return;
    const previous = mode;
    setMode(next);
    setBusy(true);
    setError('');
    setSavedNote('');
    const res = await putNodePermissionMode(cfg, node.node_id, next);
    setBusy(false);
    if (!res.ok) {
      setMode(previous);
      setError(saveErrorText(res));
      return;
    }
    setSavedNote(`已改为「${optionFor(next).label}」，立即生效`);
    onChanged?.(next);
  };

  const layout = permissionLayout(compact);
  const selected = optionFor(mode);

  return (
    <View style={{ paddingTop: spacing.xl, gap: spacing.md }} testID="node-perm-section">
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>
        这个节点能做什么。它不会超出你自己的权限；改了马上生效。
      </Text>

      {layout === 'segmented' ? (
        <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }} testID="node-perm-segmented">
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, overflow: 'hidden', alignSelf: 'flex-start' }}>
            {NODE_PERMISSION_OPTIONS.map((o, i) => {
              const active = o.mode === mode;
              return (
                <Pressable
                  key={o.mode}
                  testID={`node-perm-option-${o.mode}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: busy }}
                  aria-checked={active}
                  accessibilityLabel={`${o.label}：${o.summary}`}
                  disabled={busy}
                  onPress={() => void pick(o.mode)}
                  style={({ pressed }) => [
                    { minWidth: 96, height: 36, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.accent : colors.card },
                    i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border },
                    pressed && !active && { backgroundColor: colors.rowHover },
                  ]}
                >
                  <Text style={{ color: active ? colors.onAccent : colors.text, fontSize: typeScale.body, fontWeight: active ? weight.strong : weight.regular }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: colors.text, fontSize: typeScale.body, lineHeight: 20 }} testID="node-perm-summary">{selected.summary}</Text>
        </View>
      ) : (
        <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }} testID="node-perm-cards">
          {NODE_PERMISSION_OPTIONS.map(o => {
            const active = o.mode === mode;
            return (
              <Pressable
                key={o.mode}
                testID={`node-perm-option-${o.mode}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: busy }}
                  aria-checked={active}
                accessibilityLabel={`${o.label}：${o.summary}`}
                disabled={busy}
                onPress={() => void pick(o.mode)}
                style={({ pressed }) => [
                  { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.card, borderRadius: radius.surface, borderWidth: 1, borderColor: active ? colors.accent : colors.card },
                  pressed && { backgroundColor: colors.rowHover },
                ]}
              >
                <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: active ? colors.accent : colors.textMuted, alignItems: 'center', justifyContent: 'center' }}>
                  {active ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent }} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{o.label}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }} testID={`node-perm-option-${o.mode}-summary`}>{o.summary}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      {error ? <Text style={{ color: colors.failed, fontSize: typeScale.small }} testID="node-perm-error">{error}</Text> : null}
      {savedNote && !error ? <Text style={{ color: colors.running, fontSize: typeScale.small }} testID="node-perm-saved">{savedNote}</Text> : null}

      {report ? (
        <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden' }}>
          <Pressable
            testID="node-perm-report"
            accessibilityRole="button"
            accessibilityState={{ expanded: open, disabled: report.total === 0 }}
            disabled={report.total === 0}
            onPress={() => setOpen(v => !v)}
            style={({ pressed }) => [{ minHeight: compact ? 52 : 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.rowHover }]}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={report.total > 0 ? colors.accent : colors.textMuted} />
            <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} testID="node-perm-report-headline">{reportHeadline(report)}</Text>
            {report.total > 0 ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} /> : null}
          </Pressable>
          {open && report.total > 0 ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }} testID="node-perm-report-detail">
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>按原因</Text>
                {report.byReason.map(r => (
                  <View key={r.reason} style={{ flexDirection: 'row', gap: spacing.md }} testID={`node-perm-reason-${r.reason}`}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small, lineHeight: 18 }}>{r.label}</Text>
                    <Text style={{ color: colors.text, fontSize: typeScale.small, fontWeight: weight.strong }}>{r.hits} 次</Text>
                  </View>
                ))}
              </View>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>按操作</Text>
                {report.byRoute.map(r => (
                  <View key={`${r.route}|${r.reason}`} style={{ flexDirection: 'row', gap: spacing.md }} testID="node-perm-route">
                    <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small, lineHeight: 18 }} numberOfLines={2}>{r.label}</Text>
                    <Text style={{ color: colors.text, fontSize: typeScale.small, fontWeight: weight.strong }}>{r.hits} 次</Text>
                  </View>
                ))}
              </View>
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="node-perm-report-footnote">{reportFootnote(report)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
