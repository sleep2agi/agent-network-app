// admin 2026-11-24 —— 聊天里的「密钥」卡：AI 调 request_secret 后，这张卡代替那条兜底文字出现在回复气泡里。
// 保存 = 先读节点密钥拿 revision，再 put；成功后以用户身份发一句「已在卡片里保存 X」让 AI 继续。
// 值只在输入框状态和 put 参数里，不进消息、不进日志、不给 AI。
import { useEffect, useRef, useState } from 'react';
import type { HubConfig } from './api';
import { scopedSecrets } from './scoped-secrets-api';
import SecretRequestCard, { type SecretRequestPhase } from './SecretRequestCard';
import { secretSaveErrorText, secretSavedMessage, type ChatSecretRequest } from './chat-secret-request';

export default function ChatSecretCard({ cfg, request, alreadySaved, onSaved }: {
  cfg: HubConfig;
  request: ChatSecretRequest;
  /** 后面的消息里已经有「已保存」⇒ 直接显示已保存（重开聊天时）。 */
  alreadySaved: boolean;
  /** 保存成功：父级用正常发送路径发出这句话。 */
  onSaved: (message: string) => void;
}) {
  const [phase, setPhase] = useState<SecretRequestPhase>(alreadySaved ? 'saved' : 'idle');
  const [error, setError] = useState<string | undefined>();
  const live = useRef<AbortController | null>(null);
  useEffect(() => { if (alreadySaved) setPhase('saved'); }, [alreadySaved]);
  useEffect(() => () => live.current?.abort(), []);

  const save = async (value: string) => {
    if (phase === 'saving' || phase === 'saved' || !cfg.networkId) return;
    const ctrl = new AbortController(); live.current = ctrl;
    setPhase('saving'); setError(undefined);
    const scope = { networkId: cfg.networkId, daemonId: null, nodeId: request.nodeId };
    const listed = await scopedSecrets(cfg, scope, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (listed.kind !== 'ready') { setPhase('error'); setError(secretSaveErrorText(listed.kind)); return; }
    const put = await scopedSecrets(cfg, scope, ctrl.signal, { action: 'put', key: request.key, value, revision: listed.snapshot.revision });
    if (ctrl.signal.aborted) return;
    if (put.kind !== 'ready') { setPhase('error'); setError(secretSaveErrorText(put.kind)); return; }
    setPhase('saved');
    onSaved(secretSavedMessage(request));
  };

  return (
    <SecretRequestCard
      testID={`chat-secret-${request.key}`}
      bare
      request={{ key: request.key, ...(request.label ? { label: request.label } : {}), ...(request.hint ? { hint: request.hint } : {}) }}
      phase={phase}
      error={error}
      onSave={v => { void save(v); }}
    />
  );
}
