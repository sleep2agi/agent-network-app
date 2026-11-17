// admin 2026-11-17「类似于 Grok Bot 的头像动效」—— 头像外圈表达状态：在干活转圈、卡住 / 出错呼吸闪、空闲不动。
import { readFileSync } from 'node:fs';
import { AVATAR_RING_GAP, AVATAR_RING_STROKE, avatarMotion, avatarRingBox } from './avatar-motion';

let pass = 0;
const fails: string[] = [];
const ck = (name: string, ok: boolean) => { if (ok) pass += 1; else fails.push(name); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

ck('working spins in the running colour', JSON.stringify(avatarMotion('working')) === JSON.stringify({ motion: 'working', tone: 'running' }));
ck('running is the same as working', avatarMotion('running').motion === 'working');
ck('blocked asks for attention in amber', JSON.stringify(avatarMotion('blocked')) === JSON.stringify({ motion: 'attention', tone: 'blocked' }));
ck('error / failed ask for attention in red', avatarMotion('error').tone === 'failed' && avatarMotion('failed').motion === 'attention');
ck('idle does not move (a list of idle agents stays still)', avatarMotion('idle').motion === 'none' && avatarMotion('idle').tone === null);
ck('offline / unknown / empty do not move', ['offline', '', null, undefined, 'something-new'].every(s => avatarMotion(s as any).motion === 'none'));
ck('chat 「正在处理」 before the Hub flips to working already spins', avatarMotion('idle', true).motion === 'working');
ck('but an offline agent never spins just because a message is pending', avatarMotion('offline', true).motion === 'none');
ck('blocked wins over local processing', avatarMotion('blocked', true).motion === 'attention');
ck('ring box sits outside the avatar on both sides', avatarRingBox(34) === 34 + 2 * (AVATAR_RING_GAP + AVATAR_RING_STROKE));

const ring = read('./AvatarStatusRing.tsx');
ck('ring is absolutely positioned and ignores touches (layout and taps unchanged)', ring.includes("position: 'absolute' as const") && ring.includes('pointerEvents="none"'));
ck('ring honours the system reduce-motion setting', ring.includes('AccessibilityInfo.isReduceMotionEnabled()') && /reduce \|\| motion === 'none'/.test(ring));
ck('animations use the native driver off web', ring.includes("const NATIVE_DRIVER = Platform.OS !== 'web';") && (ring.match(/useNativeDriver: NATIVE_DRIVER/g) ?? []).length === 3);
ck('no ring and no wrapper when nothing to show', ring.includes("if (motion === 'none' || !tone) return <>{children}</>;"));
ck('ring colours come from theme tokens', ring.includes('colors[tone]') && !/#[0-9a-fA-F]{6}/.test(ring));

const agents = read('./AgentsScreen.tsx');
ck('both agent list layouts wrap the avatar in the ring', (agents.match(/<AvatarStatusRing status=\{item\.status\}/g) ?? []).length === 2);
const chat = read('./ChatScreen.tsx');
ck('chat header avatar shows the ring with local processing', chat.includes('<AvatarStatusRing status={sessionStatus} processing={processing} size={ds(32)} testID="chat-header-ring">'));

console.log(`avatar-motion: ${pass}/${pass + fails.length}`);
if (fails.length) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
