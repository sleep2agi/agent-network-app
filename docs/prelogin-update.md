# Login-independent software updates (#1018)

On macOS/Windows, both the first-run local workspace page and Hub login page expose
the current app version and a manual **检查更新** button. Android exposes the same
button on the login page. Hub address, username and password may remain empty;
checking does not create or authenticate a Hub account. Web/iOS keep a version label
without offering an unsupported desktop updater.

The entry component is `src/PreloginUpdateCheck.tsx`, mounted by `App.tsx`. It uses
the existing desktop/Android update stores, result descriptions and root update
prompts. Existing public update sources, signatures, APK hashes, installation and
restart behavior remain unchanged. Errors offer retry; checking/downloading state
uses the existing actionability rules. No daemon/server service or port changes.

## Build, verify and recover

Use the repository lockfile and `tests/test1018-prelogin-update/Dockerfile`:

```
sg docker -c 'docker build --target core -t anet-app:test1018-core -f tests/test1018-prelogin-update/Dockerfile . && docker run --rm --init --network none anet-app:test1018-core'
sg docker -c 'docker build --target browser -t anet-app:test1018-ui -f tests/test1018-prelogin-update/Dockerfile . && docker run --rm --init --network none anet-app:test1018-ui'
```

Bases are pinned public images; no prior local image, global npm install, Hub secret
or production fixture is required. The exported UI test uses synthetic native
updater IPC and empty account storage; it is not a signed native installation test.
Results are recorded in `docs/tests/report-test1018-prelogin-update.txt`.

Publish only from an exact main ancestor through the existing signed desktop and
Android release workflows. Signing/mirror credentials stay in their existing
protected CI secret sources, never in the login form. Users install the public
version and can confirm its version before logging in. Roll back using the prior
official main-built installer; this change adds no account storage or migration.
Existing Hub/account data still requires its existing backup or fresh login and is
not contained in a Git clone. It neither repairs nor replaces lost credentials.
