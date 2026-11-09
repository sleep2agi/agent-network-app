import { useEffect, useState } from 'react';
import { fetchHubNodes, fetchNodeStatus, type HubConfig } from './api';
import { chatForkSource, describeForkSourceError } from './chat-fork-source';
import NodeSourcePalette from './NodeSourcePalette';
import { PaletteLoading, PaletteOverlay } from './palette-kit';
import { t } from './i18n';
import './i18n-node-source';

export default function ChatForkPalette({ cfg, alias, onClose }: { cfg: HubConfig; alias: string; onClose: () => void }) {
  const [result, setResult] = useState<ReturnType<typeof chatForkSource> | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([fetchNodeStatus(cfg, alias), fetchHubNodes(cfg)]).then(([status, nodes]) => {
      if (live) setResult(chatForkSource(status.sessions ?? [], nodes.nodes ?? [], cfg.networkId, alias));
    }).catch(error => { if (live) setResult({ ok: false, error: String(error?.message ?? error) }); });
    return () => { live = false; };
  }, [cfg, alias]);
  if (!result) return <PaletteOverlay testID="chat-fork-loading-frame" onClose={onClose}><PaletteLoading testID="chat-fork-loading" text={t('chat.forkLoading')} /></PaletteOverlay>;
  return <NodeSourcePalette cfg={cfg} title={t('chat.info.fork')} forkOnly
    sourceNodeId={result.ok ? result.nodeId : ''} networkId={cfg.networkId ?? null}
    sessionId={result.ok ? result.sessionId : null}
    forkSessions={result.ok ? [{ sessionId: result.sessionId, nodeId: result.nodeId, label: result.label, path: result.path }] : []}
    forkSourceError={result.ok ? null : describeForkSourceError(result.error)} onClose={onClose} />;
}
