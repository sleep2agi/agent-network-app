import { canOpenUserEventStream, userEventStreamUrl } from './user-events-sse';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

check(
  'user stream URL is /events/users/me with network_id',
  userEventStreamUrl('https://hub.example.com/', 'net/1') ===
    'https://hub.example.com/events/users/me?network_id=net%2F1',
);

check('utok_ + network can open', canOpenUserEventStream({ token: 'utok_abc', networkId: 'n1' }));
check('ntok_ cannot open user stream', canOpenUserEventStream({ token: 'ntok_abc', networkId: 'n1' }) === false);
check('missing network cannot open', canOpenUserEventStream({ token: 'utok_abc' }) === false);
check('missing token cannot open', canOpenUserEventStream({ token: '', networkId: 'n1' }) === false);

if (passed !== total) {
  console.error(`FAILED ${passed}/${total}`);
  process.exit(1);
}
console.log(`ok ${passed}/${total}`);
