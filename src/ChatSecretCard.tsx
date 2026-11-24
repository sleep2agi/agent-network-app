// admin 2026-11-24 —— 聊天里的「密钥」卡：AI 调 request_secret 后，这张卡代替那条兜底文字出现在回复气泡里。
// 保存 = 先读节点密钥拿 revision，再 put；成功后以用户身份发一句「已在卡片里保存 X」让 AI 继续。
// 值只在输入框状态和 put 参数里，不进消息、不进日志、不给 AI。
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { fetchHubNodes, runNodeLifecycleAction, type HubConfig } from './api';
import { scopedSecrets } from './scoped-secrets-api';
import SecretRequestCard, { type SecretRequestPhase } from './SecretRequestCard';
import { secretSaveErrorText, secretSavedMessage, selectChatSecretScopes, type ChatSecretRequest } from './chat-secret-request';
import { manualRestartCommand } from './node-restart-after-secret';
import { Text } from './ui-text';
import { colors, radius, spacing, type, weight } from './theme';

export default function ChatSecretCard({ cfg, alias, request, alreadySaved, onSaved }: {
  cfg: HubConfig;
  alias?: string;
  request: ChatSecretRequest;
  /** 后面的消息里已经有「已保存」⇒ 直接显示已保存（重开聊天时）。 */
  alreadySaved: boolean;
  /** 保存成功：父级用正常发送路径发出这句话。 */
  onSaved: (message: string) => void;
}) {
  const [phase, setPhase] = useState<SecretRequestPhase>(alreadySaved ? 'saved' : 'idle');
  const [error, setError] = useState<string | undefined>();
  const [restartState, setRestartState] = useState<'idle' | 'restarting' | 'restarted' | 'busy' | 'manual'>('idle');
  const live = useRef<AbortController | null>(null);
  useEffect(() => { if (alreadySaved) setPhase('saved'); }, [alreadySaved]);
  useEffect(() => () => live.current?.abort(), []);

  const save = async (value: string) => {
    if (phase === 'saving' || phase === 'saved' || !cfg.networkId) return;
    const ctrl = new AbortController(); live.current = ctrl;
    setPhase('saving'); setError(undefined);
    let daemonId: string | null = null;
    try {
      const { nodes } = await fetchHubNodes(cfg);
      const hit = (nodes ?? []).find(n => n.node_id === request.nodeId);
      daemonId = hit?.lifecycle_daemon_node_id ?? null;
    } catch { /* fallback to independent node scope */ }
    if (ctrl.signal.aborted) return;

    const scopes = selectChatSecretScopes(cfg.networkId, request.nodeId, daemonId);
    let lastErrorKind = 'unconfirmed';
    for (const scope of scopes) {
      const listed = await scopedSecrets(cfg, scope, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (listed.kind !== 'ready') {
        lastErrorKind = listed.kind;
        if (listed.kind === 'forbidden' || listed.kind === 'invalid') break;
        continue;
      }
      const put = await scopedSecrets(cfg, scope, ctrl.signal, { action: 'put', key: request.key, value, revision: listed.snapshot.revision });
      if (ctrl.signal.aborted) return;
      if (put.kind === 'ready') {
        setPhase('saved');
        onSaved(secretSavedMessage(request));
        return;
      }
      lastErrorKind = put.kind;
      if (put.kind === 'forbidden' || put.kind === 'invalid') break;
    }
    setPhase('error');
    setError(secretSaveErrorText(lastErrorKind));
  };

  const restartNodeNow = async () => {
    if (restartState === 'restarting' || restartState === 'restarted') return;
    setRestartState('restarting');
    const r = await runNodeLifecycleAction(cfg, 'restart_node', { node_id: request.nodeId, alias: alias ?? '' });
    if (r.ok) { setRestartState('restarted'); return; }
    if (r.error === 'node_busy_in_flight') { setRestartState('busy'); return; }
    setRestartState('manual');
  };

  const savedFooter = (
    <View style={{ gap: 4 }}>
      {restartState === 'restarted' ? (
        <Text testID={`chat-secret-${request.key}-restarted`} style={{ color: colors.textMuted, fontSize: type.small }}>
          已下发重启指令，节点正在重启生效，稍后会重新上线。
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <Pressable
            testID={`chat-secret-${request.key}-restart`}
            accessibilityRole="button"
            disabled={restartState === 'restarting'}
            onPress={() => { void restartNodeNow(); }}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 5,
              borderRadius: radius.surface,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bg,
              opacity: restartState === 'restarting' ? 0.5 : 1,
            }}
          >
            <Text style={{ color: colors.accent, fontSize: type.small, fontWeight: weight.strong }}>
              {restartState === 'restarting' ? '正在下发重启…' : '立即重启使其生效'}
            </Text>
          </Pressable>
        </View>
      )}
      {restartState === 'busy' ? (
        <Text style={{ color: colors.blocked, fontSize: type.small }}>
          节点正在执行任务，暂未重启；完成后再点一次即可生效。
        </Text>
      ) : null}
      {restartState === 'manual' ? (
        <Text style={{ color: colors.textMuted, fontSize: type.small }}>
          该节点不支持远程重启，请手动执行：{manualRestartCommand(alias)}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SecretRequestCard
      testID={`chat-secret-${request.key}`}
      bare
      request={{ key: request.key, ...(request.label ? { label: request.label } : {}), ...(request.hint ? { hint: request.hint } : {}) }}
      phase={phase}
      error={error}
      savedFooter={savedFooter}
      onSave={v => { void save(v); }}
    />
  );
}
