# Node detail Provider switching (#906)

The Codex co-presence node detail uses the existing daemon Provider catalog
and `daemon_provider_snapshot` apply/receipt transport. The node id is fixed
to the opened node: Provider, authentication profile and model remain explicit
choices. This replaces the disabled launcher model control and demo-only
Provider form for `codex-app-server` / `codex-tui`, including chat node-info.
Other runtimes retain their existing model controls.

The source daemon is the Hub lifecycle binding or active adoption. A matching
hostname, pending adoption or local discovery is not an ownership binding.
An unbound node explains the missing binding and links to its overview; that
link does not itself adopt the node. The daemon must return the target in its
bound inventory with a configuration revision before an apply is available.
Only an explicit confirmation submits, and only the existing matching runtime
receipt confirms application. Configuration readback is not proof of real
OAuth entitlement or a successful paid model request.

This UI does not implement source collection, a new account authorization flow
or creation with a Provider. Those differences remain under the original #906.
No node is changed merely by opening this page or selecting values.

## Deployment and recovery

No new service, port, proxy, environment variable or client secret store is
introduced. Existing Hub/Daemon deployment authorities remain unchanged;
secrets remain in the daemon's existing private Provider store and account
custody. Rebuild the client from a merged exact main SHA using
`docs/desktop-release-sop.md`; the previous formal installer is the client
rollback. This UI alone changes no daemon data, so rollback does not roll back
Provider state. That state and account credentials require the established
identity-matched encrypted data backup, not a Git clone. No empty-machine
production recovery or real-account login claim is made by the UI fixture.
