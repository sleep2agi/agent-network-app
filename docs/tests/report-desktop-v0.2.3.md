# Desktop v0.2.3 release acceptance report

Date: 2026-08-22  
Commit: `c794ed20b3c92e8a04fbb36554d1f9d8e9bc960e`  
Release: [desktop-v0.2.3-signed-c794ed2](https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v0.2.3-signed-c794ed2)

## Scope

- Tauri-only responsive desktop workspace.
- 64 px navigation rail, 304 px persistent agent/conversation pane, and a
  right-side work area.
- Chat no longer uses the mobile full-screen/back-button pattern on wide
  desktop windows.
- Tasks, scheduled tasks, messages, server, and settings render in the right
  work area.
- Windows/macOS clipboard image and file attachment support from v0.2.2 is
  preserved.
- Windows narrower than 860 px and Android/iOS retain the single-pane layout.

## Automated validation

- `npm test`: 15/15 test files passed.
- `npx expo export -p web`: passed.
- GitHub Actions `desktop-tauri`: macOS arm64 passed; Windows x64 passed.
- Workflow run: https://github.com/sleep2agi/agent-network-app/actions/runs/32553551175

## macOS Aqua acceptance

Environment: macOS arm64, 1200 x 800 app window, real Hub on an explicit HTTP
port.

- Login: busy state at 455 ms; desktop workspace at 3.16 s.
- Agents landing state showed the navigation rail, persistent agent list, and
  right-side empty conversation prompt.
- Selecting an agent retained both left panes and opened chat on the right.
- Desktop chat did not render the mobile back chevron.
- Tasks and Settings switched in the right work area while the left panes
  remained visible.
- Text send produced a visible sent row.
- Clipboard PNG paste produced an attachment preview.
- At 800 x 800, the app fell back to the single-pane layout.
- No WebProcess unresponsive event occurred during the 15-second stability
  window.

## Signing and notarization

- Bundle version: `0.2.3`.
- Bundle identifier: `top.vansin.agentnetwork.desktop`.
- Signing order: executable, app, DMG.
- The proven login keychain was selected explicitly for each `codesign` call;
  no temporary password file or unrelated custom keychain was used.
- App and DMG signature validation passed.
- Apple notarization returned `Accepted` for DMG and app ZIP.
- Stapling and `spctl`/`stapler` validation passed.

## Published assets

| Asset | Size | SHA-256 |
|---|---:|---|
| `Agent.Network_0.2.3_aarch64.dmg` | 6,730,060 | `ab483fb1ad3ce7ec40138fcbae34397b10d478e4eab1d9f0cb5930956c8f50e3` |
| `AgentNetwork_0.2.3_aarch64_c794ed2.app.zip` | 6,286,521 | `5210e7346400f8c879b50476eaadcc94655672e8b6df1267aec1d78709de4a5f` |

Direct DMG download:
https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.3-signed-c794ed2/Agent.Network_0.2.3_aarch64.dmg

Older signed releases and their assets were not modified.
