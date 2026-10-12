# Create a Codex node with a Daemon-managed Provider (#906)

The actual create wizard offers two explicit modes for Codex TUI co-presence:
follow the existing host configuration (unchanged), or choose a profile already
saved in the selected Daemon. Managed mode selects Provider, API-key profile
and configured model; dependent fields reset when their parent changes. The
request contains only the exact catalog revision and identifiers in
`node_spec.flags.daemonProvider`; no key or endpoint is sent by this wizard.
The selected model is shown in confirmation and overrides stale suggestions.

Backend companion: https://github.com/sleep2agi/agent-network/pull/2600 . The
Daemon initializes private configuration before first launch. An older Hub or
Daemon rejects the new flag; the client must not silently remove it and retry.
This branch has no published minimum-version claim. Formal rollout requires
the companion merged and released, then compatible Hub/CLI/runtime software.
Saved ChatGPT accounts are not copied into fresh nodes by this API-key flow.
Existing accounts remain managed through the existing explicit login paths.

## Reuse a scanned API-key source during creation (#905 continuation)

Choose the managed-profile mode, then explicitly select a Codex API-key source
already bound to this Daemon. Review and confirm collection: the existing
`daemon_provider_snapshot` collect contract reads the key only on that machine
and saves a private profile. A matching source/model/revision receipt fills the
Provider, key-profile and model selections without asking for the key again.
This is not node creation. Review the form and submit the normal creation step,
which still sends only identifiers and the freshly saved catalog revision.

Selection or cancellation performs no collection or node write. A failed or
unknown receipt leaves the creation profile unset; refresh to inspect, without
automatic retries or a silent default model. Source nodes and sessions are
unchanged. ChatGPT node credentials and unbound local discoveries are not
collection sources; use the existing explicit managed-login paths instead.
Configured models are not a claim of verified vendor access.

The client248 screenshot reported by the user predates this creation shortcut.
This source slice is not a published installer or a production Provider change.
Core creation coverage is included in the existing provider-collection Docker
workflow using `CORE_CREATE_COLLECTION=1`; default collection assertions stay.
No new service, port, secret source or schema is added. Collected private
profiles persist on the selected Daemon and use its identity-matched protected
backup; downgrading a client does not remove a confirmed collection.

Deployment/recovery: this adds no service, listener or secret store. Rebuild
the normal client from exact merged main SHA using its formal release workflow;
retain the previous installer for rollback. Hub URL and user credentials use
existing client profiles. Keys come only from the owning Daemon's private
store; recover profiles/credentials from authorized protected backups, not
Git. The backend's `docs/daemon-provider-creation.md` records startup scripts,
ports, secret sources, upgrade verification, rollback and private data scope.
Client rollback does not undo Daemon node configuration or session data.

Bounded Docker suite: `tests/provider-create/Dockerfile`, core before actual
Expo-exported wizard. Synthetic Hub responses are not real node launch, OAuth,
model entitlement or inference proof. A pending create receipt is never
reported as a running child. No complete disaster-recovery claim.
