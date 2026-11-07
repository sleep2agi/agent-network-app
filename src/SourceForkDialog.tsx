// #4150 受管 source 独立 fork（gated preview）对话框。
// 合同见 docs/runbooks/session-source-transport.md：只 managed source → independent fork，
// 404 = gate 未开放（不 fallback 普通创建），unknown 用同一 intent 重试、不新开意图。
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, TextInput } from './ui-text';
import DialogFrame from './DialogFrame';
import { getSessionSourceFork, postSessionSourceFork, type HubConfig } from './api';
import { canStartFork, classifyStatus, gateClosedMessage, newIntentId, validateSelection, type SourceForkReceipt } from './session-source-fork';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import { colors, spacing, type as typeScale } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
import { Pressable } from 'react-native';

export default function SourceForkDialog({
  cfg, sourceNodeId, networkId, sessionId: presetSession, onClose,
}: {
  cfg: HubConfig;
  sourceNodeId: string;
  networkId: string | null;
  sessionId: string | null;
  onClose: () => void;
}) {
  useTranslation();
  const [sessionId, setSessionId] = useState(presetSession ?? '');
  const [childName, setChildName] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SourceForkReceipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);

  // 轮询：同 request_id + 当前 network；unknown 不新开意图，只提示用同一 intent 重试
  useEffect(() => {
    if (!receipt || !networkId) return;
    const outcome = classifyStatus(receipt.status);
    // unknown 也要继续用 GET 收敛已知 request_id（不发 POST、不新开 intent）；
    // refused 是终态，停止轮询。
    if (outcome.kind !== 'progress' && outcome.kind !== 'unknown') return;
    let live = true;
    const timer = setInterval(async () => {
      const r = await getSessionSourceFork(cfg, receipt.requestId, networkId);
      if (!live) return;
      if (!r.ok) { setMessage(r.error); return; }
      setReceipt(r.receipt);
    }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [receipt, cfg, networkId]);

  const gate = canStartFork({
    hasPermission: true,
    networkId,
    session: sessionId && sourceNodeId ? { sessionId, nodeId: sourceNodeId } : null,
  });

  const submit = async () => {
    if (busy) return;
    const intent = intentId ?? newIntentId(`${sourceNodeId}_${sessionId}`);
    setIntentId(intent);
    const v = validateSelection({ networkId: networkId ?? '', sourceNodeId, sessionId, childName, intentId: intent });
    if (!v.ok) { setMessage(v.error); return; }
    setBusy(true); setMessage(null);
    const r = await postSessionSourceFork(cfg, {
      networkId: networkId as string, sourceNodeId, sessionId, childName, intentId: intent,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.unavailable) { setUnavailable(true); setMessage(gateClosedMessage()); return; }
      setMessage(r.conflict ? '与已有 fork 冲突（409）：请用原意图查看回执，不要新开' : r.error);
      return;
    }
    setReceipt(r.receipt);
  };

  const outcome = receipt ? classifyStatus(receipt.status) : null;

  return (
    <DialogFrame title={t('nodeClone.forkTitle')} closeLabel={t('nodeClone.cancel')} testID="source-fork-frame" onClose={onClose}>
      <View style={{ gap: spacing.sm }} testID="source-fork-dialog">
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} testID="source-fork-network">
          network: {networkId ?? '—'} · source node: {sourceNodeId}
        </Text>
        <TextInput
          testID="source-fork-session"
          value={sessionId}
          onChangeText={setSessionId}
          placeholder="ses_..."
        />
        <TextInput
          testID="source-fork-child-name"
          value={childName}
          onChangeText={setChildName}
          placeholder={t('nodeClone.childNamePlaceholder')}
        />
        <Pressable
          testID="source-fork-submit"
          disabled={busy || !gate.ok || unavailable}
          onPress={() => void submit()}
          style={buttonStyle('primary')}
        >
          <Text style={buttonTextStyle('primary')}>{busy ? '…' : t('nodeClone.forkAction')}</Text>
        </Pressable>
        {!gate.ok ? <Text testID="source-fork-gate" style={{ color: colors.textMuted, fontSize: typeScale.small }}>{gate.reason}</Text> : null}
        {message ? <Text testID="source-fork-message" style={{ color: colors.blocked, fontSize: typeScale.small }}>{message}</Text> : null}
        {receipt ? (
          <Text testID="source-fork-status" style={{ color: colors.text, fontSize: typeScale.small }}>
            {outcome?.kind === 'registration-receipt'
              ? `注册回执（非原生接受/存活）：${receipt.status}`
              : `状态：${receipt.status}${receipt.childSessionId ? ` · child ${receipt.childSessionId}` : ''}`}
          </Text>
        ) : null}
      </View>
    </DialogFrame>
  );
}
