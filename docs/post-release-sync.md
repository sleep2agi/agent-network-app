# Automatic post-release channel synchronization

`post-release-sync.yml` starts on a published release and explicitly dispatches the
Android mirror gate and Hub fallback generator. It reuses the desktop mirror's
existing release-triggered run; only if no run for this exact tag/SHA appears within
90 seconds of publication does it dispatch a recovery run. Its manual recovery
entry takes `tag=desktop-vX.Y.Z`. It does not publish a draft or merge a fallback PR.

Before enabling, provision repository secret `HUB_ACTIONS_TOKEN`: a fine-grained
credential with Actions write access to `sleep2agi/agent-network`. The ordinary
repository token cannot dispatch a workflow in that separate repository. A missing
credential does not prevent App mirror dispatch or verification. After App pointers
and APK digest converge, the job fails visibly with the exact manual Hub dispatch
command. Never put the token in source or chat.

GitHub suppresses workflow events emitted with `GITHUB_TOKEN`. A publisher using
that token must explicitly dispatch `post-release-sync.yml` after publishing;
PAT/human publication emits the ordinary published event. Existing manual release
publication is retained. The orchestration must be merged to main before use.

Guards: published stable release, full source SHA on main ancestry, exactly one
canonical version-named APK with GitHub digest, latest release identity. Historical
release recovery uses the existing individual workflows, not this latest-channel
orchestrator. Version-scoped concurrency and the existing child workflow locks
serialize retries. Before each dispatch, record the latest run ID; require a newer
main workflow_dispatch run within three minutes and save its link. Dispatch
acceptance is never reported as channel success; final public checks bind the version.

Success requires four exact public version pointers, streamed Android APK SHA256
matching the canonical release, and the existing full release verifier. A fallback
PR awaiting review remains waiting/red with its URL; review policy is unchanged.
Mirror lag and fallback-only lag have separate messages. An APK digest mismatch
fails immediately rather than retrying for 35 minutes. Evidence is
uploaded even after timeout. Cross-repository creation policy can still require a
human to create the PR from the generated branch.

Rollback: disable this workflow, then use the existing mirror and fallback manual
dispatch entries. No published asset is deleted or overwritten by this controller.
Secrets and network publishing are not exercised by local tests. Before acceptance,
use a genuine new release to validate event delivery, cross-repository permission,
child failures and public convergence; do not claim the offline tests prove delivery.

## Release checklist after activation

1. Publish the approved release; find the automatic post-release-sync run.
2. Follow its evidence links, inspect mirror jobs and review the fallback PR.
3. Require public pointers/digests and full verifier to pass, record actual timings.
4. Do **not** routinely dispatch Android publishing or the mirror gate manually.
   Only recover a failed/missing automatic run, first checking for active child runs
   to avoid publishing the same APK twice. Missing Hub credential recovery uses
   the command printed by the job. Manual fallback review/merge remains unchanged.
