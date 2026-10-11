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
