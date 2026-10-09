# Linux credential baseline (#843 / #872)

This is a **historical dependency-level defect reproducer**, not an application
test, a persistence implementation, or evidence that Linux desktop is supported.
At app main `fcd13d339eedb323e98e8c1617c4852f15409f59`, `src-tauri/Cargo.toml`
has generic `keyring = "3"` plus native backend features for macOS and Windows,
but no Linux backend. The lock resolves keyring 3.6.3 / log 0.4.34. There is no
application override of the default credential builder. This probe freezes that
Linux feature selection deliberately; do not silently update it to a fixed
configuration or treat its green diagnostic as a production acceptance gate.

keyring 3.6.3's authoritative crate `src/lib.rs` selects the mock backend when no
Linux backend feature applies. Its `src/mock.rs` explains that storage belongs
to an individual Entry. The application's existing
`desktop_session_round_trip_uses_native_store` only writes/reads/deletes one
Entry, so that assertion alone does not establish native storage or persistence.
See <https://docs.rs/crate/keyring/3.6.3/source/src/lib.rs> and
<https://docs.rs/crate/keyring/3.6.3/source/src/mock.rs>.

## Reproduce (all execution in Docker)

From the repository root:

```sh
sg docker -c 'docker build -t anet-linux-credential:baseline tests/linux-credential-baseline'
sg docker -c 'docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges anet-linux-credential:baseline'
sg docker -c 'docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges anet-linux-credential:baseline --require-persistence'
```

The first run must exit 0 and report `backend_is_mock=true`,
`new_entry_missing=true`, and `child_exit=Some(42)`. The second deliberately exits
101 at `PERSISTENCE REQUIRED`; a compile error, missing executable, or another
failure is **not** the expected negative control. Both runs first demonstrate a
successful same-Entry round trip. Only dummy data is used; no host files, actual
tokens, session bus, or credential stores are mounted. The image runs as UID
10001. Cargo is locked; the Rust build image is digest-pinned.

## Next acceptance slice (#877)

1. Select a real persistent Linux store. Evaluate `sync-secret-service` with
   `crypto-rust` first, with a real isolated session DBus and Secret Service.
   `linux-native` alone must not be presumed durable across logout/reboot.
   Regenerate the application lockfile in isolation; preserve Apple/Windows
   backend selections.
2. Strengthen the application test: reject a mock type and read through a new
   Entry. Add a real-backend helper that writes in one process and reads in
   another, deletes the item, then verifies `NoEntry`. The baseline probe above
   remains frozen as historical evidence, separate from that green acceptance.
3. Test service absence and locked-store errors explicitly: return actionable
   errors, never silently store secrets in plaintext or mock memory. Supply the
   Linux CI session-bus/keyring fixture before enabling the production feature;
   the current rust-check workflow does not provide one.
4. Exercise the real Tauri credential paths, multi-Hub profiles and old tokens,
   then perform a separate Linux desktop install/start/connect/upgrade test.
   A standalone dependency probe cannot certify those paths.

## Recovery and release boundary

This change adds no resident service, listener, proxy, tunnel, environment secret,
production credential or database migration. Rebuilding the probe needs only
this directory, the pinned public image and locked public crates. Docker image
removal reverses the probe; no application state is changed. Existing production
credentials/data still need their platform store or encrypted backup; cloning
this repository does not recover them. The later backend implementation must
document how a user session starts/unlocks Secret Service, which package supplies
it, upgrade verification and rollback behavior. Linux packages and anet.sh links
remain blocked on real desktop acceptance and a fresh exact-main-SHA release.
