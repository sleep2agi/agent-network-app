# File Transfer Release Acceptance

## Result

The current installed Chrome/Playwright bilingual run against the existing compiled full App completed with **365/366 assertions passed, 1 failed**, reproduced in two consecutive runs. The original **156 functional assertions remain passing**, with explicit Chinese preference; 210 additional assertions cover bilingual copy and the added English flows. The current run produced **49 distinct screenshots**, **0 uncaught page errors**, and **0 blocked external requests**. Export bundle bytes were verified unchanged. No build, typecheck, or unit-test suite was run in this tests-only follow-up.

The earlier acceptance run passed 156/156 after the three production fixes listed below; its reported typecheck/export/444-test-file results are historical, not checks repeated here. See `artifacts/report.json` for current exact bundle SHA-256 and individual results.

## Current I18n Regression

The former hardcoded-Chinese file-card statuses are no longer an issue: all nine status dictionary values pass in both languages, including real queued/uploading/waiting-send/uploaded/send-failure and download/error/saved flows. Save hints, reveal, Save As, and fresh browser hints/handoff confirmations pass in their initial language. `anet.language.v1` must contain `zh` or `en`, not `zh-CN`; the original fixture's invalid preference fell back to system English despite asserting old Chinese hardcodes.

**Remaining bug: browser handoff confirmation retains the download-time language.** Start in English, navigate into Fixture-Agent, download Acceptance.pdf, then switch to Chinese without remounting. The status updates to Chinese but the footer remains `Handed to your browser · Click to download again` instead of the Chinese dictionary value. `src/AttachmentFileDesktop.tsx:36` stores the translated string in `state.message`, and line 54 reuses it after language changes. Evidence: `artifacts/browser-handoff-runtime-zh.png`; exact failing check: `runtime browser handoff: zh translated confirmation`. The failing assertion is retained and the runner exits 1. No source fix was made in this tests-only scope.

Runtime switching uses the app's installed cross-tab storage-event listener, not a reload or internal module hook. Received cards retain DOM identity. The Settings language-picker UI and reveal-error localization are not exercised.

## Fixed Regressions

1. **Long filename extensions disappear visually.** All 12 receive combinations fail: agent/DM/group, desktop/mobile, light/dark. `.pptx` remains in DOM text/accessibility labels but its box shrinks to 14.125px on desktop and 9.140625px on mobile, versus 36.057px required to display the extension. Screenshots show an ellipsis instead of `.pptx`. Relevant source: `src/AttachmentFileCard.tsx:22-23` and `:49-51`. The extension shares a shrinking flex row with the long stem; DOM-only assertions would miss this.
2. **Browser mixed images become generic file cards.** A fresh browser-mode App session with no Tauri globals renders authenticated `Diagram.png` as a FILE card rather than a loaded image. The same fixture produces a decoded image in the desktop-shell receive matrix. Relevant source: `src/ChatScreen.tsx:1589` limits authenticated web thumbnails to Tauri, while `:1647-1650` routes remaining authenticated web attachments to `AttachmentFileDesktop`. See `artifacts/browser-authenticated-download.png`.
3. **A successful zero-byte response cannot be downloaded.** `Empty.zip` correctly renders `0 B`, but clicking it in browser mode produces the error `空文件` and no browser download anchor. Relevant source: `src/desktop-download.ts:21` rejects a zero-length body despite a successful HTTP response. This shared helper also serves desktop downloads, although the zero-byte desktop path was not separately exercised. See `artifacts/browser-zero-byte-error.png`.

The production patch fixed all three cases and also restored authenticated
downloads for settled Hub-backed attachments recovered from the outbox. Pending
and failed sends keep their original request IDs and upload memoization.

## Passing Coverage

- Full exported App with normal navigation into agent chat, human DM, and group chat; no direct component harness.
- 1440x1000 light/dark and 390x844 light/dark receive screenshots containing actual filenames, sizes, icons, statuses, and mixed image content in shell mode.
- Remote and outgoing file cards are contained by their parent, at most 300px wide, with icons on the right and no horizontal page overflow. Short PDF/ZIP extensions and `0 B` render correctly.
- Real file chooser intake: desktop batch of PPTX/PDF/ZIP/TXT/PNG, mobile single PPTX.
- Queued/uploading/waiting-send/uploaded states, injected upload failure, injected task-send failure, visible retry, chat switch/remount, and successful retry with all attachments.
- Upload memo: desktop upload failure produces six upload attempts for five attachments; desktop send failure produces five, not ten. Mobile counts are two and one respectively. Only one successful task send occurs in each scenario.
- The persisted failed outbox ID equals `meta.client_request_id` on every task retry, including after chat remount. Message text is preserved.
- Desktop Save dialog cancellation issues no file fetch; authenticated bytes are passed to save IPC with the chosen path; reveal uses the folder-reveal command; explicit Save As uses the previously selected directory; HTTP 503 is shown and retry succeeds.
- Fresh browser-mode normal session store, authenticated nonempty fetch, real browser download event, blob-only download URL, matching downloaded bytes, and no false native-save confirmation.
- No arbitrary open/shell command in exercised traces; credentials remain in headers rather than URLs or download anchors.

## Screenshots And Traces

The current report lists **49 distinct screenshots**. Important examples:

- `artifacts/desktop-light-agent-received.png`
- `artifacts/desktop-dark-dm-received.png`
- `artifacts/mobile-light-agent-received.png`
- `artifacts/mobile-dark-group-received.png`
- `artifacts/desktop-light-upload-failure-uploading.png`
- `artifacts/desktop-light-upload-failure-failed.png`
- `artifacts/desktop-light-task-failure-delivered.png`
- `artifacts/mobile-dark-task-failure-delivered.png`
- `artifacts/desktop-light-saved.png`
- `artifacts/desktop-light-download-error.png`
- `artifacts/browser-authenticated-download.png`
- `artifacts/browser-zero-byte-error.png`
- `artifacts/desktop-en-agent-received.png`
- `artifacts/desktop-en-dm-received.png`
- `artifacts/desktop-en-group-received.png`
- `artifacts/runtime-receive-zh.png`
- `artifacts/runtime-receive-en.png`
- `artifacts/desktop-en-upload-failure-runtime-zh.png`
- `artifacts/desktop-en-task-failure-runtime-en.png`
- `artifacts/browser-en-authenticated-download.png`
- `artifacts/browser-handoff-runtime-zh.png`
- `artifacts/browser-handoff-runtime-en.png`

`artifacts/evidence.json` preserves actual body text and synthetic Hub/IPC requests for each final scenario. Earlier exploratory screenshots not listed in the final report are not part of the final result.

## Not Exercised

- Native Tauri Save dialog UI, actual Rust disk writes/permissions, and Finder/Explorer behavior. Their frontend IPC contracts were mocked and asserted, not executed.
- DM/group outgoing upload failures and retries. Their receive rendering and normal navigation were exercised in all four viewport/theme combinations.
- Full process restart recovery, real native mobile file pickers, real Hub ACLs, large-file throughput, live SSE, and release packaging.
- Outgoing light/dark cross-product: failure/retry sends ran desktop light and mobile dark; the receive matrix covers both themes at both widths.

All data is synthetic and all services are session-local/in-memory. No real Hub writes, credential reads, builds, commits, pushes, or release publication were performed.
