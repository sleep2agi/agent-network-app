// 节点「模型与运行时」—— Codex 思考程度 (flags.modelReasoningEffort, hot apply)。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';

import { fetchNodeConfig, updateNodeConfig, type HubConfig, type HubNode, type NodeConfigRead } from './api';
import { styles } from './app-styles';
import {
  CODEX_REASONING_EFFORTS,
  CODEX_REASONING_EFFORT_LABELS,
  type CodexReasoningEffort,
} from './codex-reasoning-effort';
import {
  afterPollReasoning,
  afterSubmit,
  currentReasoningEffort,
  phaseIsBusy,
  reasoningPhaseText,
  RESTART_POLL_MS,
  RESTART_TIMEOUT_MS,
  type ModelChangePhase,
} from './node-codex-reasoning';
import { modelControlAvailability } from './node-model-change';
import { colors, spacing, radius, type as typeScale, weight } from './theme';

export default function NodeCodexReasoningSection({ cfg, node }: { cfg: HubConfig; node: HubNode }) {
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
      const next = afterPollReasoning(current, v);
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
  const current = currentReasoningEffort(view === undefined ? null : view);

  const pick = async (effort: CodexReasoningEffort) => {
    if (!view || busy || effort === current) return;
    setPhase({ kind: 'submitting', requested: effort });
    const res = await updateNodeConfig(cfg, {
      nodeId: node.node_id,
      baseRevision: view.config_revision,
      patch: { flags: { modelReasoningEffort: effort } },
    });
    const next = afterSubmit(effort, view.config_revision, res);
    if (next.kind === 'conflict') void reload();
    setPhase(next);
  };

  return (
    <View style={{ paddingTop: spacing.xl }} testID="node-codex-reasoning-section">
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, marginBottom: spacing.sm }}>思考程度</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>
          作用于 Codex 节点（含 TUI 共存）的下一次回合；不经过大模型,由 Hub 下发到节点配置。
        </Text>
        {readFailed && view === undefined ? (
          <Text style={{ color: colors.failed, fontSize: typeScale.small }}>
            读取节点配置失败。<Text style={{ color: colors.accent }} onPress={() => void reload()}>重试</Text>
          </Text>
        ) : null}
        {!availability.enabled ? (
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{availability.hint}</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {CODEX_REASONING_EFFORTS.map(effort => {
              const active = effort === current;
              return (
                <Pressable
                  key={effort}
                  testID={`node-reasoning-effort-${effort}`}
                  disabled={busy}
                  onPress={() => void pick(effort)}
                  style={({ pressed }) => [
                    {
                      borderWidth: 1,
                      borderRadius: radius.control,
                      paddingHorizontal: spacing.md,
                      height: 34,
                      justifyContent: 'center',
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? colors.tonalBg : colors.card,
                    },
                    pressed && { opacity: 0.7 },
                    busy && { opacity: 0.5 },
                  ]}
                >
                  <Text style={{ color: active ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: active ? weight.strong : '400' }}>
                    {CODEX_REASONING_EFFORT_LABELS[effort]}{active ? '（当前）' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {busy ? <ActivityIndicator size="small" color={colors.accent} style={{ alignSelf: 'flex-start' }} /> : null}
        {phase.kind !== 'idle' ? (
          <Text
            testID="node-reasoning-phase"
            style={{
              color: phase.kind === 'applied' ? colors.running : phase.kind === 'error' || phase.kind === 'timeout' || phase.kind === 'conflict' ? colors.failed : colors.textMuted,
              fontSize: typeScale.small,
              lineHeight: 18,
            }}
          >
            {reasoningPhaseText(phase)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
