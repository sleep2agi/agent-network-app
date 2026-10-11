# Hub Provider client — real configuration, implementation slice

Both server-side Provider navigation paths now render
`HubProviderManagementScreen`, not the in-memory demo. Other pending Hub pages
keep their existing behavior. Configuration is scoped to the active Hub URL,
network and signed-in identity; navigation clears the old page and private input.

The owner enters a Provider id/label, explicit protocol, HTTPS endpoint, configured
models and API key, then saves to the Hub vault. Metadata receipt pins network,
provider id and revision; the key field clears when submitting. Credentials are
not persisted in client settings or displayed in readback. The save request uses
the existing no-redirect secret transport. A bounded wait is unconfirmed, not a
successful save or proof of remote rollback.

Distribution is a separate action: select a source and online daemons, review,
then confirm. “All online” selects candidates only; it sends no request itself.
Each selected daemon first reports its catalog revision, then receives a CAS
request. Only its exact redacted Provider/model receipt counts as distributed.
The UI records results separately; it does not automatically apply/restart nodes.
Existing nodes use the separate #906 Daemon Provider application control.

This first adapter distributes Codex TUI/OpenAI Responses profiles. Saving a
Chat Completions/Anthropic catalog entry does not make it compatible with Codex.
Other runtime adapters, always-live inherited bindings and automated rotation are
not complete. A configured model is not proof of entitlement or inference.

## Deployment and recovery

No new service/port/tunnel or client data store is added. Build and publish only
from exact merged main SHAs through the existing desktop/Android workflows; branch
exports and Docker screenshots are TEST ONLY. This slice is not in client240.
The Hub must support `daemon_provider_snapshot` actions `hub_read`, `hub_put`
and `hub_bind`; no published minimum version is
invented before the backend release. Without a valid read result the page shows
unconfirmed and refuses key submission, rather than presenting synthetic rows.

Hub credentials and catalog recovery follow agent-network's
`docs/hub-provider-management.md` and `deploy/hub/README.md`; daemon startup,
software pair verification/rollback and private catalog backups retain the
existing deployment authority. Restoring Git alone does not restore keys, Hub
data or installed daemon catalogs. Client rollback uses the prior signed exact-
main installer; it must not delete distributed keys as an assumed rollback.

Core Docker parser/typecheck and actual exported React/synthetic Hub drive live
under `tests/hub-provider-management/`. This is not native-package, real Hub,
live login or model-call evidence; formal release gates remain independent.
