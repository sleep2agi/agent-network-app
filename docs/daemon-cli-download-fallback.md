# Local Daemon CLI package download fallback (#906)

The desktop keeps its existing private installation and paired runtime. When
npm reports ETARGET/404 or a registry/network failure for the pinned CLI, it
tries this independent public copy before the existing npm mirror fallback:

- Package: `@sleep2agi/agent-network@2.3.0-preview.163`
- URL: https://github.com/sleep2agi/agent-network/releases/download/cli-v2.3.0-preview.163/sleep2agi-agent-network-2.3.0-preview.163.tgz
- SHA256: `15f498ac22663bb948743fefbc93906751e4aaf493990a484e799a38a5837c58`
- Package source main commit: `b4413131b73c52c286beec46509773716698d89f`
- Formal release gates: https://github.com/sleep2agi/agent-network/actions/runs/38106199041
- Paired runtime remains `@sleep2agi/agent-node@2.5.0-preview.129`.

The release tag resolves to that exact main commit. The package was promoted
without rebuilding from the formal main `gated-tarball` artifact 11689412711;
all build/install/pin/docs gates passed. npm accepted upload but its subsequent
visibility check failed. Upload readback and anonymous public download both
matched the hash above on 2026-10-11 12:46 UTC+08. This is not a PR artifact.

The URL and hash are constants, not remote configuration. Downloads have a
60-second timeout and a 16 MiB limit, and only verified bytes reach npm. A hash
error is reported; the downloaded bytes are never installed. Permission errors
do not trigger this alternative download. No global npm package or public
dist-tag is changed. The temporary `.tgz` is removed after installation attempt.

Startup remains the existing `local_daemon.rs` installer/launcher. Its private
prefix, original daemon stop check, identity reuse, exact runtime pairing,
installed-version check and Hub readiness check are unchanged. No new service,
port, proxy, token, credential store or environment variable is introduced.
Profiles and account credentials remain private local state, not in this repo.

Recovery: obtain the immutable URL and verify the fixed hash before using the
package with the documented private prefix. Preserve local profile/state from
encrypted backups; cloning the repo does not restore user accounts. Desktop
upgrade/rollback follows `docs/desktop-release-sop.md`; this fallback is not a
reason to reinitialize an existing daemon or replace its token. For future CLI
versions, publish and anonymously verify the new exact main tarball before
updating the package constant, URL, hash and tests together.

0.2.236 is the candidate carrying this installer change. CLI publication alone
does not prove that 0.2.236 has passed signing, been published, or reached mirrors.
