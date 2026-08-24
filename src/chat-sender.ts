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

export interface SenderAttributable {
  from_name?: string;
}

/**
 * The transport label the hub falls back to when a user-token request carries
 * no resolvable user identity. It means "some user client" — which, on this
 * screen, is this one.
 */
export const LEGACY_USER_CLIENT_LABEL = 'api';

/**
 * Who to credit a message to. Returns `currentUsername` for this client's own
 * messages (including optimistic local echoes, which have no `from_name` yet)
 * and the sender's alias for anything else.
 */
export const senderLabelFor = (
  item: SenderAttributable,
  currentUsername: string,
): string => {
  const from = typeof item.from_name === 'string' ? item.from_name.trim() : '';
  if (!from) return currentUsername;
  if (from === currentUsername) return currentUsername;
  if (from === LEGACY_USER_CLIENT_LABEL) return currentUsername;
  return from;
};

/**
 * True when the message came from someone other than this client. The bubble
 * stays on the same side either way — only the attribution changes — but the
 * caller may want to know.
 */
export const isForeignSender = (
  item: SenderAttributable,
  currentUsername: string,
): boolean => senderLabelFor(item, currentUsername) !== currentUsername;
