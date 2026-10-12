# Daemon settings window (#959 / app #837)

On macOS/Windows, the Daemon management header's **Open daemon settings in a
separate window** button opens an independent, resizable window. It keeps the
Hub profile, network and daemon selected when opened. Reopening the same scope
restores and focuses the existing window. Android and ordinary web keep their
existing in-app management page; a desktop creation failure also leaves it usable.

The independent window reuses the existing overview, Provider/account/model,
managed-node, node-settings, log and create-node screens. Closing it only closes
the UI: it never stops or restarts a Daemon or managed Agent. It does not change
the main window's active account. A missing saved profile produces a visible
sign-in instruction, not a fallback to another account.

## Implementation and recovery

- Entry and independent route: `src/DaemonManagementScreen.tsx`, `App.tsx`.
- Scope, native creation and reuse: `src/daemon-settings-window.ts`.
- Page and existing feature navigation: `src/DaemonSettingsWindow.tsx`.
- Native window capability: `src-tauri/capabilities/default.json` (`daemon-settings-*`).
- No new daemon, startup service, port, reverse proxy, tunnel or environment variable.
- Profile credentials stay in the existing desktop profile store. URLs carry only
  profile/network/alias identifiers, never keys or login credentials.
- Rebuild using the repository's normal desktop pipeline, and publish only from
  an exact full main SHA. Check that the header opens the correct daemon and a
  second click focuses the same window. A test web export is not a native package.
- Rollback is an ordinary client software rollback. There is no Hub migration or
  provider credential migration in this change. Restoring the Git repository
  restores the UI code, not desktop login data or Hub data: sign in again or use
  the existing approved credential/data backup procedure.

## Narrow verification

```sh
sg docker -c 'docker build -f tests/daemon-settings-window/Dockerfile -t anet-app:daemon-settings-window .'
sg docker -c 'docker run --rm --init --network none --tmpfs /out anet-app:daemon-settings-window'
```

This verifies route isolation, creation/reuse/error behavior, declared window
capabilities and chrome, type checking, and the real exported UI with synthetic
Tauri/Hub IPC. It does not verify OS window-manager behavior, real OAuth, model
inference or a signed installer. No local/production accounts are mounted.
