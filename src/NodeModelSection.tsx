// 节点详情页「模型」区:读 GET /api/nodes/:id/config,选一个建议模型或手输 id,
// 走 update_node_config(RFC-024)下发,然后轮询 config 直到 revision 抬高且
// model 命中,或 90 s 超时。状态机在 node-model-change.ts(纯,可测)。
//
// 样式约定同 NodeDetailScreen:`styles` 用 live binding、不解构;卡片
// colors.card / 12 圆角 / spacing.lg;按钮沿用 retryBtn。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';

import { fetchHubNodes, fetchNodeConfig, pollOpenCodeCatalog, queueOpenCodeCatalog, updateNodeConfig, type HubConfig, type HubNode, type NodeConfigRead } from './api';
import { styles } from './app-styles';
import {
  afterPoll,
  afterSubmit,
  catalogHint,
  filterModels,
  modelNotOnMachineNote,
  groupCountLabel,
  providerGroupSummary,
  groupModelsByProvider,
  modelChips,
  modelControlAvailability,
  phaseIsBusy,
  phaseText,
  RESTART_POLL_MS,
  RESTART_TIMEOUT_MS,
  validateModelId,
  type ModelChangePhase,
} from './node-model-change';
import { suggestedModels } from './runtime-catalog';
import { catalogErrorText, isOpenCodeV2Node, modelIdsFromCatalog, reportedCatalogModels, reportsCatalogSince } from './opencode-v2-model-list';
import { nodeProviderDaemon } from './node-provider-target';
import { colors, spacing, radius } from './theme';

/**
 * #2293 —— 这台机器**自己上报**的模型清单（`GET /api/nodes` 的 `opencode_catalog`）。
 * 只在这条 daemon 中继链走不通时用：手工 `anet node start` 起的 opencode 节点没有
 * daemon 绑定，`read_opencode_catalog` 永远拿不到列表 → admin 只能手填。
 * 读失败/旧 Hub 一律返回 []（不编内置清单，不假装有）。
 */
async function reportedModelList(cfg: HubConfig, nodeId: string): Promise<string[]> {
  try {
    const { nodes } = await fetchHubNodes(cfg);
    return reportedCatalogModels((nodes ?? []).find(n => n.node_id === nodeId)?.opencode_catalog);
  } catch {
    return [];
  }
}

