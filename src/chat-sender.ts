export interface ChatSenderItem {
  from_name?: string;
  _localId?: string;
}

export interface ChatSender {
  alias: string;
  isCurrentUser: boolean;
}

/** Resolve the author of a task's request bubble from Hub provenance. */
export function requestBubbleSender(item: ChatSenderItem, currentUsername: string): ChatSender {
  const current = currentUsername.trim() || '我';
  const from = item.from_name?.trim();
  const alias = item._localId ? current : from || current;

  // Before /api/auth/me resolves, preserve the historical local layout. The
  // state update re-renders server rows with their authoritative from_name.
  const identityPending = current === '我';
  return {
    alias,
    isCurrentUser: !!item._localId || !from || identityPending || alias === current,
  };
}
