# Exported App File Transfer Acceptance

Runs installed Playwright and Google Chrome against the existing `dist` export. It does not build, modify application code, contact a real Hub, read real credentials, or execute native save/open commands.

```sh
node tests/file-transfer-ui/verify.mjs
```

On this machine Node is installed outside PATH:

```sh
"$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" tests/file-transfer-ui/verify.mjs
```

Optional overrides: `PLAYWRIGHT_MODULE` (absolute module filename), `CHROME_PATH` (installed browser executable).

## Scope

- Unmodified full exported App, navigated by clicking real agent, person, group, back, composer, card, and retry controls. No direct component mounts or App navigation hooks.
- Synthetic local profile and in-memory Hub responses. All browser network requests are restricted to the loopback fixture origin. WebSockets are inert. No real Hub writes or credentials.
- Desktop Tauri profile, HTTP, save dialog, save bytes, persistence, and reveal IPC are simulated and recorded. Real native dialogs, Rust filesystem writes, and Finder are not exercised.
- Plain browser mode starts without Tauri and uses the normal web session store with a synthetic profile. Authenticated downloads must produce an actual Playwright download event, matching bytes, and credential-free blob URL.
- Receive matrix: agent, human DM, and group at 1440x1000 and 390x844, light and dark. PPTX/PDF/zero-byte ZIP and a decoded image appear together.
- Agent send matrix: desktop light and mobile dark, upload failure and task-send failure, real HTML file chooser, then chat remount and retry. Desktop includes four files and one image to exercise the upload concurrency queue. Mobile uses the real single-document chooser.
- Asserts card/ancestor containment, maximum 300px width, horizontal overflow, right-side icons, zero-byte size, visible extension width, download cancel, authenticated save, reveal, explicit Save As, download error/retry, upload memo, and stable request correlation ID.

## Evidence

`artifacts/report.json` contains assertion results, export SHA-256, screenshot paths, uncaught page errors, and blocked external requests. `artifacts/evidence.json` contains real rendered body text and synthetic request/IPC traces. `artifacts/browser-Acceptance.pdf` contains downloaded fixture bytes, not a real PDF document. Screenshots are viewport captures with actual App content, not blank component canvases.

The suite exits nonzero for failed product requirements. Do not remove failing checks to obtain a green release gate.
