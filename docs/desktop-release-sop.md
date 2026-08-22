# Desktop build, acceptance, signing, and release SOP

This checklist is the release gate for the Tauri desktop app on macOS and
Windows. A successful CI compile is necessary, but it is not sufficient for a
signed release.

## 1. Build from an exact commit

Use a clean worktree and record the full commit SHA. Do not build from a dirty
checkout or overwrite an older release directory.

```bash
npm ci
npm test
npx expo export -p web
npx tauri icon assets/icon.png
npx tauri build
```

The `desktop-tauri` GitHub Actions workflow must produce both:

- macOS arm64: `.dmg` and app `.zip`
- Windows x64: NSIS `.exe` and WiX `.msi`

CI desktop artifacts are unsigned unless the workflow explicitly configures
platform signing. Publish them only as clearly labelled test builds. Windows
may show SmartScreen and macOS Gatekeeper may reject an unsigned artifact.

## 2. Tauri HTTP transport checks

Never replace `globalThis.fetch` with `@tauri-apps/plugin-http.fetch`.
Tauri's macOS IPC itself uses the global fetch implementation; replacing it
creates recursive `plugin fetch -> invoke -> IPC fetch` calls and eventually an
unresponsive WebProcess. Call the plugin explicitly through `appFetch`.

HTTP capability scopes must cover explicit ports. These two patterns are both
required alongside the default-port patterns:

```json
{ "url": "http://*:*/*" }
{ "url": "https://*:*/*" }
```

Without them, a Hub such as `http://example.test:9300` is rejected before the
request leaves the app and looks like a generic network failure.

## 3. Real desktop acceptance

Run the newly built, unsigned app in the logged-in Aqua session before signing.
Use a real Hub with a non-default port and verify:

1. Login reaches the Agents screen and the authenticated profile is visible.
2. The app remains responsive for at least 15 seconds; system logs contain no
   `WebProcessProxy::didBecomeUnresponsive` event.
3. On macOS, `Cmd+V` pastes an image attachment and the send button clears the
   preview after submission.
4. Copy a non-image file in Finder with `Cmd+C`, return to the app, and use
   `Cmd+V`; the file preview and send must succeed.
5. Plain text paste still enters the composer and is not converted to an
   attachment.
6. Query the Hub task metadata and download every uploaded file by its file API
   URL. Check HTTP 200, MIME type, size, and bytes.

Locate controls from the current window bounds or accessibility data. Do not
reuse absolute click coordinates from another window position: a click in the
right edge of the text field can look like a broken send button.

## 4. macOS signing

Use the same logged-in Aqua session and keychain that owns the Developer ID
private key. Quit the app first and confirm the executable is no longer running.

The successful local release path uses the unlocked login keychain. Specify it
explicitly so an unrelated keychain earlier in the search list cannot intercept
the identity lookup:

```bash
SIGNING_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
IDENTITY="Developer ID Application: <name> (<team-id>)"

security find-identity -v -p codesigning "$SIGNING_KEYCHAIN"
codesign --force --options runtime --timestamp \
  --keychain "$SIGNING_KEYCHAIN" \
  --sign "$IDENTITY" "path/to/Agent Network.app/Contents/MacOS/agent-network-desktop"
codesign --force --options runtime --timestamp \
  --keychain "$SIGNING_KEYCHAIN" \
  --sign "$IDENTITY" "path/to/Agent Network.app"
codesign --verify --deep --strict --verbose=2 "path/to/Agent Network.app"
```

If `codesign` hangs at `replacing existing signature`:

- confirm the app process is fully stopped;
- inspect `securityd` and `SecurityAgent` logs;
- read the authorization dialog carefully: a named custom keychain password is
  not necessarily the Mac login password;
- explicitly select `login.keychain-db` if that is the proven keychain;
- never ask for passwords in chat, print secret values, reset a keychain, or
  rely on a plaintext `/tmp` password file.

## 5. Notarization and final checks

After app verification succeeds:

1. Recreate and sign the DMG from the signed app.
2. Submit the app ZIP and DMG to Apple's notary service.
3. Require `Accepted` for both submissions.
4. Staple the app and DMG, then recreate the distribution ZIP from the stapled
   app if necessary.
5. Run all final checks:

```bash
spctl --assess --type execute --verbose=4 "path/to/Agent Network.app"
spctl --assess --type open --context context:primary-signature --verbose=4 "path/to/Agent Network.dmg"
xcrun stapler validate "path/to/Agent Network.app"
xcrun stapler validate "path/to/Agent Network.dmg"
shasum -a 256 "path/to/Agent Network.dmg" "path/to/AgentNetwork.app.zip"
```

Record bundle version, exact commit, sizes, SHA-256 values, notary submission
IDs, and the raw validation results.

## 6. GitHub Release rules

- Create a new prerelease tag for each immutable signed build.
- Never overwrite an older signed release or reuse assets from another commit.
- Include the exact commit and SHA-256 values in release notes.
- Keep unsigned test releases explicitly named `unsigned`; publish signed and
  notarized assets under a separate `signed` tag.
- Verify GitHub asset sizes after upload before sharing direct download URLs.

