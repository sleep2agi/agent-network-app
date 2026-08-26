import { readFileSync } from 'node:fs';

const notice = readFileSync('src/ActualRecipientNotice.tsx', 'utf8');
const chat = readFileSync('src/ChatScreen.tsx', 'utf8');
const ck = (name: string, ok: boolean) => { if (!ok) throw new Error(`FAIL: ${name}`); };
ck('notice announces status politely', notice.includes('role="status"') && notice.includes('accessibilityLiveRegion="polite"'));
ck('nullable node and network render explicit not reported labels', (notice.match(/未报告/g) ?? []).length >= 3);
ck('double taps are synchronously single-flight', chat.includes('if (!forwardFor || forwardingRef.current || forwardAmbiguous) return'));
ck('late ACK is conversation and mount guarded', chat.includes('mayApplySendResult(startedKey, visibleConversationKeyRef.current, mountedRef.current)'));
ck('ambiguous forward disables blind retry', chat.includes('结果待确认，请勿重复转发') && chat.includes('disabled={!!forwardingTo || forwardAmbiguous}'));
ck('forward request identity is stable', chat.includes('forwardRequestIdRef.current ?? createDashboardRequestId()'));
console.log('actual recipient UI/race: 6/6 checks passed');
