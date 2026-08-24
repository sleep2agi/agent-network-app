import fs from 'node:fs';
import { conversationKey, createConversationStore } from './conversation-store';

const screen = fs
  .readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

let clock = 1000;
const store = () => createConversationStore<string>(() => (clock += 1));

const A = conversationKey('p1', 'https://hub', 'agent-a');
const B = conversationKey('p1', 'https://hub', 'agent-b');
const C = conversationKey('p1', 'https://hub', 'agent-c');

// A → B with A still in flight: the reported symptom.
const stale = store();
const aToken = stale.open(A).token;
stale.put(aToken, ['a-1', 'a-2']);
const bOpen = stale.open(B);
const lateA = stale.put(aToken, ['a-3']); // A answers after the switch

// A → B → A, answers arriving out of order.
const reorder = store();
const r1 = reorder.open(A).token;
const r2 = reorder.open(B).token;
const r3 = reorder.open(A).token;
const acceptedR1 = reorder.put(r1, ['old-a']);
const acceptedR2 = reorder.put(r2, ['b']);
const acceptedR3 = reorder.put(r3, ['fresh-a']);

// Reopening a cached conversation.
const warm = store();
const w1 = warm.open(A).token;
warm.put(w1, ['a-1']);
warm.open(B);
const reopened = warm.open(A);

// A conversation never loaded.
const cold = store();
const coldOpen = cold.open(C);

// A failed request: nothing is applied, and the view must stay on C.
const failed = store();
failed.open(A).token;
failed.put(failed.open(A).token, ['a']);
const cToken = failed.open(C).token;
// (no put — the request threw)

// Unmount: a token from before the screen closed must not apply afterwards.
const unmounted = store();
const beforeUnmount = unmounted.open(A).token;
unmounted.open(B); // navigating away counts as a new open
const appliedAfterUnmount = unmounted.put(beforeUnmount, ['ghost']);

// Scroll position per conversation.
const scrolled = store();
scrolled.open(A);
scrolled.rememberScroll(A, 420);
scrolled.open(B);
scrolled.rememberScroll(B, 90);

// Sending into a conversation that is not the active one.
const isolated = store();
isolated.open(A);
isolated.put(isolated.open(A).token, ['a-1']);
isolated.open(B);
isolated.append(A, 'a-2-sent-while-viewing-b');

const checks: Array<[string, boolean]> = [
  // A → B residue — the bug as reported.
  ['a late answer for A is not applied while B is open', lateA === false],
  ['the token for B is the current one', stale.isCurrent(bOpen.token)],
  ['B opens with no content of its own', bOpen.snapshot === null],
  ["A's late answer is still kept against A", stale.peek(A)?.messages.join() === 'a-3'],

  // A → B → A out of order.
  ['the first A answer is rejected once B is open', acceptedR1 === false],
  ['the B answer is rejected once A is open again', acceptedR2 === false],
  ['only the answer for the conversation on screen is applied', acceptedR3 === true],
  ['the reopened conversation holds its newest answer', reorder.peek(A)?.messages.join() === 'fresh-a'],

  // Instant reopen from cache.
  ['a cached conversation reopens with its messages', reopened.snapshot?.messages.join() === 'a-1'],
  ['a cached conversation reports having content', warm.hasContent(A)],
  ['reopening issues a fresh token', reopened.token.id > w1.id],

  // Nothing cached: the caller must be able to tell, and show a skeleton.
  ['a conversation never opened has no snapshot', coldOpen.snapshot === null],
  ['a conversation never opened reports no content', cold.hasContent(C) === false],

  // Failure keeps the current identity.
  ['a failed request leaves the active conversation unchanged', failed.activeKey() === C],
  ['a failed request shows C empty rather than A', failed.hasContent(C) === false],
  ['the failed conversation still holds its own token', failed.isCurrent(cToken)],
  ["A's content is not shown under C", failed.peek(C)?.messages.length !== 1],

  // Unmount.
  ['a token from before unmount cannot apply', appliedAfterUnmount === false],

  // Scroll position.
  ['each conversation keeps its own scroll offset',
    scrolled.scrollOf(A) === 420 && scrolled.scrollOf(B) === 90],
  ['an unseen conversation starts at the top', scrolled.scrollOf(C) === 0],

  // Sends are addressed by conversation, not by "current".
  ['a message sent to A lands in A while B is open',
    isolated.peek(A)?.messages[0] === 'a-2-sent-while-viewing-b'],
  ['the conversation on screen is untouched by it', isolated.hasContent(B) === false],

  // Two hubs, one alias.
  ['the same alias on two hubs is two conversations',
    conversationKey('p1', 'https://one', 'x') !== conversationKey('p2', 'https://two', 'x')],
  ['the server url identifies a conversation when there is no profile',
    conversationKey(null, 'https://one', 'x') !== conversationKey(null, 'https://two', 'x')],

  // Wiring: the screen must actually gate on the token, not merely import it.
  ['ChatScreen opens a conversation through the store',
    /conversations\.open\(conversationKeyFor\b/.test(screen)],
  ['ChatScreen refuses to apply a stale answer',
    /if \(!conversations\.isCurrent\(token\)\) return;/.test(screen)],
  // The gate must sit between the await and the first state write; anywhere
  // later and a stale answer has already been applied.
  ['the token check sits between the fetch and the first state write',
    (() => {
      const afterFetch = screen.slice(screen.indexOf('await fetchTasks('));
      const gate = afterFetch.indexOf('conversations.isCurrent(token)');
      const write = afterFetch.indexOf('setMessages(');
      return gate > 0 && write > 0 && gate < write;
    })()],
  ['loaded is only set for the conversation still on screen',
    /if \(conversations\.isCurrent\(token\)\) setLoaded\(true\);/.test(screen)],
  ['a cached conversation is shown without a loading state',
    /setLoaded\(true\);/.test(screen) && /snapshot\.messages\.length > 0/.test(screen)],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`conversation store: ${checks.length} checks passed`);
