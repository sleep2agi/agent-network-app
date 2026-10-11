# Explicit collection of existing Codex API-key configuration (#906)

The client adds a separate **Collect an existing API-key profile** card in the
daemon Provider panel. Refresh the inventory, explicitly choose a bound Codex
node, review the Provider/profile IDs and label, then confirm. The source is not
modified or restarted. The resulting profile is selectable in the existing
Provider/auth/model application card; application remains a separate confirmed
operation. Configured models are not proof of inference rights.

Only versioned, Hub-bound `codex-app-server` API-key configurations qualify.
Locally discovered unbound nodes and ChatGPT logins are not collection sources.
An occupied profile ID cannot be overwritten; choose a different ID instead.
The Hub receives source identity, configuration revision and destination IDs,
never the key or filesystem path. The daemon reads the source credential locally.

Protocol: `daemon_provider_snapshot` action `collect`, with the current managed
store `revision` and `provider={node_id,alias,node_revision,provider_id,auth_id,label}`.
Readback must match the daemon/network, revision+1, selected profile and exact
configured model before the UI reports a confirmed save. Leaving the scope stops
observation, not the remote operation; refresh an unconfirmed result rather than
blindly submitting again.

The matching backend is agent-network PR2599 plus its previously merged local
collection implementation (PR2598). These are source coordinates, not released
version claims. The older published read/apply pair shown elsewhere in the panel
does not establish collection support. This source change is not publicly usable
until the matching backend and client are formally released from exact main SHAs.

## Recovery coordinates

1. Startup/install: use the repository desktop release SOP and existing client
   installation instructions. This change adds no service or private launcher.
2. Ports/proxy: the configured Hub `/mcp` endpoint is reused, with no new port,
   tunnel or reverse-proxy rule. Remote writes require HTTPS; HTTP loopback is
   allowed. No TLS verification bypass is introduced.
3. Secrets: the client uses the existing human Hub session. Source keys stay in
   the daemon's protected source and managed store, not Git or a client export.
4. Upgrade/verification: publish only merged exact-main builds per the release
   SOP; confirm explicit collection and scoped readback before applying a profile.
5. Rollback: reinstall a previously published client. Do not remove or overwrite
   the daemon Provider store; a client rollback does not undo collected profiles.
6. Data: the local daemon credential store and existing node sessions require the
   documented protected data backup. Cloning this repository restores neither.

Core verification is in `tests/provider-collection/Dockerfile` and
`docs/tests/report-test906-client-collection.txt`. The exported browser uses a
synthetic Hub; it is not native installer, live OAuth or provider-entitlement proof.
