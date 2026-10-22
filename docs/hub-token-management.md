# Hub token vault management

This is the current network's API-key vault, not Hub login/node identity token administration. Both the Hub sidebar and server-management token tab use `HubTokenManagementScreen`; demo fixtures remain test-only.

The client calls the existing authenticated MCP tools `list_network_secrets` (names only, network members) and `upsert_network_secret` (network owner only). Names follow `[A-Z][A-Z0-9_]{0,63}`. Values are write-only and are cleared from the form when submitting. A successful save requires the Hub receipt for the same key and a subsequent names-only read. TLS or loopback HTTP is required for secret writes, using the existing no-redirect Provider transport. Unsupported, permission-denied and failed calls do not create local placeholder entries.

This first slice supports adding and replacing, not deleting or retrieving values. It does not automatically distribute keys, rotate already distributed daemon copies, switch nodes or establish provider/model entitlement. Reusing a saved vault name in the newer Hub Provider catalog is a follow-up under Hub #907/#1020, not an implemented claim.

## Rebuild and recovery

- Source: this repository, its lockfile and `tests/test1020-hub-tokens/Dockerfile`. The app has no new resident service, port, reverse proxy, environment variable or local credential store.
- The Hub's existing service launcher, ports and encrypted-vault key source remain authoritative in the backend deployment documentation; this UI does not deploy or change them. Never recreate the vault master key to solve a client error.
- Verify a version using its release SHA and the actual app version. Check the names-only list and an isolated synthetic save before installation; do not use production key values as test fixtures.
- Software rollback is the previous signed client version. It does not roll back vault writes. Restoring vault values requires the Hub database's encrypted backup **and** its original master-key source; cloning this client repository supplies neither production data nor secrets.
- No machine-local script or private file is a required input for rebuilding this UI. Docker checks cover the core and exported React page, not a signed native installation or every runtime's actual model access.
