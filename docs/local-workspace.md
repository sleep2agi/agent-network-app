# Local workspace lifecycle and data

Agent Network Desktop can manage a bundled, version-pinned CommHub for users
who do not already have a server. Choose **创建本地工作区** on first run. The
app binds the service to `127.0.0.1`, generates credentials in the native
credential store, waits for a secured health check, and then enters the same
workspace used for remote Hubs.

## Storage

Non-secret data uses the shared application namespace:

```text
~/.anet/app/
  local-hub/
    config.json
    data/
    logs/
  profiles/
  backups/
```

Tokens and the generated bootstrap password are not written to these files.
They remain in macOS Keychain or Windows Credential Manager. Logs rotate at
2 MiB and retain one previous file.

## Shutdown and recovery

The local Hub belongs to the desktop process. Closing the app stops it; an
unexpected exit is retried with finite backoff. A live ownership lock prevents
two app instances from opening the same database. Dead-owner locks are
recovered on the next launch.

If the preferred port `9200` is occupied, the app selects a free loopback port
through `9299`, persists it, and retargets the existing local profile without
changing its identity or credential.

Before a bundled Hub version changes, the stopped data directory is copied to
`~/.anet/app/backups/`. Failed health checks or bootstrap restore the previous
data and configuration.

## Lost native credentials

The local profile's token and the generated bootstrap password live only in the
native credential store. If the store loses them (the profile still appears in
**账号与 Hub**, but switching to it used to fail with *No matching entry found in
secure storage*), the app recovers on the next local Hub start instead of asking
the user to reset data:

- token missing, bootstrap password present: the app logs in again with the
  stored password and rewrites the profile credential;
- bootstrap password missing too: with the Hub stopped and the data directory
  backed up, the app resets `local-admin`'s password directly in the local
  database (same scrypt format the Hub writes), revokes the old user tokens,
  stores the new password, then starts and logs in as usual.

Switching to **Local workspace** from Settings starts the local Hub first (and
runs this recovery) before the profile becomes active. Local data is never
deleted by recovery; the release gate exercises it with
`--smoke-local-hub-lost-credential`.

## Backup and deletion

Settings provides **立即备份**, restart/stop, and log-folder actions. Explicit
local-data deletion requires typing the displayed confirmation. The app stops
the Hub, creates a backup, then removes only the local profile, its native
credentials, and `local-hub/`; remote profiles remain untouched.

## Uninstall and reinstall

Normal macOS or Windows application uninstall does not delete
`~/.anet/app/local-hub` or `~/.anet/app/backups`. Reinstalling the app therefore
retains local data, provided the operating-system user profile and native
credential store are also retained. Users who want a full data removal must use
**删除本地工作区数据…** in Settings before uninstalling, then remove any backups
they no longer need.

The signed release gate creates previous-version data with a real published
CommHub, upgrades it with the current packaged app, and requires the user,
node, task, and pre-migration database snapshot to survive on macOS and
Windows. It also installs the macOS app bundle and Windows NSIS package into an
empty location, provisions local data, removes the installed application,
requires the external app-data namespace to remain, reinstalls, and launches
the exact packaged binary against the retained profile and credential. This is
the release-blocking definition of uninstall/reinstall retention; explicit
**删除本地工作区数据…** remains the only supported destructive flow.
