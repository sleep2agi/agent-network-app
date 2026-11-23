# Android early channel release (pending review)

The successful main push `android-build` completion triggers `android-early-publish.yml`.
It dispatches the existing publisher with the exact source SHA and build run. Desktop
builds continue independently. Dispatch acceptance is not publication success:
inspect the publisher's anonymous download verification before announcing availability.
Full CI is retained. Manual rebuild events and forks cannot automatically publish.

**合并版本号 PR = 安卓用户可能立即收到更新提示，不再有后续人工批准环节兜底。**
版本号 PR 合并前必须完成安卓相关验收；例外须明确授权并记录未验项。
紧急关停：停用 `android-early-publish.yml` 工作流（`gh workflow disable android-early-publish.yml --repo sleep2agi/agent-network-app`）。
已启动的 publisher 需另行确认状态/取消；停用入口不会撤回已发布 APK。

Only a package version change against the commit's first parent can trigger publishing.
Dependency/script-only edits print “不是版本号提交，跳过”; identical existing publication
prints “已发布，跳过”. Existing mismatched identity still fails closed.
Before any desktop build (including dry builds), preflight checks existing Android
publication: a different source SHA requires using the original SHA or a new version.
Notes reads retry three times. Equal pointers with unavailable notes warn green, not
verified notes; known pending notes become stale only after 20 minutes from publication.

## Hard checks and offline evidence

| Requirement | Enforcement | Test |
|---|---|---|
| Successful main run, exact source and attempt | `validateEarlyTrigger`, mandatory `android-build-source.mjs` verification | `android-early-dispatch.test.mjs`, `src/android-build-source.test.ts` |
| Fixed unique unexpired artifact ID and archive digest | Actual publisher workflow selector; download by artifact ID, SHA256 before unzip | `android-artifact-selection.test.mjs` executes the workflow selector with six cases |
| Immutable source/run/attempt/artifact/APK identity | `android-publication-identity.mjs`, publisher `--identity`, mirror `android/<version>/publication.json` | `android-publication-identity.test.mjs`, `test_android_publication_record.py` |
| No same-version rebuild replacement; no versionCode decrease | Existing record must match exactly; existing APK digest cannot change; code checked against APK badging and latest version | `test_android_publication_record.py`, `android-publication-identity.test.mjs` |
| Desktop uses original run/artifact | `android-pinned-build.mjs` before normal lookup; original attempt and artifact archive digest verified | `android-pinned-build.test.mjs` |
| Desktop attachment equals early published APK | Compare source/record/APK digest and stream actual mirror bytes; no `--clobber`, existing GitHub digest must match | `android-attachment-identity.test.mjs` |
| Desktop availability is not implied | Android notes include a version-section item “桌面版稍后” until canonical desktop release exists | `android-early-notes.test.mjs`; existing `src/android-update-notes.test.ts` covers notes channel priority |

## Failure and recovery

- Missing or expired source/artifact metadata, non-404 network/auth errors and digest
  conflicts fail closed. An old version with an APK but no publication record cannot
  be silently adopted into this identity scheme. Use a new version for migration.
- Immutable publication identity is staged in the same ModelScope commit as the APK,
  checksum, notes and latest pointer, under the existing serialized publisher group.
- Replaying the identical recorded publication is permitted. New run/attempt/artifact
  identity is rejected even if the APK bytes happen to match.
- Disable the early trigger to return to desktop-first operation. Do not overwrite
  an already published APK or lower versionCode; use a higher-version repair release.
- When version pointers already match but Android notes still say desktop pending,
  the post-release lag gate selects the original recorded build and waits for the
  notice to disappear. Missing provenance stops the refresh. Mocked whole-gate
  integration coverage lives in `src/android-mirror-lag-gate.test.ts` (39/39).

## Local checks before PR

- New Node test files: 11 tests passed (including six actual workflow selector cases).
- Publication-record Python tests: 4/4 passed.
- Source gates: `android-release-source.test.ts` 6/6 and `android-publish-source.test.ts` 12/12.
- Android update-note regression: 16/16; mirror-gate integration: 39/39.
- These are offline checks; GitHub CI and first real publication remain separate gates.

## Acceptance still required

Offline tests do not prove workflow-run delivery, ModelScope atomic publication,
archive digest availability, native update prompts or cross-workflow races. Before
merge, review the normal desktop-first path and historical recovery compatibility.
On the first authorized real release, record functional-merge → APK downloadable
elapsed time, early publication identity, desktop attachment digest equality, notes
in the Android update UI, and failure/replay behavior. Target ≤30 minutes remains
a measurement goal, not an achieved result.
