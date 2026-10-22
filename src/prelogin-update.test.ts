import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeUpdateRow } from './update-check-state';
import { describeAndroidUpdateRow } from './android-update-core';

const app = readFileSync('App.tsx', 'utf8');
const component = readFileSync('src/PreloginUpdateCheck.tsx', 'utf8');
assert.equal(app.match(/<PreloginUpdateCheck \/>/g)?.length, 2, 'first-run and login both expose updates');
assert.ok(!/HubConfig|username|password|serverUrl|token|login\(/.test(component), 'no Hub credentials required');
assert.ok(component.includes('checkAndroidUpdate(APP_VERSION)'));
assert.ok(component.includes('checkDesktopUpdate(undefined, { manual: true })'));
const options = { currentVersion: '0.2.241', now: 1000 };
assert.equal(describeUpdateRow({ kind: 'idle' }, options).label, '检查更新');
assert.equal(describeUpdateRow({ kind: 'checking' }, options).actionable, false);
assert.equal(describeUpdateRow({ kind: 'error', message: 'offline' }, options).detail, '点击重试');
assert.equal(describeUpdateRow({ kind: 'available', version: '0.2.242', notes: '' }, options).label, '发现新版本 v0.2.242');
assert.equal(describeAndroidUpdateRow({ kind: 'idle' }, options).actionable, true);
console.log('PASS prelogin update: 9 assertions (two entry points, no Hub auth, platform routing and status)');
