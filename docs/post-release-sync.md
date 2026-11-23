# Automatic post-release channel synchronization

`post-release-sync.yml` starts on a published release and explicitly dispatches the
desktop mirror, Android mirror gate and Hub fallback generator. Its manual recovery
entry takes `tag=desktop-vX.Y.Z`. It does not publish a draft or merge a fallback PR.

Before enabling, provision repository secret `HUB_ACTIONS_TOKEN`: a fine-grained
credential with Actions write access to `sleep2agi/agent-network`. The ordinary
repository token cannot dispatch a workflow in that separate repository. A missing
credential fails visibly. Never put the token in source or chat.

GitHub suppresses workflow events emitted with `GITHUB_TOKEN`. A publisher using
that token must explicitly dispatch `post-release-sync.yml` after publishing;
PAT/human publication emits the ordinary published event. Existing manual release
publication is retained. The orchestration must be merged to main before use.

Guards: published stable release, full source SHA on main ancestry, exactly one
canonical version-named APK with GitHub digest, latest release identity. Historical
release recovery uses the existing individual workflows, not this latest-channel
orchestrator. Version-scoped concurrency and the existing child workflow locks
serialize retries. Dispatch acceptance is never reported as channel success.

Success requires four exact public version pointers, streamed Android APK SHA256
matching the canonical release, and the existing full release verifier. A fallback
PR awaiting review remains waiting/red; review policy is unchanged. Evidence is
uploaded even after timeout. Cross-repository creation policy can still require a
human to create the PR from the generated branch.

Rollback: disable this workflow, then use the existing mirror and fallback manual
dispatch entries. No published asset is deleted or overwritten by this controller.
Secrets and network publishing are not exercised by local tests. Before acceptance,
use a genuine new release to validate event delivery, cross-repository permission,
child failures and public convergence; do not claim the offline tests prove delivery.
