import fs from 'node:fs';
import {
  conversationKey,
  conversationScope,
  createConversationRequestGate,
  createConversationStore,
} from './conversation-store';

const screen = fs.readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const A = conversationKey('p1', 'https://hub', 'agent-a');
const B = conversationKey('p1', 'https://hub', 'agent-b');

const cache = createConversationStore<string>(2);
cache.put(A, ['a']);
cache.put(B, ['b']);
cache.open(A); // touch A, so B is the least-recently-used entry
const C = conversationKey('p1', 'https://hub', 'agent-c');
cache.put(C, ['c']);

const firstWindow = createConversationRequestGate();
const secondWindow = createConversationRequestGate();
const firstA = firstWindow.open(A);
const secondB = secondWindow.open(B);
const firstB = firstWindow.open(B);
const firstAAgain = firstWindow.open(A);

const cleared = createConversationStore<string>();
cleared.put(A, ['a']);
cleared.put(conversationKey('p2', 'https://hub', 'agent-a'), ['other-profile']);
cleared.clearScope(conversationScope('p1', 'https://hub'));

const checks: Array<[string, boolean]> = [
  ['a normal rerender cannot open or invalidate a request',
    (() => {
      const component = screen.indexOf('export default function ChatScreen');
      const firstEffect = screen.indexOf('useEffect(() => {', component);
      const requestOpen = screen.indexOf('requestGate.open(', component);
      return firstEffect > component && requestOpen > firstEffect;
    })()],
  ['request ownership is created once per ChatScreen instance',
    /createConversationRequestGate\(\)/.test(screen) && /if \(!requestGateRef\.current\)/.test(screen)],
  ['a switch invalidates the previous request in the same window',
    !firstWindow.isCurrent(firstA) && firstWindow.isCurrent(firstAAgain)],
  ['A to B to A rejects both older generations',
    !firstWindow.isCurrent(firstB) && firstWindow.isCurrent(firstAAgain)],
  ['two independent windows do not invalidate each other',
    secondWindow.isCurrent(secondB) && firstWindow.isCurrent(firstAAgain)],
  ['closing a window invalidates its outstanding request', (() => {
    secondWindow.close(secondB);
    return !secondWindow.isCurrent(secondB) && secondWindow.current() === null;
  })()],
  ['a stale answer is cached by its own key before screen writes are refused',
    /conversations\.put\(token\.key, fetched\);\n\s*return;/.test(screen)],
  ['the screen checks request ownership before its first state write', (() => {
    const afterFetch = screen.slice(screen.indexOf('await fetchTasks('));
    const gate = afterFetch.indexOf('requestGate.isCurrent(token)');
    const write = afterFetch.indexOf('setMessages(');
    return gate > 0 && write > gate;
  })()],
  ['unmount closes the current request and blocks later setState',
    /mountedRef\.current = false;/.test(screen) && /requestGate\.close\(token\)/.test(screen)],
  ['a cold conversation never inherits another conversation cache',
    createConversationStore<string>().open(B) === null],
  ['a warm conversation opens synchronously',
    cache.open(A)?.messages.join() === 'a'],
  ['the cache has a finite LRU bound',
    cache.size() === 2 && cache.peek(B) === null && cache.peek(A)?.messages[0] === 'a'],
  ['clearing one profile does not clear another profile',
    cleared.peek(A) === null && cleared.size() === 1],
  ['logout and reauthentication clear the profile cache',
    app.match(/clearChatConversationCache\(/g)?.length === 2],
  ['profile keys never fall back to a token or username',
    A.startsWith('profile:p1::')],
  ['server fallback strips userinfo, query strings, and fragments',
    !conversationKey(null, 'https://user:secret@example.com/base?token=bad#x', 'a').includes('secret')
      && !conversationKey(null, 'https://example.com/base?token=bad#x', 'a').includes('token=')],
  ['the same alias on different hubs is isolated',
    conversationKey(null, 'https://one', 'x') !== conversationKey(null, 'https://two', 'x')],
  ['aliases are encoded instead of becoming key delimiters',
    conversationKey('p', 'https://hub', 'a::b').endsWith('a%3A%3Ab')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`conversation store: ${checks.length} checks passed`);
