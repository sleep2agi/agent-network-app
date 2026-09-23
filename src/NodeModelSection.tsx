// 节点详情页「模型」区:读 GET /api/nodes/:id/config,选一个建议模型或手输 id,
// 走 update_node_config(RFC-024)下发,然后轮询 config 直到 revision 抬高且
// model 命中,或 90 s 超时。状态机在 node-model-change.ts(纯,可测)。
//
// 样式约定同 NodeDetailScreen:`styles` 用 live binding、不解构;卡片
// colors.card / 12 圆角 / spacing.lg;按钮沿用 retryBtn。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { fetchNodeConfig, updateNodeConfig, type HubConfig, type HubNode, type NodeConfigRead } from './api';
import { styles } from './app-styles';
import {
  afterPoll,
  afterSubmit,
  catalogHint,
  modelChips,
  modelControlAvailability,
  phaseIsBusy,
  phaseText,
  RESTART_POLL_MS,
  validateModelId,
  type ModelChangePhase,
} from './node-model-change';
import { suggestedModels } from './runtime-catalog';
import { colors, spacing } from './theme';

export default function NodeModelSection({ cfg, node }: { cfg: HubConfig; node: HubNode }) {
  // undefined = 还没读到;null = hub 没有这个接口
  const [view, setView] = useState<NodeConfigRead | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [phase, setPhase] = useState<ModelChangePhase>({ kind: 'idle' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

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

  // 重启期间轮询;每次读回交给 afterPoll 判 applied / timeout。
  useEffect(() => {
    if (phase.kind !== 'restarting') return;
    const timer = setTimeout(async () => {
      const v = await reload();
      const current = phaseRef.current;
      if (current.kind !== 'restarting') return;
      setPhase(afterPoll(current, v ? { config_revision: v.config_revision, model: v.model, config_update_capable: v.config_update_capable } : null));
    }, RESTART_POLL_MS);
    return () => clearTimeout(timer);
  }, [phase, reload]);

  const availability = modelControlAvailability(view === undefined ? null : view);
  const busy = phaseIsBusy(phase);
  const suggestions = suggestedModels(node.runtime);
  const currentModel = view?.model ?? node.model ?? node.config_snapshot?.model ?? null;
  const candidate = custom.trim() ? custom : picked;
  const chips = modelChips(suggestions, currentModel);
  const hint = catalogHint(node.runtime);

  const submit = async () => {
    if (!view || busy) return;
    const v = validateModelId(candidate);
    if (!v.ok) { setPhase({ kind: 'error', message: v.reason }); return; }
    if (v.model === currentModel) { setPhase({ kind: 'error', message: '和当前模型相同,无需修改' }); return; }
    setPhase({ kind: 'submitting', requested: v.model });
    const res = await updateNodeConfig(cfg, { nodeId: node.node_id, baseRevision: view.config_revision, patch: { model: v.model } });
    const next = afterSubmit(v.model, view.config_revision, res);
    if (next.kind === 'conflict') void reload();
    setPhase(next);
  };

  return (
    <View style={{ paddingTop: spacing.xl }}>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm }}>模型</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.textMuted, width: 96, fontSize: 13 }}>当前模型</Text>
          <Text style={{ color: colors.text, flex: 1, fontSize: 14 }} selectable>
            {currentModel || (view === undefined && !readFailed ? '读取中…' : '—')}
          </Text>
        </View>
        {readFailed && view === undefined ? (
          <Text style={{ color: colors.failed, fontSize: 12 }}>读取节点配置失败。<Text style={{ color: colors.accent }} onPress={() => void reload()}>重试</Text></Text>
        ) : null}
        {view !== undefined && !availability.enabled ? (
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{availability.hint}</Text>
        ) : null}
        {availability.enabled ? (
          <>
            <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
              改模型不经过任何大模型:Hub 下发后节点自己写配置并重启一次(约 5–45 秒),期间它不接任务。
            </Text>
            {chips.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>建议</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {chips.map(m => {
                  const active = !custom.trim() && (picked ? picked === m : m === currentModel);
                  return (
                    <Pressable
                      key={m}
                      disabled={busy}
                      onPress={() => { setPicked(m); setCustom(''); }}
                      style={({ pressed }) => [
                        { borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.md, height: 34, justifyContent: 'center', borderColor: active ? colors.accent : colors.border, backgroundColor: colors.card },
                        pressed && { opacity: 0.7 },
                        busy && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={{ color: active ? colors.accent : colors.text, fontSize: 13 }}>{m}{m === currentModel ? '(当前)' : ''}</Text>
                    </Pressable>
                  );
                })}
                </View>
                {hint ? <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
              </View>
            ) : null}
            <TextInput
              value={custom}
              onChangeText={setCustom}
              editable={!busy}
              placeholder={suggestions.length > 0 ? '或手输模型 id(provider/model)' : '模型 id(provider/model)'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: spacing.md, height: 36, color: colors.text, fontSize: 13 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Pressable
                disabled={busy || !candidate}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.retryBtn, (busy || !candidate) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.retryBtnText}>{busy ? '处理中…' : '切换模型'}</Text>
              </Pressable>
              {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            </View>
          </>
        ) : null}
        {phase.kind !== 'idle' ? (
          <Text style={{ color: phase.kind === 'applied' ? colors.running : phase.kind === 'error' || phase.kind === 'timeout' || phase.kind === 'conflict' ? colors.failed : colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            {phaseText(phase)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
