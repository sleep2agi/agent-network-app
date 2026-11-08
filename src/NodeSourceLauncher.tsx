// Directory discovery requires a real source on the selected daemon. Never use
// the daemon's ID as a fictitious source or silently fall back to create_node.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { fetchHubNodes, type HubConfig, type HubNode } from './api';
import { nodeProviderDaemon } from './node-provider-target';
import NodeSourcePalette from './NodeSourcePalette';
import { PaletteOverlay, PaletteSearch, PaletteList, PaletteRow, PaletteError, PaletteLoading, PaletteEmpty, makePaletteStyles } from './palette-kit';
import { Text } from './ui-text';

export default function NodeSourceLauncher({ cfg, daemonNodeId, onClose }: {
  cfg: HubConfig; daemonNodeId: string; onClose: () => void;
}) {
  const [nodes, setNodes] = useState<HubNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<HubNode | null>(null);
  const [query, setQuery] = useState('');
  const styles = makePaletteStyles();
  useEffect(() => {
    let live = true;
    void fetchHubNodes(cfg).then(result => {
      if (live) setNodes(result.nodes.filter(node => node.runtime === 'opencode-cli'
        && node.opencode_generation === 'v2' && nodeProviderDaemon(node) === daemonNodeId));
    }).catch(e => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [cfg, daemonNodeId]);
  if (source) return <NodeSourcePalette cfg={cfg} sourceNodeId={source.node_id} daemonNodeId={daemonNodeId}
    networkId={cfg.networkId ?? null} sessionId={null} title="已有项目 / 已有会话 / 新会话" onClose={onClose} />;
  const filtered = nodes?.filter(node => `${node.alias} ${node.node_id}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <PaletteOverlay testID="create-source-launcher" onClose={onClose}>
    <View style={styles.header}><Text style={styles.headerTitle}>选择目录来源 · OpenCode V2</Text>
      <Pressable onPress={onClose} accessibilityRole="button"><Text>关闭</Text></Pressable></View>
    <PaletteSearch value={query} onChangeText={setQuery} placeholder="搜索此服务器上的来源节点" accessibilityLabel="搜索来源节点" testID="create-source-search" />
    {error ? <PaletteError text={error} testID="create-source-error" /> : !nodes ? <PaletteLoading testID="create-source-loading" text="读取来源节点…" /> : !filtered?.length ? <PaletteEmpty testID="create-source-empty" title={nodes.length ? '没有匹配的来源节点' : '此服务器没有可用于目录读取的 OpenCode V2 来源节点'} hint="不会伪造项目或退回普通创建" /> :
      <PaletteList testID="create-source-list">{filtered.map(node => <PaletteRow key={node.node_id} testID={`create-source-${node.node_id}`} label={node.alias} accessibilityLabel={node.alias} detail={node.node_id} current={false} onPress={() => setSource(node)} />)}</PaletteList>}
  </PaletteOverlay>;
}
