# Linux .deb candidate — test only

Hub #890, child of #843. This is the build/package layer needed before native
desktop and OpenCode V2 acceptance (#829/#539). It is not a release procedure.

## Inputs and scope

Ubuntu 24.04 **amd64 only**, digest-pinned Ubuntu/Node/Bun/Rust images, Rust
1.90.0, npm lockfiles and product Cargo.lock. Apt repositories are not snapshot
pinned: the build is described from Git but is not claimed byte-reproducible.
The complete Expo Web export, generated icons and real pinned CommHub sidecar
are built; no empty `dist` or fake native executable is substituted.

The overlay disables updater artifacts and removes production updater endpoints
for this test binary. No updater key, real Hub credentials, signing identity,
production database, host keyring or home directory is required or mounted.

Build from a clean exact commit (replace the placeholder with a full 40-digit SHA):

```sh
sg docker -c 'git archive FULL_40_DIGIT_SHA | docker build --build-arg SOURCE_COMMIT=FULL_40_DIGIT_SHA -t anet-linux-deb:test -f tests/linux-deb-package/Dockerfile -'
sg docker -c 'docker run --rm --network none anet-linux-deb:test'
```

The GitHub workflow uses the actual checked-out commit, including a PR merge
commit when applicable. Its artifact is explicitly named `TEST-ONLY`; it is not
uploaded to a Release, npm, anet.sh or an automatic-update channel.

## Layered checks

1. Environment architecture/toolchain, locked dependencies.
2. Typecheck and real Web export, icons and real sidecar.
3. Native release-mode Tauri compilation and unsigned `.deb` bundling.
4. Offline package inspection: one package, expected architecture/version,
   GTK/WebKit runtime dependencies, real executable ELF main and sidecar,
   manifest sidecar target/version/hash, desktop launcher/icon, library linkage
   in the build environment. Any earlier failure prevents later assertions.
5. `TEST_DEB_EXPECT_ARCH=arm64` must fail specifically at the architecture check;
   a missing image/tool or arbitrary nonzero exit is not a successful negative.

These checks **do not install or start the GUI**, invoke native Tauri IPC, prove
LAN Hub connectivity, test upgrades, or exercise V2 creation/model/stop/start.
They also do not establish compatibility with Ubuntu 22.04, ARM64, other
distributions or AppImage. The Ubuntu 24.04 build baseline can require newer
glibc; see [Tauri's Debian guidance](https://v2.tauri.app/distribute/debian/).

## Recovery and production boundary

- Rebuild the named source SHA using this Dockerfile and repository lockfiles;
  `.github/workflows/linux-deb-package.yml` is the authoritative CI recipe.
- This suite starts no persistent service, listener, proxy or tunnel. No host
  ports are published. Public dependency downloads occur only during build;
  package inspection runs with `--network none`.
- No secret source is needed. It produces software only, not a backup of Hub
  databases, identity registrations, node workspaces or user keyring data.
- Changing version means building another exact source SHA and re-running every
  gate. It does not mean replacing an installed production client.
- Rollback of a test candidate means selecting a previous tested artifact in an
  isolated test environment; existing production software/data are untouched.
- Formal distribution requires a separate main-ancestry check and a fresh build
  of an exact main SHA without this test-only updater overlay, native acceptance
  and the repository's release gates. Never promote this PR artifact to release.
