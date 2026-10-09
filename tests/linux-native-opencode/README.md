# TEST ONLY: real V2 runtime prerequisite

This independent Docker suite layers onto the accepted native daemon UI image.
It installs the actual integrity-locked `@opencode/cli@2.0.22` runtime. Only the
loopback model provider is a fixture; there is no vendor credential, production
Hub, global host install, HTTP/Tauri mock, or substituted OpenCode executable.

Prerequisites, in order: native startup/authentication, private exact package
installation, native UI daemon handoff. Then:

```sh
sg docker -c 'docker build --build-arg NATIVE_IMAGE=anet-native-daemon-ui:test --build-arg SOURCE_COMMIT=<40-char-tested-source> --build-arg DEB_SHA256=<64-char-deb-hash> -t anet-native-opencode:test -f tests/linux-native-opencode/Dockerfile .'
sg docker -c 'docker run --name native-opencode-atomic --network none --cap-drop ALL --security-opt no-new-privileges anet-native-opencode:test'
```

`atomic.py` requires runtime health, HTTP401 without authentication, a real
session's assistant reply with a provider-only marker, idle state, and exact
model transport. A second fresh container with `TEST_WRONG_MODEL=1` must fail
specifically with `AssertionError: provider model mismatch`, after the same
prerequisites. A generic process error is not an accepted negative.

CI preserves `/evidence` in the TEST-ONLY artifact, then removes the container.
Do not preserve the temporary runtime HOME or native credential store. The
Python runner stops process groups; container removal is the final cleanup
boundary. Failed prerequisite gates block dependent tests.

This suite **does not prove native UI creation or V1/V2 lifecycle**. For isolated
creation diagnosis only, `prepare.py` seeds a node-scoped provider config before
the native wizard creates `v2-native` in `/home/smoke/v2-native`. It never writes
a node identity/profile. Start the fixture provider on loopback18827, use real
native mouse input to choose OpenCode V2, explicitly accept its unsafe-tools
warning, enter `stub/stub-model`, and submit. No fixture tool calls should be
requested. Keep launch failure distinct from successful daemon registration.
The initial accepted507 package failed here because its daemon profile omitted
the private pair from `daemonExtraPath`; see `docs/tests/report-test894.txt`.

The Docker build downloads dependencies; executions are network-isolated. The
lockfile comes from backend `tests/test883-v2-portable-client/tools` at
`2d964c3533e81c2e8005f6525b69be80b754722e`, retaining only OpenCode and its optional
platform packages. `stub-model.py` provenance is recorded in its source. The
workflow builds new packages from its tested SHA; old diagnostic artifacts must
never be described as post-fix package acceptance or public releases.
