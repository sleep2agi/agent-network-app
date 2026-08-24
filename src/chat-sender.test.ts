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

  // The hub is a real, distinct sender: a broadcast is not the viewer's message.
  ['hub keeps its own name', senderLabelFor({ from_name: 'hub' }, ME) === 'hub'],
  ['hub is not the current user', !resolveSender({ from_name: 'hub' }, ME).isCurrentUser],

  // Surrounding whitespace must not create a second identity for one sender.
  ['padded alias is trimmed', senderLabelFor({ from_name: '  通信牛  ' }, ME) === '通信牛'],
  ['padded own username still maps to the viewer', senderLabelFor({ from_name: ` ${ME} ` }, ME) === ME],

  // Wiring, not just logic.
  ['ChatScreen resolves a sender per message',
    /const sender = resolveSender\(item, currentUsername\)/.test(screen)],
  ['the author line renders the resolved alias', screen.includes('{sender.alias}\n')],
  ['the avatar renders the resolved alias', screen.includes('<AliasAvatar alias={sender.alias} size={36} />')],
  ['nothing in the screen still hardcodes the viewer as the sender',
    !screen.includes('alias={currentUsername}')],
  // The marker that says "you sent this, and it arrived" must not appear under
  // a message the viewer did not send.
  ['the delivered marker is gated on ownership',
    /sender\.isCurrentUser && !\(item\.result \?\? item\.reply\)/.test(screen)],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`chat sender attribution: ${checks.length} checks passed`);
