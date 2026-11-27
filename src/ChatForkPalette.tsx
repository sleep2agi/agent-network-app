import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from './ui-text';
import { fetchHubNodes, fetchNodeStatus, type HubConfig, type HubNode } from './api';
import { chatForkSource, describeForkSourceError } from './chat-fork-source';
import NodeSourcePalette from './NodeSourcePalette';
import NodeAdoptionControls from './NodeAdoptionControls';
import { PaletteLoading, PaletteOverlay } from './palette-kit';
import { t } from './i18n';
import { colors } from './theme';
import './i18n-node-source';

/**
 * 2026-11-27（admin 截图）：手动启动的节点 fork 被拒时，原来只给一句「请先在节点信息里收编」——
 * 用户得自己关掉弹窗、找节点信息、再找收编入口，绕一大圈。现在源节点「没有 daemon 管理」时，
 * 在原因下面直接放收编控件（同节点信息里那套，含守护进程选择与失败原因）；收编成功后自动重查 fork 源，
 * 通过就直接进入 fork 确认，不用关弹窗重来。
 */
export default function ChatForkPalette({ cfg, alias, onClose }: { cfg: HubConfig; alias: string; onClose: () => void }) {
  const [result, setResult] = useState<ReturnType<typeof chatForkSource> | null>(null);
  const [sourceNode, setSourceNode] = useState<HubNode | null>(null);
  const [online, setOnline] = useState(false);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all([fetchNodeStatus(cfg, alias), fetchHubNodes(cfg)]).then(([status, nodes]) => {
      if (!live) return;
      const sessions = status.sessions ?? [];
      const all = nodes.nodes ?? [];
      setResult(chatForkSource(sessions, all, cfg.networkId, alias));
      const session = sessions.find(row => row.alias === alias && row.network_id === cfg.networkId);
      setSourceNode(session?.node_id ? all.find(n => n.node_id === session.node_id) ?? null : null);
      setOnline(!!session && session.status !== 'offline');
      setProjectDir(session?.project_dir ?? null);
    }).catch(error => { if (live) setResult({ ok: false, error: String(error?.message ?? error) }); });
    return () => { live = false; };
  }, [cfg, alias, attempt]);
  if (!result) return <PaletteOverlay testID="chat-fork-loading-frame" onClose={onClose}><PaletteLoading testID="chat-fork-loading" text={t('chat.forkLoading')} /></PaletteOverlay>;
  const notManaged = !result.ok && result.error === 'fork_source_not_managed' && sourceNode;
  const adoptAction = notManaged ? (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18 }} testID="chat-fork-adopt-hint">{t('chat.forkAdoptHint')}</Text>
      <NodeAdoptionControls key={`fork-adopt:${sourceNode!.node_id}`} cfg={cfg} node={sourceNode!} online={online}
        onRefresh={() => setAttempt(a => a + 1)} initialDialog="adopt" initialPath={projectDir} />
    </View>
  ) : null;
  return <NodeSourcePalette cfg={cfg} title={t('chat.info.fork')} forkOnly
    sourceNodeId={result.ok ? result.nodeId : ''} networkId={cfg.networkId ?? null}
    sessionId={result.ok ? result.sessionId : null}
    forkSessions={result.ok ? [{ sessionId: result.sessionId, nodeId: result.nodeId, label: result.label, path: result.path }] : []}
    forkSourceError={result.ok ? null : describeForkSourceError(result.error)} forkSourceAction={adoptAction} onClose={onClose} />;
}
