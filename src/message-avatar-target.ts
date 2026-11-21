/** Resolve profile targets from provenance, never from the layout's optimistic "mine" label. */
export type MessageAvatarTarget =
  | { kind: 'node'; networkId: string; nodeId: string; alias: string }
  | { kind: 'user'; networkId: string; userId: string; username: string }
  | { kind: 'unresolved' };

/** Raw author selection for sent/reply rows; callers still resolve it in the target network. */
export function messageAvatarAuthor(input: {
  part: 'sent' | 'reply';
  outgoing: boolean;
  currentAlias: string;
  currentUserId?: string | null;
  row: {
    from_node_id?: string | null;
    from_name?: string;
    to_name?: string;
    _localId?: string;
  };
}): { nodeId?: string; userId?: string; label?: string } {
  const { row } = input;
  if (input.part === 'reply') {
    // A reply to an outgoing task is authored by its recipient, not the viewed node.
    const label = (input.outgoing ? row.to_name : input.currentAlias)?.trim();
    return label ? { label } : {};
  }
  if (row._localId) {
    const userId = input.currentUserId?.trim();
    return userId ? { userId } : {};
  }
  const nodeId = row.from_node_id?.trim();
  if (nodeId) return { nodeId };
  const label = row.from_name?.trim();
  // "api" is a transport fallback, not a verified human or node identity.
  return label && label !== 'api' ? { label } : {};
}

export function messageAvatarTarget(input: {
  networkId: string;
  author: { nodeId?: string | null; userId?: string | null; label?: string | null };
  /** Only identities visible to the viewer in this network may be supplied. */
  nodes: ReadonlyArray<{ networkId: string; nodeId: string; alias: string }>;
  users: ReadonlyArray<{ networkId: string; userId: string; username: string }>;
}): MessageAvatarTarget {
  const { networkId, author } = input;
  if (!networkId) return { kind: 'unresolved' };
  const nodes = input.nodes.filter(n => n.networkId === networkId);
  const users = input.users.filter(u => u.networkId === networkId);
  const nodeId = author.nodeId?.trim();
  const userId = author.userId?.trim();
  // Conflicting provenance must not silently select either identity.
  if (nodeId && userId) return { kind: 'unresolved' };
  if (nodeId) {
    const matches = nodes.filter(n => n.nodeId === nodeId);
    return matches.length === 1 ? { kind: 'node', ...matches[0] } : { kind: 'unresolved' };
  }
  if (userId) {
    const matches = users.filter(u => u.userId === userId);
    return matches.length === 1 ? { kind: 'user', ...matches[0] } : { kind: 'unresolved' };
  }
  const label = author.label?.trim();
  if (!label) return { kind: 'unresolved' };
  const candidates: MessageAvatarTarget[] = [
    ...nodes.filter(n => n.alias === label).map(n => ({ kind: 'node' as const, ...n })),
    ...users.filter(u => u.username === label).map(u => ({ kind: 'user' as const, ...u })),
  ];
  return candidates.length === 1 ? candidates[0] : { kind: 'unresolved' };
}
