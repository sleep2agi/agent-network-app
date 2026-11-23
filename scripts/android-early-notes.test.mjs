import { test } from 'node:test';
import assert from 'node:assert/strict';
import { androidReleaseNotes, versionItems } from './android-release-notes.mjs';
const workflow = `releaseBody: |
  What's new in 0.2.614:
  ### 改进
  - 修复 Android 和桌面聊天刷新。
`;
test('early channel notes retain heading and clearly mark desktop pending', () => {
  const notes = androidReleaseNotes(workflow, '0.2.614', { desktopPending: true });
  assert.ok(notes.startsWith("What's new in 0.2.614:\n"));
  assert.match(notes, /桌面版稍后/);
  assert.ok(versionItems(notes, '0.2.614').some(item => item.includes('桌面版稍后')));
  assert.match(notes, /修复 Android 和桌面聊天刷新/);
});
test('normal publication does not retain pending claim', () => {
  assert.doesNotMatch(androidReleaseNotes(workflow, '0.2.614'), /桌面版稍后/);
});
