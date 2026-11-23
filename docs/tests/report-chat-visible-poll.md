# Chat polling, stage 1 (base 0ba13fbb)

One mounted chat, quiet network, warm steady-state minute, no retries, events or navigation. Per 5 s: `GET /api/tasks?to_name=…` and `GET /api/messages?scope=user` start together; successful inbound starts `GET /api/tasks?from_name=…`. Both task reads use `skip_stats=1`. The inbox reads 50 normally, 200 on cold start / 10 minute resync and falls back to 200 if the 50 do not overlap. The two header status reads run separately every 30 s. Navigation away unmounts the screen. Excludes global notification/other panes, send/retry, one-time identity lookup and explicit history navigation.

`bun tests/chat-poll-ledger.mjs`: synthetic loopback transport, virtual time, response body bytes only. Both directions deliberately use the supplied 114,000 / 691,000 bytes for 30 / 200 tasks respectively; inbox fixture 19,000 bytes, status fixtures 1,000 bytes. Not a packet capture from Android. A sparsely populated outbound direction will save fewer bytes. No Hub ETag assumed.

| Scenario | Before: requests / bytes per min | After: requests / bytes per min |
|---|---:|---:|
| 30 loaded, foreground | 40 / 2,968,000 | 40 / 2,968,000 |
| 200 loaded, foreground | 40 / 16,797,000 | 40 / 4,122,000 |
| Mounted background, JS timers allowed | 4 / 4,000 | 0 / 0 |

Of 40 reads, 12 are inbound, 12 outbound, 12 inbox and 4 header status. After expansion, 11 rounds read 30, the twelfth reads the loaded window (Hub cap 200); this replaces a tick, not an additional burst. OS suspension can also eliminate the old header reads. Slow rounds defer subsequent polls. On resume the foreground subscription triggers the initial read; the per-conversation lock includes the outbound tail. Native lock screen uses the OS AppState transition; web uses document visibility. Physical lock/unlock not measured here.

The shared GET path already sends If-None-Match when a prior response at that exact scoped URL had an ETag. Server rollout is independent. Focus/explicit history reads may request larger pages, but do not change ordinary poll limits. SSE reconciliation, gaps >30, and stopwatch measurements of the long-table conversation belong to stage 2.