export default function NodeModelSection({ cfg, node, runtimeVersion }: { cfg: HubConfig; node: HubNode; runtimeVersion?: string | null }) {
  // undefined = 还没读到;null = hub 没有这个接口
  const [view, setView] = useState<NodeConfigRead | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [phase, setPhase] = useState<ModelChangePhase>({ kind: 'idle' });
  const v2 = isOpenCodeV2Node(node);
  const [v2Models, setV2Models] = useState<string[] | null>(null);
  const [v2Note, setV2Note] = useState('');

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

  useEffect(() => {
    if (!v2) return;
    let live = true;
    const daemonId = nodeProviderDaemon(node);
    // 中继链失败/走不通时的兜底：改读这台机器自己上报的清单（#2293）。
    const fallback = async (reason: string) => {
      const ids = await reportedModelList(cfg, node.node_id);
      if (!live) return;
      setV2Models(ids);
      if (ids.length) { setV2Note(`${reason}改用这台机器上次上报的 OpenCode 模型清单。`); return; }
      // #2293 —— 空列表时区分「版本太旧不会上报」和「真的还没上报」：
      // 前者给出可执行的升级提示（TMAI欧 / TMAI文档欧 跑的就是 .146），后者仍是“等一等/手输”。
      const fresh = reportsCatalogSince(runtimeVersion);
      setV2Note(fresh === false
        ? `${reason}这台节点的 agent-node ${runtimeVersion} 不会自动上报模型清单（需 ≥ 2.5.0-preview.160，升级后 3 分钟内生效）—— 现在仍可手输 provider/model。`
        : `${reason}这台机器也还没上报过模型清单 —— 仍可手输 provider/model。`);
    };
    if (!daemonId) {
      setV2Note('这个节点没有所属 daemon，正在读它自己上报的模型清单…');
      void fallback('');
      return;
    }
    setV2Note('正在从 OpenCode V2 服务器读取模型列表…');
    void (async () => {
      const queued = await queueOpenCodeCatalog(cfg, { nodeId: node.node_id, daemonNodeId: daemonId });
      if (!live) return;
      if (!queued.ok) { void fallback(catalogErrorText(queued.error)); return; }
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!live) return;
        const polled = await pollOpenCodeCatalog(cfg, queued.request_id);
        if (!live) return;
        if (!polled.ok) { void fallback(catalogErrorText(polled.error)); return; }
        if (polled.status === 'ready') {
          const ids = modelIdsFromCatalog(polled.snapshot);
          setV2Models(ids);
          setV2Note(ids.length ? '列表来自这台机器上的 OpenCode V2 服务器，不是内置清单。' : 'OpenCode 服务器返回了空列表。仍可手输 provider/model。');
          return;
        }
      }
      if (live) void fallback('OpenCode 服务器还没返回模型列表。');
    })();
    return () => { live = false; };
  }, [v2, cfg, node.node_id, node.lifecycle_daemon_node_id, node.adoption?.daemon_node_id, node.adoption?.status]);

  const requested = phase.kind === 'restarting' ? phase.requested : null;
  const baseRevision = phase.kind === 'restarting' ? phase.baseRevision : null;
  // One observation window per accepted change, independent of read latency.
  // Expiry/cleanup invalidates in-flight reads; it never cancels or resubmits
  // the server-side change. Poll counts must not reset the deadline.
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
      if (Date.now() >= deadline) { expire(); return; }
      if (!failed) setView(v);
      setReadFailed(failed);
      const next = afterPoll(current, v);
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

  // V2 共存节点上纯 model 是 hot 变更:不受 config_update_capable 限制(它只挡重启级).
  const availability = modelControlAvailability(view === undefined ? null : view, { hotModel: v2 });
  const busy = phaseIsBusy(phase);
  // 机器上报了 V2 目录就用它;没上报(常见:刚接入/还没轮询到)就退回内置候选,
  // 否则「建议」里只剩「当前」那一个 chip,用户会以为没法切换(admin 2026-11-01 截图)。
  const v2Catalog = v2Models ?? [];
  const suggestions = v2 && v2Catalog.length > 0 ? v2Catalog : suggestedModels(node.runtime);
  const usingBuiltinFallback = v2 && v2Catalog.length === 0;
  const currentModel = view?.model ?? node.model ?? node.config_snapshot?.model ?? null;
  const candidate = custom.trim() ? custom : picked;
  const chips = modelChips(suggestions, currentModel);
  // 目录大的时候(OpenCodeV2 常有几十个模型)一屏放不下,加一个筛选框;列表短就不出现,免得喧宾夺主。
  const [filter, setFilter] = useState('');
  const shownChips = filterModels(chips, filter);
  const showFilter = chips.length >= 8;
  const hint = v2
    ? (usingBuiltinFallback ? '这台机器还没上报模型清单，下面是内置候选（可能滞后于实际可用模型）。' : v2Note)
    : catalogHint(node.runtime);
  // 只在 V2 目录**读到了**的时候才谈「不在列表里」:目录为空/读不到 ⇒ 不知道,不乱报。
  const notOnMachine = v2 && (v2Models?.length ?? 0) > 0 ? modelNotOnMachineNote(currentModel, v2Models ?? []) : null;

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
      <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }}>
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
            {v2 && hint ? <Text testID="opencode-v2-models-note" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
            {notOnMachine ? (
              <Text testID="model-not-on-machine" style={{ color: colors.blocked, fontSize: 12, lineHeight: 18 }}>{notOnMachine}</Text>
            ) : null}
            {/* 当前 Provider / 模型单独一行:分组展示后,"我现在在哪个 provider 下"不该靠 chip 上的小字去找。 */}
            <Text style={{ color: colors.textSecondary, fontSize: 12 }} testID="node-model-current"
              onPress={() => { const cur = (currentModel ?? '').trim(); if (cur) void import('expo-clipboard').then(m => m.setStringAsync(cur)).catch(() => undefined); }}>
              当前：{(() => {
                const cur = (currentModel ?? '').trim();
                if (!cur) return '未设置';
                const slash = cur.indexOf('/');
                return slash > 0 ? `${cur.slice(0, slash)} / ${cur.slice(slash + 1)}` : cur;
              })()}
            </Text>

            {chips.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>建议</Text>
                  {showFilter ? (
                    <TextInput
                      value={filter}
                      onChangeText={setFilter}
                      editable={!busy}
                      placeholder="筛选（provider 或模型名）"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="node-model-filter"
                      style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 30, color: colors.text, fontSize: 12 }}
                    />
                  ) : null}
                  {showFilter && filter.trim() ? (
                    <Text style={{ color: colors.accent, fontSize: 12 }} onPress={() => setFilter('')} testID="node-model-filter-clear">清除</Text>
                  ) : null}
                </View>
                {showFilter && shownChips.length === 0 ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="node-model-filter-empty">没有匹配「{filter.trim()}」的模型;清掉筛选,或在下面直接手输模型 id。</Text>
                ) : null}
                {providerGroupSummary(groupModelsByProvider(shownChips)) ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="node-model-group-summary">
                    {providerGroupSummary(groupModelsByProvider(shownChips))}
                  </Text>
                ) : null}
                {groupModelsByProvider(shownChips).map(g => (
                  <View key={g.provider} style={{ gap: 4 }} testID={`node-model-provider-${g.provider}`}>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{groupCountLabel(g)}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {g.models.map(m => {
                  const active = !custom.trim() && (picked ? picked === m : m === currentModel);
                  return (
                    <Pressable
                      key={m}
                      disabled={busy}
                      onPress={() => { setPicked(m); setCustom(''); }}
                      style={({ pressed }) => [
                        { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 34, justifyContent: 'center', borderColor: active ? colors.accent : colors.border, backgroundColor: colors.card },
                        pressed && { opacity: 0.7 },
                        busy && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={{ color: active ? colors.accent : colors.text, fontSize: 13 }}>{m}{m === currentModel ? '(当前)' : ''}</Text>
                    </Pressable>
                  );
                })}
                    </View>
                  </View>
                ))}
                {!v2 && hint ? <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
              </View>
            ) : null}
            <TextInput
              value={custom.trim() ? custom : picked}
              onChangeText={(text) => { setCustom(text); if (picked) setPicked(''); }}
              editable={!busy}
              placeholder={suggestions.length > 0 ? '或手输模型 id(provider/model)' : '模型 id(provider/model)'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 36, color: colors.text, fontSize: 13 }}
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
