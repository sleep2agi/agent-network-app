// admin 2026-11-24 —— 聊天里的「密钥」卡：AI 调 request_secret 后，这张卡代替那条兜底文字出现在回复气泡里。
// #5675 PR-1 —— 消除自锁：保存成功后绝不先发唤醒消息把节点弄忙，也不再让用户点第二个「立即重启」按钮；
// 改为卡片直接提示「保存好了，节点空闲时自动生效」，自动排队到节点空闲后触发重启，生效后再发唤醒消息。
// 值只在输入框状态和 put 参数里，不进消息、不进日志、不给 AI。
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { fetchHubNodes, fetchNodeStatus, runNodeLifecycleAction, type HubConfig } from './api';
import { scopedSecrets } from './scoped-secrets-api';
import type { SecretActivation } from './scoped-secrets';
import SecretRequestCard, { type SecretRequestPhase } from './SecretRequestCard';
import { secretSaveErrorText, secretSavedMessage, selectChatSecretScopes, type ChatSecretRequest } from './chat-secret-request';
import {
  chatSecretApplyText,
  isChatSecretSavedLocally,
  markChatSecretSavedLocally,
  runChatSecretAutoApply,
  type ChatSecretApplyState,
} from './chat-secret-auto-apply';
import { Text } from './ui-text';
import { colors, type } from './theme';

export default function ChatSecretCard({ cfg, alias, request, alreadySaved, onSaved }: {
  cfg: HubConfig;
  alias?: string;
  request: ChatSecretRequest;
  /** 后面的消息里已经有「已保存」⇒ 直接显示已保存（重开聊天时）。 */
  alreadySaved: boolean;
  /** 重启生效后：父级用正常发送路径发出唤醒消息。 */
  onSaved: (message: string) => void;
}) {
  const scopeKey = `${cfg.serverUrl}|${cfg.networkId ?? ''}`;
  const initialSaved = alreadySaved || isChatSecretSavedLocally(scopeKey, request.nodeId, request.key);
  const [phase, setPhase] = useState<SecretRequestPhase>(initialSaved ? 'saved' : 'idle');
  const [error, setError] = useState<string | undefined>();
  const [applyState, setApplyState] = useState<ChatSecretApplyState>('idle');
  const live = useRef<AbortController | null>(null);
  const autoApplyCtrl = useRef<AbortController | null>(null);
  useEffect(() => { if (alreadySaved) setPhase('saved'); }, [alreadySaved]);
  useEffect(() => () => {
    live.current?.abort();
    autoApplyCtrl.current?.abort();
  }, []);

  const startAutoApply = (daemonId: string | null, activation?: SecretActivation) => {
    autoApplyCtrl.current?.abort();
    const ctrl = new AbortController();
    autoApplyCtrl.current = ctrl;
    void runChatSecretAutoApply({
      activation,
      signal: ctrl.signal,
      onState: setApplyState,
      restartNode: () => runNodeLifecycleAction(cfg, 'restart_node', {
        node_id: request.nodeId,
        alias: alias ?? '',
        ...(daemonId ? { lifecycle_daemon_node_id: daemonId } : {}),
      }),
      readNodeStatus: async () => {
        try {
          const { sessions } = await fetchNodeStatus(cfg, alias);
          const hit = (sessions ?? []).find(s => (s.node_id && s.node_id === request.nodeId) || (alias && s.alias === alias));
          if (!hit) return null;
          const inFlight = (hit as { process_in_flight_count?: unknown }).process_in_flight_count;
          return {
            status: hit.status,
            inFlightCount: typeof inFlight === 'number' ? inFlight : null,
          };
        } catch {
          return null;
        }
      },
      onApplied: () => onSaved(secretSavedMessage(request)),
    });
  };

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
        let activation: SecretActivation = put.snapshot.activation;
        // #5675 PR-3: Daemon 托管节点写进 scoped-secrets.json 后，Daemon 不改自身 env，
        // 若子节点在线且支持 node_secrets / hot activation，发一次只带 key 名的 reload 拿子节点的权威 activation。
        if (scope.daemonId !== null) {
          try {
            const { sessions } = await fetchNodeStatus(cfg, alias);
            const hit = (sessions ?? []).find(s => (s.node_id && s.node_id === request.nodeId) || (alias && s.alias === alias));
            if (hit && hit.status !== 'offline' && (hit.secrets_hot_capable === true || hit.node_secrets_capable === true)) {
              const reloaded = await scopedSecrets(
                cfg,
                { networkId: cfg.networkId, daemonId: null, nodeId: request.nodeId },
                ctrl.signal,
                { action: 'reload', key: request.key },
                { timeoutMs: 5000 },
              ).catch(() => null);
              if (reloaded && reloaded.kind === 'ready') {
                activation = reloaded.snapshot.activation;
              }
            }
          } catch { /* keep put.snapshot.activation fallback */ }
          if (ctrl.signal.aborted) return;
        }
        if (activation !== 'shadowed') {
          markChatSecretSavedLocally(scopeKey, request.nodeId, request.key);
        }
        setPhase('saved');
        startAutoApply(daemonId, activation);
        return;
      }
      lastErrorKind = put.kind;
      if (put.kind === 'forbidden' || put.kind === 'invalid') break;
    }
    setPhase('error');
    setError(secretSaveErrorText(lastErrorKind));
  };

  const statusText = chatSecretApplyText(applyState, alias);
  const statusColor = applyState === 'waiting_idle' || applyState === 'shadowed'
    ? colors.blocked
    : applyState === 'applied'
      ? colors.running
      : colors.textMuted;

  const savedFooter = statusText ? (
    <View style={{ gap: 4 }}>
      <Text testID={`chat-secret-${request.key}-apply-${applyState}`} style={{ color: statusColor, fontSize: type.small }}>
        {statusText}
      </Text>
    </View>
  ) : null;

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
