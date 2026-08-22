import { requestBubbleSender } from './chat-sender';

let passed = 0;
const ck = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
};

ck('current account request stays on the outgoing side',
  requestBubbleSender({ from_name: 'admin' }, 'admin').isCurrentUser);

const peer = requestBubbleSender({ from_name: 'Mac打包牛' }, 'admin');
ck('peer request uses the authoritative sender alias', peer.alias === 'Mac打包牛');
ck('peer request is not classified as the current account', !peer.isCurrentUser);

const echo = requestBubbleSender({ _localId: 'local-1', from_name: 'spoofed' }, 'admin');
ck('local echo remains owned by the current account', echo.alias === 'admin' && echo.isCurrentUser);

ck('missing legacy provenance retains current-user layout',
  requestBubbleSender({}, 'admin').isCurrentUser);

ck('identity-loading fallback does not flash old rows to the wrong side',
  requestBubbleSender({ from_name: 'admin' }, '我').isCurrentUser);

console.log(`${passed}/${passed} passed`);
