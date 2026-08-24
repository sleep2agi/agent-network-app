// A conversation is fetched by recipient (`to_name=alias`), which says nothing
// about who sent each task. Anyone on the network can dispatch to that alias,
// so attributing every message to the viewer mislabels other nodes' traffic as
// the viewer's own words.
//
// The hub always knows: `tasks.from_name` is NOT NULL, and
// server/src/rest-identity.ts resolves it as
//   user-token client -> requested || authenticated username || "api"
//   node token        -> the node's own alias (claiming another is refused)
// so a non-empty value that is not this client's is genuinely another sender.
//
// Three of the rules below come from PR #55, which solved this first and was
// still open when the earlier version of this module landed.

export interface SenderAttributable {
  from_name?: string;
  /** Set on optimistic echoes that have not yet round-tripped through the hub. */
  _localId?: string;
}

/**
 * The transport label the hub falls back to when a user-token request carries
 * no resolvable user identity. It means "some user client" — which, on this
 * screen, is this one.
 */
export const LEGACY_USER_CLIENT_LABEL = 'api';

/**
 * ChatScreen's placeholder until `GET /api/auth/me` answers. While it is in
 * effect the viewer's own name is unknown, so no row can be classified against
 * it.
 */
export const IDENTITY_PENDING_LABEL = '我';

export interface ResolvedSender {
  /** Who to credit the message to. */
  alias: string;
  /** Whether this client sent it — the delivery marker belongs to those only. */
  isCurrentUser: boolean;
}

/**
 * Resolve a request bubble's author from hub provenance.
 *
 * Ownership wins over provenance in two cases, both deliberate:
 * a local echo is ours by construction whatever the row claims, and while the
 * viewer's own identity is still loading nothing can be judged against it —
 * classifying then would push the viewer's own messages to the far side for a
 * frame and take their delivery marker with them.
 */
export const resolveSender = (
  item: SenderAttributable,
  currentUsername: string,
): ResolvedSender => {
  const current = currentUsername.trim() || IDENTITY_PENDING_LABEL;
  const mine: ResolvedSender = { alias: current, isCurrentUser: true };

  if (item._localId) return mine;
  if (current === IDENTITY_PENDING_LABEL) return mine;

  const from = typeof item.from_name === 'string' ? item.from_name.trim() : '';
  if (!from) return mine;
  if (from === current) return mine;
  if (from === LEGACY_USER_CLIENT_LABEL) return mine;

  return { alias: from, isCurrentUser: false };
};

/** Who to credit a message to. */
export const senderLabelFor = (
  item: SenderAttributable,
  currentUsername: string,
): string => resolveSender(item, currentUsername).alias;

/** True when the message came from someone other than this client. */
export const isForeignSender = (
  item: SenderAttributable,
  currentUsername: string,
): boolean => !resolveSender(item, currentUsername).isCurrentUser;
