# Local workspace lifecycle and data

Agent Network Desktop can manage a bundled, version-pinned CommHub for users
who do not already have a server. Choose **开始使用（本地）** on first run. The
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

Package removal behavior still requires a signed clean-machine test on both
platforms before the local-workspace feature is published as stable.
