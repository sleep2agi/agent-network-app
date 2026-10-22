# Local daemon initialization regression

This crate compiles `src-tauri/src/local_daemon.rs` directly. A temporary private
prefix, executable CLI/npm fixtures, a loopback HTTP Hub fixture and real child
processes exercise the production installation path. No desktop credentials,
host services or real AI nodes are used.

Run the same regression on macOS/Linux (CI runs both):

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
