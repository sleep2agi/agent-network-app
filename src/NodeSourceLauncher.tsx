// Directory discovery requires a real source on the selected daemon. Never use
// the daemon's ID as a fictitious source or silently fall back to create_node.
// 挑选逻辑在 node-source-launcher-model.ts（runtime 名、归属、排序、空态计数）。
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { fetchHubNodes, type HubConfig } from './api';
import { Ionicons } from './icons';
import { pickSourceNodes, sourceDetail, sourceMatches, type SourcePick } from './node-source-launcher-model';
import NodeSourcePalette from './NodeSourcePalette';
import { PaletteOverlay, PaletteSearch, PaletteList, PaletteRow, PaletteError, PaletteLoading, PaletteEmpty, PaletteSectionLabel, makePaletteStyles } from './palette-kit';
import { colors } from './theme';
import { Text } from './ui-text';

export default function NodeSourceLauncher({ cfg, daemonNodeId, daemonLabel, onClose }: {
  cfg: HubConfig; daemonNodeId: string; daemonLabel?: string | null; onClose: () => void;
}) {
  const [pick, setPick] = useState<SourcePick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const styles = makePaletteStyles();
  useEffect(() => {
    let live = true;
    void fetchHubNodes(cfg).then(result => {
      if (live) setPick(pickSourceNodes(result.nodes, daemonNodeId));
    }).catch(e => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [cfg, daemonNodeId]);
  if (sourceId) return <NodeSourcePalette cfg={cfg} sourceNodeId={sourceId} daemonNodeId={daemonNodeId}
    networkId={cfg.networkId ?? null} sessionId={null} title="已有项目 / 已有会话 / 新会话" onClose={onClose} />;
  const filtered = pick?.sources.filter(c => sourceMatches(c, query)) ?? null;
  const server = daemonLabel || daemonNodeId;
  const emptyTitle = pick?.sources.length ? '没有匹配的来源节点'
    : pick?.unboundOnHost ? `这台服务器上有 ${pick.unboundOnHost} 个 OpenCode V2 节点，但都没有被 ${server} 接管`
    : '这台服务器上还没有 OpenCode V2 节点';
  const emptyHint = pick?.sources.length ? '换个关键词试试：节点名、文件夹、模型都能搜。'
    : pick?.unboundOnHost ? '在节点页「接管」后即可作为来源；也可以返回直接新建。'
    : '先在这台服务器上建一个 OpenCode V2 节点，再用它读取已有项目和会话。';
  return <PaletteOverlay testID="create-source-launcher" onClose={onClose} onKey={k => { if (k === 'escape') onClose(); }}>
    <View style={styles.header}>
      <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
      <Text style={styles.headerTitle}>选择来源节点</Text>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭" hitSlop={8} style={styles.closeBtn} testID="create-source-close">
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
    <Text style={styles.headerSub}>用 {server} 上的一个 OpenCode V2 节点读取目录，再选已有项目、已有会话或新会话。</Text>
    <PaletteSearch value={query} onChangeText={setQuery} placeholder="搜索节点名、文件夹或模型" accessibilityLabel="搜索来源节点" testID="create-source-search" />
    {error ? <PaletteError text={error} testID="create-source-error" />
      : !pick ? <PaletteLoading testID="create-source-loading" text="读取来源节点…" />
      : !filtered?.length ? <PaletteEmpty testID="create-source-empty" title={emptyTitle} hint={emptyHint} />
      : <>
        <PaletteSectionLabel title={`来源节点 · ${filtered.length}`} testID="create-source-count" />
        <PaletteList testID="create-source-list">{filtered.map(c => <PaletteRow key={c.node.node_id} testID={`create-source-${c.node.node_id}`}
          label={c.node.alias || c.node.node_id} accessibilityLabel={c.node.alias || c.node.node_id} detail={sourceDetail(c) || c.node.node_id}
          current={false} disabled={!c.active} onPress={() => { if (c.active) setSourceId(c.node.node_id); }} />)}</PaletteList>
      </>}
  </PaletteOverlay>;
}
