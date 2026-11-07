// #4150 受管 source 独立 fork（gated preview）对话框。
// 合同见 docs/runbooks/session-source-transport.md：只 managed source → independent fork，
// 404 = gate 未开放（不 fallback 普通创建），unknown 用同一 intent 重试、不新开意图。
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text, TextInput } from './ui-text';
import DialogFrame from './DialogFrame';
import { getSourceDirectory, getSessionSourceFork, postSourceDirectory, postSessionSourceFork, type HubConfig } from './api';
import { canStartFork, classifyStatus, gateClosedMessage, newIntentId, validateSelection, type SourceForkReceipt } from './session-source-fork';
import { gateClosedDirectoryMessage, sessionBadge, type DirectorySnapshot } from './session-source-directory';
import { canUseSnapshotForNewSession, classifyProjectCreate, projectCreateLabel } from './session-project-create';
import { getSourceProjectCreate, postSourceProjectCreate } from './api';
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
  // #46bf69cd 目录只读：只展示，不提供 attach/fork 入口；oses_ 不可当 fork session。
  // #4150 新会话（现有项目）：只读目录里选项目 → 提交；旧快照（无 selection_expires_at）不给入口
  const receiptScopeRef = useRef<string | null>(null);   // 选过 Server 的那次 directory 请求 id（selection_scope 来源）
  const [projectPick, setProjectPick] = useState<string | null>(null);
  // attach 分支：目录里的 opaque session（oses_）；与 project 互斥
  const [attachPick, setAttachPick] = useState<string | null>(null);
  const [projectIntent, setProjectIntent] = useState<string>('');
  const [projectState, setProjectState] = useState<{ kind: 'idle' | 'busy' | 'submitted' | 'failed'; message?: string }>({ kind: 'idle' });
  const [dirState, setDirState] = useState<{ kind: 'idle' | 'pending' | 'ready' | 'failed' | 'unavailable' | 'denied'; error?: string; snapshot?: DirectorySnapshot }>({ kind: 'idle' });

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

  // 打开对话框即拉一次目录（只读）；不 attach、不写。
  useEffect(() => {
    if (!networkId || !sourceNodeId) return;
    let live = true;
    let requestId: string | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const daemonNodeId = sourceNodeId; // 目录请求要求 daemon node；这里用当前节点（无 daemon 绑定则不猜）
      const posted = await postSourceDirectory(cfg, { networkId, sourceNodeId, daemonNodeId });
      if (!live) return;
      if (!posted.ok) { setDirState({ kind: posted.unavailable ? 'unavailable' : posted.denied ? 'denied' : 'failed', error: posted.unavailable ? gateClosedDirectoryMessage() : posted.error }); return; }
      requestId = posted.requestId;
      setDirState({ kind: 'pending' });
      timer = setInterval(async () => {
        if (!requestId) return;
        const r = await getSourceDirectory(cfg, requestId, networkId);
        if (!live) return;
        if (r.kind === 'ready') {
          setDirState({ kind: 'ready', snapshot: r.snapshot });
          if (timer) clearInterval(timer);
          // 合同：selection_scope 必须是「选过 Server 并返回 projects」的请求；单 Server 时自动选它
          const servers = r.snapshot.servers ?? [];
          if (servers.length === 1 && networkId) {
            // 合同：第二次 POST 必须带 server_id（selection_scope 来自「返回 projects」的那次请求）
            const sel = await postSourceDirectory(cfg, { networkId, sourceNodeId, daemonNodeId: sourceNodeId }, servers[0].serverId, requestId ?? undefined);
            if (live && sel.ok) receiptScopeRef.current = sel.requestId;
          }
        }
        else if (r.kind === 'failed' || r.kind === 'unavailable' || r.kind === 'denied') { setDirState({ kind: r.kind as any, error: r.kind === 'unavailable' ? gateClosedDirectoryMessage() : r.error }); if (timer) clearInterval(timer); }
      }, 1500);
    })();
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [cfg, networkId, sourceNodeId]);

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
        {/* #46bf69cd 只读目录：仅展示；不提供 attach/fork 按钮，oses_ 不可当 fork session */}
        <View testID="source-directory-section" style={{ gap: 4 }}>
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>现有 Server / 项目 / Session（只读）</Text>
          {dirState.kind === 'unavailable' ? (
            <Text testID="source-directory-unavailable" style={{ color: colors.textMuted, fontSize: typeScale.small }}>{dirState.error}</Text>
          ) : dirState.kind === 'failed' || dirState.kind === 'denied' ? (
            <Text testID="source-directory-failed" style={{ color: colors.blocked, fontSize: typeScale.small }}>目录读取失败：{dirState.error}</Text>
          ) : dirState.kind === 'ready' && dirState.snapshot ? (
            <>
              {dirState.snapshot.servers.map(sv => (
                <Text key={sv.serverId} testID={`source-directory-server-${sv.serverId}`} style={{ color: colors.text, fontSize: typeScale.small }} numberOfLines={1}>
                  Server：{sv.title || sv.serverId}
                </Text>
              ))}
              {dirState.snapshot.sessions.slice(0, 8).map(ses => (
                <Text key={ses.sessionId} testID={`source-directory-session-${ses.sessionId}`} style={{ color: colors.textMuted, fontSize: typeScale.small }} numberOfLines={2}>
                  {ses.title || ses.sessionId} · {sessionBadge(ses)}
                </Text>
              ))}
              {dirState.snapshot.sessions.length === 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>目录为空（授权范围内没有 Session）</Text>
              ) : null}
            </>
          ) : (
            <Text testID="source-directory-pending" style={{ color: colors.textMuted, fontSize: typeScale.small }}>读取中…</Text>
          )}
        </View>
        {/* #4150 新会话：从只读目录里选项目 → 提交（不是 fork、不 attach；oses_ 不参与） */}
        {dirState.kind === 'ready' && dirState.snapshot ? (() => {
          const usable = canUseSnapshotForNewSession({
            snapshot: { expiresAt: dirState.snapshot.expiresAt, selectionExpiresAt: dirState.snapshot.selectionExpiresAt },
            hasProjectCreateCapability: true,
          });
          if (!usable.ok) {
            return (
              <View testID="project-create-section">
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>新建会话：{usable.reason}</Text>
              </View>
            );
          }
          return (
            <View testID="project-create-section" style={{ gap: 4 }}>
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>新建会话（现有项目，只读选择）</Text>
              {dirState.snapshot.projects.slice(0, 6).map(pj => (
                <Pressable key={pj.projectId} testID={`project-create-pick-${pj.projectId}`} onPress={() => { setProjectPick(pj.projectId); setAttachPick(null); }}>
                  <Text style={{ fontSize: typeScale.small, color: pj.projectId === projectPick ? colors.accent : colors.text }} numberOfLines={1}>
                    {pj.title || pj.projectId}{pj.projectId === projectPick ? '（已选）' : ''}
                  </Text>
                </Pressable>
              ))}
              {(dirState.snapshot.sessions ?? []).slice(0, 4).map(ses => (
                <Pressable key={ses.sessionId} testID={`project-create-attach-${ses.sessionId}`} onPress={() => { setAttachPick(ses.sessionId); setProjectPick(null); }}>
                  <Text style={{ fontSize: typeScale.small, color: ses.sessionId === attachPick ? colors.accent : colors.textMuted }} numberOfLines={1}>
                    attach：{ses.title || ses.sessionId}（binding unknown · candidate）{ses.sessionId === attachPick ? '（已选）' : ''}
                  </Text>
                </Pressable>
              ))}
              <TextInput testID="project-create-child-name" value={childName} onChangeText={setChildName} placeholder={t('nodeClone.childNamePlaceholder')} />
              <Pressable
                testID="project-create-submit"
                disabled={projectState.kind === 'busy' || (!projectPick && !attachPick) || !childName}
                onPress={async () => {
                  if ((!projectPick && !attachPick) || !networkId) return;
                  const key = projectPick ?? attachPick!;
                  const intent = projectIntent || newIntentId(`prjc_${key}`);
                  setProjectIntent(intent);
                  setProjectState({ kind: 'busy' });
                  const payload = projectPick
                    ? { selectionScope: receiptScopeRef.current ?? '', snapshotId: dirState.snapshot!.snapshotId, projectId: projectPick, childName, intentId: intent }
                    : { selectionScope: receiptScopeRef.current ?? '', snapshotId: dirState.snapshot!.snapshotId, sessionId: attachPick!, childName, intentId: intent };
                  const r = await postSourceProjectCreate(cfg, payload as any);
                  if (!r.ok) { setProjectState({ kind: 'failed', message: r.unavailable ? '该通道未开放（不会退回普通创建）' : r.error }); return; }
                  let status = r.status; let sessionCreation = r.sessionCreation; let childNodeId: string | undefined;
                  for (let i = 0; i < 26 && status !== 'registration_confirmed' && status !== 'unknown_rotation_required'; i++) {
                    await new Promise(res => setTimeout(res, 2000));
                    const g = await getSourceProjectCreate(cfg, r.requestId, networkId);
                    if (!g.ok) break;
                    status = g.status; sessionCreation = g.sessionCreation; childNodeId = g.childNodeId;
                  }
                  setProjectState({ kind: 'submitted', message: projectCreateLabel(classifyProjectCreate(status as any, sessionCreation, childNodeId)) });
                }}
                style={buttonStyle('primary')}
              >
                <Text style={buttonTextStyle('primary')}>新建会话</Text>
              </Pressable>
              {projectState.message ? (
                <Text testID="project-create-status" style={{ color: projectState.kind === 'failed' ? colors.blocked : colors.text, fontSize: typeScale.small }}>
                  {projectState.message}
                </Text>
              ) : null}
            </View>
          );
        })() : null}
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
