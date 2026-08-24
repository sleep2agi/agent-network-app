import fs from 'node:fs';
import { senderLabelFor, isForeignSender } from './chat-sender';

const ME = 'vansin';

// A pure-function test alone would stay green if the screen stopped calling it,
// which is exactly the defect being fixed. Pin the wiring too.
// Normalised: a Windows checkout has CRLF, and an assertion anchored on "\n"
// would red there while passing on Linux — the trap version-consistency.test.ts
// already guards against.
const screen = fs
  .readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

const checks: Array<[string, boolean]> = [
  // The bug: a task dispatched to this alias by another node was credited to
  // the viewer, so a dispatch from 通信牛 read as something the viewer wrote.
  ['another node keeps its own alias', senderLabelFor({ from_name: '通信牛' }, ME) === '通信牛'],
  ['another node is foreign', isForeignSender({ from_name: '通信牛' }, ME)],

  // This client's own messages stay labelled as the viewer.
  ['own username maps to the viewer', senderLabelFor({ from_name: ME }, ME) === ME],
  ['own username is not foreign', !isForeignSender({ from_name: ME }, ME)],

  // Optimistic echoes are rendered before the hub has assigned anything.
  ['missing from_name falls back to the viewer', senderLabelFor({}, ME) === ME],
  ['blank from_name falls back to the viewer', senderLabelFor({ from_name: '   ' }, ME) === ME],
  ['non-string from_name falls back to the viewer',
    senderLabelFor({ from_name: 42 as unknown as string }, ME) === ME],

  // "api" is the hub's fallback for a user-token request with no resolvable
  // user identity (server/src/rest-identity.ts) — a user client, i.e. this one.
  ['legacy api label maps to the viewer', senderLabelFor({ from_name: 'api' }, ME) === ME],

  // The hub itself is a real, distinct sender: broadcasts are not the viewer's.
  ['hub keeps its own name', senderLabelFor({ from_name: 'hub' }, ME) === 'hub'],

  // Surrounding whitespace must not create a second identity for one sender.
  ['padded alias is trimmed', senderLabelFor({ from_name: '  通信牛  ' }, ME) === '通信牛'],
  ['padded own username still maps to the viewer', senderLabelFor({ from_name: ` ${ME} ` }, ME) === ME],

  // Before GET /api/auth/me resolves, currentUsername is the placeholder. A
  // real sender name is still better than crediting everything to "我".
  ['unresolved viewer still shows the real sender',
    senderLabelFor({ from_name: '通信牛' }, '我') === '通信牛'],

  // Wiring, not just logic.
  ['ChatScreen derives a sender per message',
    /const sender = senderLabelFor\(item, currentUsername\)/.test(screen)],
  ['the author line renders the derived sender', screen.includes('{sender}\n')],
  ['the avatar renders the derived sender', screen.includes('<AliasAvatar alias={sender} size={36} />')],
  ['nothing in the screen still hardcodes the viewer as the sender',
    !screen.includes('alias={currentUsername}')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`chat sender attribution: ${checks.length} checks passed`);
