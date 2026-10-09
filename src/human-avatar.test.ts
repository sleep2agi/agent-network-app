import assert from 'node:assert/strict';
import { humanAvatarPlan } from './human-avatar';
import { poolFileNameForAlias } from './lib/avatar-resolve';
import { peopleRows } from './human-dm';
let n = 0;
const check = (name: string, actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, name); n++; console.log('PASS', name); };
check('unknown identity has no image', humanAvatarPlan('', 'https://example.test/a'), null);
for (const value of [undefined, null, '', {}, '/avatars/../private', '/avatars/intern_avatar.png', 'file:///private', 'javascript:alert(1)', 'https://u:p@example.test/a', 'https://example.test/a b']) {
  check(`invalid/old Hub value ${JSON.stringify(value)} defaults by user ID`, humanAvatarPlan('user-a', value), { file: poolFileNameForAlias('user-a') });
}
check('bundled pool value', humanAvatarPlan('user-a', '/avatars/avatar-03.webp'), { file: 'avatar-03.webp' });
check('HTTP image', humanAvatarPlan('user-a', ' http://example.test/avatar.png '), { uri: 'http://example.test/avatar.png' });
check('HTTPS image', humanAvatarPlan('user-a', 'https://example.test/avatar.png'), { uri: 'https://example.test/avatar.png' });
const rows = peopleRows([{ user_id: 'a', username: 'same', avatar_url: '/avatars/avatar-03.webp' }, { user_id: 'b', username: 'same', avatar_url: '/avatars/avatar-04.webp' }], [], 'self');
check('same-name people preserve their own Hub values', rows.map(p => humanAvatarPlan(p.user_id, p.avatar_url)), [{ file: 'avatar-03.webp' }, { file: 'avatar-04.webp' }]);
console.log(`${n}/${n} passed`);
