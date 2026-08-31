import { readFileSync } from 'node:fs';
import {
  consumeDesktopMessageEvent,
  isDesktopMessageType,
  takeSseJsonPayloads,
} from './desktop-message-consume';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

const hubEvent = (over: Record<string, unknown> = {}) => ({
  type: 'desktop_message',
  message_id: 'dm_abc',
  kind: 'agent_message',
  from: 'build-bot',
  title: '发版完成',
  message: '构建完成，3 个包已发 preview',
  severity: 'success',
  created_at: '2026-08-30T14:00:00.000Z',
  network_id: 'net_1',
  user_id: 'u_1',
  scope: 'user',
  ...over,
});

const ctx = { networkId: 'net_1', userId: 'u_1' };

{
  const r = consumeDesktopMessageEvent(hubEvent(), ctx);
  check('desktop_message with body is presented', r.status === 'present' && r.status === 'present' && r.notice.messageId === 'dm_abc');
  check('presented notice keeps title and message', r.status === 'present' && r.notice.title === '发版完成' && r.notice.message.includes('构建完成'));
  check('presented notice is not an ack / seen flag', r.status === 'present' && !('seen' in r.notice) && !('acked' in r.notice));
}

{
  const sse = 'data: ' + JSON.stringify(hubEvent()) + '\n\n: keepalive\n\n';
  const { payloads, rest } = takeSseJsonPayloads(sse);
  check('SSE data frame yields one payload', payloads.length === 1 && rest === '');
  const r = consumeDesktopMessageEvent(payloads[0], ctx);
  check('SSE desktop_message frame is presented', r.status === 'present' && r.status === 'present' && r.notice.messageId === 'dm_abc');
}

{
  const connected = { type: 'connected', user: true, network_id: 'net_1', user_id: 'u_1' };
  check('connected frame is not a desktop_message type', isDesktopMessageType(connected) === false);
  const r = consumeDesktopMessageEvent(connected, ctx);
  check('connected frame is ignored, not presented as delivered', r.status === 'ignore');
}

{
  const r = consumeDesktopMessageEvent({ type: 'new_task', message: 'hi', message_id: 't1' }, ctx);
  check('other event types are ignored, not presented', r.status === 'ignore');
}

{
  const r = consumeDesktopMessageEvent(hubEvent({ message: '' }), ctx);
  check('empty message is unknown, not presented as delivered', r.status === 'unknown');
}

{
  const r = consumeDesktopMessageEvent(hubEvent({ message_id: '' }), ctx);
  check('missing message_id is unknown, not presented as delivered', r.status === 'unknown');
}

{
  const r = consumeDesktopMessageEvent(hubEvent({ scope: 'network' }), ctx);
  check('observer-scope event is unknown, not presented as delivered', r.status === 'unknown');
}

{
  const r = consumeDesktopMessageEvent(hubEvent({ network_id: 'net_other' }), ctx);
  check('network mismatch is unknown, not presented as delivered', r.status === 'unknown');
}

{
  const r = consumeDesktopMessageEvent(hubEvent({ user_id: 'u_other' }), ctx);
  check('user mismatch is unknown, not presented as delivered', r.status === 'unknown');
}

{
  const r = consumeDesktopMessageEvent(null);
  check('null payload is unknown, not presented as delivered', r.status === 'unknown');
}

{
  const r = consumeDesktopMessageEvent(hubEvent({ severity: 'loud' }), ctx);
  check('unknown severity falls back to info, not success/seen', r.status === 'present' && r.notice.severity === 'info');
}

{
  const src = readFileSync(new URL('./desktop-message-consume.ts', import.meta.url), 'utf8');
  check('consume gate is the desktop_message type check', src.includes("type === 'desktop_message'") && src.includes('isDesktopMessageType'));
}

{
  const listener = readFileSync(new URL('./DesktopMessageListener.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const sse = readFileSync(new URL('./user-events-sse.ts', import.meta.url), 'utf8');
  check('listener calls consumeDesktopMessageEvent', listener.includes('consumeDesktopMessageEvent('));
  check('App mounts DesktopMessageListener', app.includes('<DesktopMessageListener') && app.includes("from './src/DesktopMessageListener'"));
  check('user stream path is /events/users/me', sse.includes('/events/users/me'));
  check('user stream requires utok_', sse.includes("startsWith('utok_')"));
}

if (passed !== total) {
  console.error(`FAILED ${passed}/${total}`);
  process.exit(1);
}
console.log(`ok ${passed}/${total}`);
