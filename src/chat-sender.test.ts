import fs from 'node:fs';
import { resolveSender, senderLabelFor, isForeignSender } from './chat-sender';

const ME = 'vansin';

// A pure-function test alone would stay green if the screen stopped calling it,
// which is exactly the defect this module exists for. Pin the wiring too.
// Normalised: a Windows checkout has CRLF, and an assertion anchored on "\n"
// would red there while passing on Linux.
const screen = fs
  .readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

const checks: Array<[string, boolean]> = [
  // The original defect: a task dispatched to this alias by another node was
  // credited to the viewer, so a dispatch from 通信牛 read as the viewer's words.
  ['another node keeps its own alias', senderLabelFor({ from_name: '通信牛' }, ME) === '通信牛'],
  ['another node is foreign', isForeignSender({ from_name: '通信牛' }, ME)],
  ['another node is not the current user', !resolveSender({ from_name: '通信牛' }, ME).isCurrentUser],

  // This client's own messages stay credited to the viewer.
  ['own username maps to the viewer', senderLabelFor({ from_name: ME }, ME) === ME],
  ['own username is the current user', resolveSender({ from_name: ME }, ME).isCurrentUser],

  // "api" is the hub's fallback for a user-token request with no resolvable
  // user identity (server/src/rest-identity.ts) — a user client, i.e. this one.
  ['legacy api label maps to the viewer', senderLabelFor({ from_name: 'api' }, ME) === ME],
  ['legacy api label is the current user', resolveSender({ from_name: 'api' }, ME).isCurrentUser],

  // Rows with no provenance at all.
  ['missing from_name falls back to the viewer', senderLabelFor({}, ME) === ME],
  ['blank from_name falls back to the viewer', senderLabelFor({ from_name: '   ' }, ME) === ME],
  ['non-string from_name falls back to the viewer',
    senderLabelFor({ from_name: 42 as unknown as string }, ME) === ME],

  // From PR #55: an optimistic echo is ours by construction. Provenance on such
  // a row cannot outrank that — otherwise a stale or spoofed value would move
  // the viewer's own unsent message to the far side.
  ['local echo stays the viewer even with foreign provenance',
    resolveSender({ _localId: 'local-1', from_name: 'spoofed' }, ME).isCurrentUser],
  ['local echo is labelled as the viewer',
    senderLabelFor({ _localId: 'local-1', from_name: 'spoofed' }, ME) === ME],

  // From PR #55: while GET /api/auth/me is unresolved the viewer's own name is
  // unknown, so nothing can be classified against it. Judging then would push
  // the viewer's own rows to the far side for a frame — and, now that the
  // delivery marker follows ownership, strip their 已送达 ✓ and put it back.
  ['identity pending keeps rows on the current-user side',
    resolveSender({ from_name: ME }, '我').isCurrentUser],
  ['identity pending does not credit a peer either',
    resolveSender({ from_name: '通信牛' }, '我').isCurrentUser],
  ['empty username is treated as identity pending',
    resolveSender({ from_name: '通信牛' }, '   ').isCurrentUser],

  // 2026-09-17 Vincent (app 0.2.72): rows the hub stamps with from_node_id came
  // from a node token. A node is never this client — not while identity is
  // pending, and not even when its alias collides with the viewer's username.
  ['node-originated row is foreign while identity is pending',
    !resolveSender({ from_node_id: 'n_354adc27', from_name: 'TMA门户鲸' }, '我').isCurrentUser],
  ['node-originated row keeps its alias while identity is pending',
    senderLabelFor({ from_node_id: 'n_354adc27', from_name: 'TMA门户鲸' }, '我') === 'TMA门户鲸'],
  ['node-originated row is foreign even when from_name equals the viewer',
    !resolveSender({ from_node_id: 'n_1', from_name: ME }, ME).isCurrentUser],
  ['node-originated row without from_name falls back to the node id',
    senderLabelFor({ from_node_id: 'n_1' }, ME) === 'n_1'],
  ['null from_node_id with the admin name maps to the viewer',
    resolveSender({ from_node_id: null, from_name: 'admin' }, 'admin').isCurrentUser],
  ['local echo still outranks a stale from_node_id',
    resolveSender({ _localId: 'l', from_node_id: 'n_1', from_name: 'x' }, ME).isCurrentUser],

  // The hub is a real, distinct sender: a broadcast is not the viewer's message.
  ['hub keeps its own name', senderLabelFor({ from_name: 'hub' }, ME) === 'hub'],
  ['hub is not the current user', !resolveSender({ from_name: 'hub' }, ME).isCurrentUser],

  // Surrounding whitespace must not create a second identity for one sender.
  ['padded alias is trimmed', senderLabelFor({ from_name: '  通信牛  ' }, ME) === '通信牛'],
  ['padded own username still maps to the viewer', senderLabelFor({ from_name: ` ${ME} ` }, ME) === ME],

  // Wiring, not just logic.
  ['ChatScreen resolves a sender per message',
    /const sender = resolveSender\(item, currentUsername\)/.test(screen)],
  // 2026-09-16:作者行后面跟时刻(「· HH:mm」),别名仍是 resolveSender 的结果
  ['the author line renders the resolved alias', /\{sender\.alias\}\{item\.created_at \? ` · \$\{formatChatHeader\(item\.created_at\)\}` : ''\}/.test(screen)],
  ['the avatar renders the resolved alias', screen.includes('<AliasAvatar alias={sender.alias} size={36} />')],
  ['nothing in the screen still hardcodes the viewer as the sender',
    !screen.includes('alias={currentUsername}')],
  // The marker that says "you sent this, and it arrived" must not appear under
  // a message the viewer did not send.
  // 0.2.72: a foreign request renders on the received side, credited
  // 「<sender> → <agent>」, with the sender's avatar — not in the viewer's row.
  ['foreign requests take the received-side branch',
    /sender\.isCurrentUser \? \(/.test(screen) && screen.includes('styles.foreignRow')],
  ['foreign requests are labelled sender → agent',
    screen.includes('{`${sender.alias} → ${alias}`}')],
  ['foreign requests show the sender avatar on the left',
    /styles\.foreignRow\]\}>\s*<AliasAvatar alias=\{sender\.alias\} size=\{36\} \/>/.test(screen)],
  ['the identity lookup retries instead of giving up once',
    screen.includes('nextIdentityRetryDelay(')],
  ['the delivered marker is gated on ownership',
    /sender\.isCurrentUser && !\(item\.result \?\? item\.reply\)/.test(screen)],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`chat sender attribution: ${checks.length} checks passed`);
