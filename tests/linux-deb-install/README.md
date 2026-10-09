# Clean Linux package installation and window probe (TEST ONLY)

Hub #892, child of #843; follows #890. This fixture is deliberately separate
from the compiler image: the package is installed on digest-pinned Ubuntu 24.04
without Node, Rust or GTK development packages. Apt resolves only the deb runtime
dependencies before checking installation/linkage. Display and screenshot tools
are installed in a later layer so they cannot hide missing package dependencies
at the first gate. Apt is not snapshot pinned; no byte-reproducibility claim.

First build and validate the complete test package using
`tests/linux-deb-package/README.md` at an exact Git SHA. Obtain its image ID and
deb SHA256 from the passing verifier, not from a floating release tag. Then:

```sh
sg docker -c 'docker build --build-arg DEB_IMAGE=VALIDATED_LOCAL_IMAGE_ID --build-arg SOURCE_COMMIT=FULL_PRODUCT_SHA --build-arg DEB_SHA256=EXACT_DEB_SHA256 -t anet-linux-install:test -f tests/linux-deb-install/Dockerfile .'
sg docker -c 'docker run --name anet-linux-install-evidence --network none anet-linux-install:test'
sg docker -c 'docker cp anet-linux-install-evidence:/evidence ./linux-install-evidence'
```

Use a unique container name if the example name already exists. Inspect the
exit code, application.log, windows.txt and desktop.png; a named native window
alone is **not** evidence that the embedded WebView painted successfully. A blank
or error screenshot is a failed visual gate even if the process remains alive.
After a positive run, `TEST_DESKTOP_EXECUTABLE=/bin/false` must fail specifically
with `desktop process exited before window acceptance`; an arbitrary Docker
failure is not a successful negative. The script terminates its own app process.

## Acceptance and recovery boundaries

- Inputs: repository build recipes, npm/Cargo locks, exact product SHA, fixture
  SHA, validated deb SHA and image identity. The upstream image can be rebuilt
  using Git; a developer machine is not its only source.
- Startup: repository `run.sh` under a private DBus session and Xvfb. UID 10001,
  no host display/home/keyring mounts, no privileged mode or disabled sandbox.
- Network: run with `--network none`; no published port, proxy or tunnel. Any
  app-local listener remains inside the disposable container namespace.
- Secrets/data: no live Hub accounts, production keyrings or databases. Empty
  container profile only; this does not restore any production data or identity.
- Version changes: rebuild the package from a new exact SHA, recalculate and
  verify its hash, repeat the package and installation gates. Never overwrite
  an installed production client as part of this fixture.
- Rollback/cleanup: preserve evidence, then remove only this run's named
  container. There is no production state to roll back. Persistent production
  user profiles/Hub data require their separately documented backups.

This is not interaction, native IPC, LAN Hub, V2 model/stop/start, credential
unlock, upgrade, cross-distribution, ARM64 or release acceptance. A formal
release still needs a fresh exact-main build, native acceptance and release gates;
these unsigned test artifacts must not enter distribution/update channels.
