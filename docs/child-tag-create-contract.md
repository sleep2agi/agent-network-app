# Child Tag Creation

Contract: Hub PR2935, final head `ab22d16a8`, merged as `9cc7f801`.
Hub `.148` is reported deployed with `tag_tree`; older Hubs without the explicit
capability remain unsupported. Client deployment is separate from Hub deployment.
This frontend does not change backend or production data.

## Capability And Rights

`GET /api/requirements` capabilities must contain `tag_tree` to enable creation.
Existing `tag_ops` and catalog `can_manage: true` still gate editing rights.
Read-only parents, nodes or legacy `tag_entities` never imply write capability.
There is no `can_create`, stable tag ID or `tag_entity` creation protocol.

Old Hubs hide creation actions, retaining existing flat tag operations.
Backend permits owner/admin/task_access_all; node tokens are denied (403).

## Atomic Protocol

```http
POST /api/requirements/tags/create?network_id=<encoded network ID>
Authorization: Bearer <existing Hub token>
Content-Type: application/json

{"name":"Child label","parent_id":"Parent label"}
```

`parent_id` is a TAG NAME, or explicit `null` for root creation. No tag IDs.
The frontend requires HTTP 201 and this receipt:

```json
{"ok":true,"tag":{"name":"Child label","parent_id":"Parent label","depth":2},"parent_registered":false}
```

Roots have depth 1, maximum depth is 4. Name/parent must exactly match the
request, depth must match the known parent (a card-only legacy parent is a root),
and parent_registered must be boolean. A legacy card-only parent can be
atomically registered as root with parent_registered:true; its child remains
attached. No create-then-patch, implicit root fallback or automatic replay.

Errors: 409 tag_exists; 404 tag_parent_not_found; 400 invalid_tag_parent_id;
400 tag_parent_cycle, invalid_tag, tag_depth_exceeded;
403 permission_denied or user_token_required. Unconfirmed/invalid receipts and
transport failures leave the dialog open without publishing success. Names
trim to 1-20 Unicode code points, reject controls and case-sensitive duplicates.

## Catalog And UI

GET tags retains tags/counts/colors/can_manage and adds nodes:

```json
{"nodes":[{"name":"Child label","parent_id":"Parent label","depth":2,"registered":true,"count":0}]}
```

The frontend preserves nodes, folds their name-keyed parents and counts into
the catalog, and converts root depth 1 to display indentation 0. Existing
parents/tag_entities read compatibility remains; no IDs are required to create.

Only explicitly registered nodes are added to sidebar card-derived tags, so
zero-task hierarchies remain discoverable after selection changes without
exposing every unused historical tag. A confirmed create receipt updates the
catalog and exact child selection together, then rereads GET tags; a lagging
immediate read cannot erase that confirmed child. Rename/merge/delete reread
the catalog because the backend owns hierarchy maintenance.

Creation uses DialogFrame keyboard avoidance, scrollable body and fixed footer.
Enter/button submission is ref-guarded against duplicate in-flight writes.
Management also offers explicit root creation; existing-tag reparenting is not
included. No ordinary task-card tag editing API is changed.

## Verification

`src/task-tag-create.test.ts` mocks fetch only: exact scoped request, capability
and rights, legacy parent registration, empty registered nodes, errors, strict
201 receipts and dialog/store/sidebar wiring. Related source tests cover menu,
catalog and tree behavior. Builds and desktop/mobile visual checks belong to
the parent agent; no live write is needed.
