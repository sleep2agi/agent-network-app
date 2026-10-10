// 节点「模型与运行时」—— Codex 自动执行 / 不弹确认 (flags yolo 三件套, hot/restart 由 hub 定)。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';

import { fetchNodeConfig, updateNodeConfig, type HubConfig, type HubNode, type NodeConfigRead } from './api';
import { CODEX_AUTO_EXECUTE_DEFAULT } from './codex-execution-posture';
import {
  afterPollAutoExecute,
  afterSubmit,
  currentCodexAutoExecute,
  executionPhaseText,
  patchFlagsForAutoExecute,
  phaseIsBusy,
  RESTART_POLL_MS,
  RESTART_TIMEOUT_MS,
  type ModelChangePhase,
} from './node-codex-execution';
import { modelControlAvailability } from './node-model-change';
import { colors, spacing, radius, type as typeScale, weight } from './theme';

export default function NodeCodexExecutionSection({ cfg, node }: { cfg: HubConfig; node: HubNode }) {
  const [view, setView] = useState<NodeConfigRead | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [phase, setPhase] = useState<ModelChangePhase>({ kind: 'idle' });

  const reload = useCallback(async () => {
    try {
      const v = await fetchNodeConfig(cfg, node.node_id);
      setView(v);
      setReadFailed(false);
      return v;
    } catch {
      setReadFailed(true);
      return null;
    }
  }, [cfg, node.node_id]);

  useEffect(() => { void reload(); }, [reload]);

  const requested = phase.kind === 'restarting' ? phase.requested : null;
  const baseRevision = phase.kind === 'restarting' ? phase.baseRevision : null;

  useEffect(() => {
    if (requested === null || baseRevision === null) return;
    let active = true;
    let current: Extract<ModelChangePhase, { kind: 'restarting' }> = { kind: 'restarting', requested, baseRevision, polls: 0 };
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    const expire = () => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      setPhase({ kind: 'timeout', requested });
    };
    const deadlineTimer = setTimeout(expire, RESTART_TIMEOUT_MS);
    const tick = async () => {
      if (!active) return;
      if (Date.now() >= deadline) { expire(); return; }
      let v: NodeConfigRead | null = null;
      let failed = false;
      try { v = await fetchNodeConfig(cfg, node.node_id); } catch { failed = true; }
      if (!active) return;
      if (!failed) setView(v);
      setReadFailed(failed);
      const next = afterPollAutoExecute(current, v);
      setPhase(next);
      if (next.kind === 'restarting') {
        current = next;
        timer = setTimeout(tick, RESTART_POLL_MS);
      } else {
        active = false;
        clearTimeout(deadlineTimer);
      }
    };
    timer = setTimeout(tick, RESTART_POLL_MS);
    return () => { active = false; clearTimeout(timer); clearTimeout(deadlineTimer); };
  }, [requested, baseRevision, cfg, node.node_id]);

  const availability = modelControlAvailability(view === undefined ? null : view);
  const busy = phaseIsBusy(phase);
  const active = view === undefined ? CODEX_AUTO_EXECUTE_DEFAULT : currentCodexAutoExecute(view);

  const toggle = async (next: boolean) => {
    if (!view || busy || next === active) return;
    const token = next ? 'on' : 'off';
    setPhase({ kind: 'submitting', requested: token });
    const res = await updateNodeConfig(cfg, {
      nodeId: node.node_id,
      baseRevision: view.config_revision,
      patch: { flags: patchFlagsForAutoExecute(next) },
    });
    const submitted = afterSubmit(token, view.config_revision, res);
    if (submitted.kind === 'conflict') void reload();
    setPhase(submitted);
  };

  return (
    <View style={{ paddingTop: spacing.xl }} testID="node-codex-execution-section">
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, marginBottom: spacing.sm }}>执行权限</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>
          与本地 `anet node create` 默认一致:最高沙箱权限、不弹 yes 确认。Codex TUI 共存还需 Hub 记住
          copresence 全权限(创建时默认开启)。
        </Text>
        {readFailed && view === undefined ? (
          <Text style={{ color: colors.failed, fontSize: typeScale.small }}>
            读取节点配置失败。<Text style={{ color: colors.accent }} onPress={() => void reload()}>重试</Text>
          </Text>
        ) : null}
        {!availability.enabled ? (
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{availability.hint}</Text>
        ) : (
          <Pressable
            testID="node-codex-auto-execute-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: active, disabled: busy }}
            disabled={busy}
            onPress={() => void toggle(!active)}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                borderWidth: 1,
                borderRadius: radius.control,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.tonalBg : colors.card,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              },
              pressed && { opacity: 0.7 },
              busy && { opacity: 0.5 },
            ]}
          >
            <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>
              自动执行（不弹确认）
            </Text>
            <Text style={{ color: active ? colors.running : colors.textMuted, fontSize: typeScale.small }}>
              {active ? '开' : '关'}
            </Text>
          </Pressable>
        )}
        {busy ? <ActivityIndicator size="small" color={colors.accent} style={{ alignSelf: 'flex-start' }} /> : null}
        {phase.kind !== 'idle' ? (
          <Text
            testID="node-codex-execution-phase"
            style={{
              color: phase.kind === 'applied' ? colors.running : phase.kind === 'error' || phase.kind === 'timeout' || phase.kind === 'conflict' ? colors.failed : colors.textMuted,
              fontSize: typeScale.small,
              lineHeight: 18,
            }}
          >
            {executionPhaseText(phase)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
