# Local daemon initialization regression

This crate compiles `src-tauri/src/local_daemon.rs` directly. A temporary private
prefix, executable CLI/npm fixtures, a loopback HTTP Hub fixture and real child
processes exercise the production installation path. No desktop credentials,
host services or real AI nodes are used.

Run the adapter regression on macOS/Linux (CI runs both):

```sh
SHELL=/bin/sh cargo test --locked --manifest-path tests/local-daemon-init/Cargo.toml -- --test-threads=1
```

Or run it in an isolated container:

```sh
docker build -f tests/local-daemon-init/Dockerfile -t anet-local-daemon-init-test .
docker run --rm --init anet-local-daemon-init-test
```

`--init` reaps detached fixture processes. Tests run serially because the fixture
temporarily sets process environment variables. The assertions cover upgrades
from npm's old `latest` versions, stop-before-init ordering, stop failure and a
lying stop command, installed-version verification, duplicate installs, repeated
repair, tool PATH preservation and exact online/create-capable Hub acceptance.

This isolates installer behavior; it does not certify Claude/Codex authentication
or runtime execution. The existing packaged macOS install smoke remains the
native platform gate.

The #906 registry-delay case downloads the real public CLI release tarball over
HTTPS and verifies the production-pinned hash before passing its local filename
to the fixture npm adapter. It needs outbound HTTPS in the container. A separate
wrong-digest case proves no archive install, init or start occurs. The adapters
are not evidence of a signed app install or real Codex account authentication.

## Windows native promotion gate (#1497)

`local-daemon-init.yml` also runs `windows-latest`, with fail-fast disabled.
The crate compiles the production `local_daemon.rs` unchanged. Unix-only
shell/Python fault adapters print `NOT_RUN` with their POSIX dependency on
Windows; they are not relabelled as Windows acceptance. Product unit tests still
run, followed by the mandatory native gate in `windows-native-smoke.ts`.

The Windows gate builds the Rust binary driver and starts a real temporary Hub
from exact source `f8332b965cf428cf843daa6888c3e1f433f60b61`. Hub dependencies
and Bun are test-runner prerequisites only. The installer gets a scrubbed,
OS-tools-only PATH, an empty prefix, isolated app root (containing spaces and
`&`), no model credentials and no global Node/npm/anet/Git. Nothing installs
globally on the runner. The driver refuses an ambient Node or an existing
installation, then calls the actual production `install` function.

The only registry fixture returns 404 for CLI metadata, to exercise the
production's real HTTPS GitHub release tarball download and pinned SHA256 check.
All dependency/runtime traffic goes to the public npm registry. No npm adapter
simulates successful installation. The Node Windows ZIP is downloaded and
verified against the product-selected official SHASUMS256 manifest, unpacked
with Windows tar, and used with its private npm. Both installed package versions
must exactly equal the product pins. The product's latest-v22.x Node selection
is intentionally not changed; evidence records resolved version and executable
digest, not a claim of a fixed historical Node archive.

After Rust returns, the real detached daemon must remain online/create-capable;
native process metadata must show the direct private `node.exe` + `anet.cjs`
launcher. This invokes the product `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`
path, not a substitute shell wrapper. Private init credentials, an explicit
HOME/USERPROFILE `os.homedir()` probe and an unchanged external `.anet` sentinel
are checked. The sentinel proves no sentinel write, not full read isolation or
inspection of every child process's environment.

The real daemon creates a `claude-agent-sdk` child with per-node `secrets.env`
containing only a fake key and a loopback model URL. A streaming HTTP stub must
receive model traffic and supply a unique first reply. Required bounds:

- **Download/install start through first SDK reply ≤180000ms**, including the
  installer download/hash/npm/init/start path (not Rust compilation/Hub setup).
- **Stop dispatch through Hub-accepted `status=stopped` ACK ≤15000ms**, with
  `exit_signal=taskkill`. `stop_failed`, unknown or mere offline are not success.

No threshold increases, timeout swallowing or fallback to a fake reply.
The resulting sanitized `evidence/windows-native.json` is uploaded even on
failure; preceding stages remain `NOT_RUN` with a reason, not PASS. It includes
App/Hub source identity, installed pair, pinned CLI archive SHA256, private Node
version/digest, stage outcomes/timings and bounded redacted failure diagnostics.
Never upload the temporary session/config/secret files or raw log directory.

Cleanup delegates only fixture-owned aliases to the pinned product CLI, with
its ownership checks; there is no raw PID/name-based kill fallback. Cleanup is
separate from the timed child-stop ACK acceptance. Signed NSIS installation,
GUI/IPC and physical clean-machine testing remain `NOT_RUN`: this is the actual
native installer compiled without Tauri windowing, not a signed-app test.
The existing crate provides temporary app-root/directory/atomic-write helpers;
desktop credential-store/ACL helper integration is also `NOT_RUN`, not certified
by the installer source being compiled here.

To reproduce on a disposable native Windows runner, use the exact workflow:
checkout App source; checkout the pinned Hub into `.native-hub-source`; install
its server dependencies with `npm ci`; use Rust 1.90.0 and Bun 1.3.14; then:

```powershell
cargo test --locked --manifest-path tests/local-daemon-init/Cargo.toml -- --test-threads=1 --nocapture
cargo build --locked --manifest-path tests/local-daemon-init/Cargo.toml
bun tests/local-daemon-init/windows-native-smoke.ts
```

Do not reuse a host's daemon prefix, credentials or HOME. This test adds no
service, production secret, reverse proxy, tunnel, listener or startup topology
outside its disposable loopback fixture. Rollback is the ordinary code rollback;
there is no production data migration or promise of restoring user data from Git.
