# Linux credential-store acceptance (#843 / #877)

This suite exercises the same keyring version and Linux backend features as the
application: synchronous Secret Service with Rust-implemented transport crypto.
It runs a real GNOME Keyring and private session DBus inside Docker, not a mock.
`check-inputs.py` rejects feature drift, a different keyring version, or any probe
registry dependency version/checksum absent from the application's lockfile.

From repository root:

```sh
sg docker -c 'docker build --target probe -t anet-linux-credential:test -f tests/linux-credential-store/Dockerfile .'
sg docker -c 'docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges anet-linux-credential:test'
```

Acceptance covers missing bus returning a storage error (not successful save or
NoEntry); a fresh store; cross-Entry and separate-process reads; persistence
across session-bus/service restart; a locked collection failing closed without
a display; recovery in a fresh unlocked session; and deletion followed by
NoEntry. The expected Gtk prompt warnings belong to the locked-store negative
case. A timeout or panic is a failure, not a passing unavailable-service test.
All fixture values and the keyring password are dummy test data. No real token,
desktop bus, host home or database is mounted. The default container user is
UID 10001 and its state dies with the container.

The Rust image is digest-pinned and both Cargo graphs are locked. Debian apt
repositories are not snapshot-pinned; record the resolved image and installed
package versions with each run rather than claiming byte-identical future
rebuilds. `lock-update` and `probe-lock` stages exist only for mechanical lock
generation. Their stub library allows dependency resolution, **not Tauri
compilation**. `probe` does not run those update stages. Preserve unrelated
platform dependency edges when reviewing generated lock changes.

The application's strengthened Rust unit test also rejects a mock backend and
reopens the credential identity. `rust-check.yml` runs full cargo checks/tests
in an Ubuntu Docker job with `scripts/with-linux-test-keyring.sh`; that helper
requires `ANET_ISOLATED_KEYRING_TEST=1`. It is not a production startup script.
This dependency suite does not certify the UI, native desktop installation,
multi-Hub migration, bundled local Hub or macOS/Windows behavior. Those checks
and the current exact-head CI must pass before release acceptance.

## Linux runtime and recovery contract

- The desktop uses the logged-in user's **session** DBus and Secret Service
  (`org.freedesktop.secrets`). No TCP port, reverse proxy or tunnel is introduced.
  On a supported GNOME desktop the desktop/PAM session owns service startup and
  unlock. A headless machine or a locked collection is not silently supported.
  Installable package dependency and distribution support matrices are still
  pending #843; this change does not advertise an Ubuntu package as available.
- The app must return credential-store errors when access is unavailable; do not
  create a mock or plaintext fallback. The user should unlock their OS keyring
  through their desktop session and retry. Do not copy the test unlock helper or
  its dummy password into production. Application tokens come from normal Hub
  authentication, never repository configuration or CI fixture values.
- Upgrade verification includes saving a dummy/test profile, exiting the app,
  reopening it in the same user session and after a fresh login, then checking
  reauthentication/revocation and multi-Hub isolation. Those full-app checks are
  not replaced by this probe.
- Existing macOS/Windows backend selections and credential identities remain
  unchanged. Earlier experimental Linux mock values cannot be recovered: they
  were never persisted. Reauthenticate rather than inventing a migration source.
- Rolling back to a version without the Linux backend makes persisted Linux
  credentials inaccessible to that app; it does not erase the OS keyring.
  Keep the encrypted user keyring and its unlock/recovery method in the user's
  normal encrypted-backup process. Profile metadata or a Git clone alone cannot
  reconstruct secrets. This change performs no backup migration or live rollout.
- Public binaries must still be rebuilt from an exact merged-main SHA and pass
  native install/upgrade tests; branch probes never enter anet.sh or updater feeds.
