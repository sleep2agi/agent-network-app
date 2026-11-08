// Isolated-run launcher: the tree's own worker modules (session-source-transport)
// pointed at the real isolated Hub over HTTP. Production entry (agent-node/src/cli.ts)
// wires the same modules; this entry only replaces the TUI/runtime boot so the
// client -> Hub -> daemon contract can be exercised without a desktop session.
import { readFileSync } from "node:fs";
import { createSessionSourceTransportWorker } from "/tmp/opencode/iso-run/agent-node/src/runtime/session-source-transport";
import { createSessionControlPin } from "/tmp/opencode/iso-run/agent-node/src/runtime/session-control-bridge";

const reg = JSON.parse(readFileSync("/tmp/opencode/reg.json", "utf8"));
const daemon = JSON.parse(readFileSync("/tmp/opencode/nt-p_daemon.json", "utf8"));
const hubUrl = "http://127.0.0.1:8899";
const token = daemon.token;
const networkId = reg.network_id;
const nodeId = "p_daemon";
const signal = new AbortController().signal;

const pin = createSessionControlPin({
  hubUrl, token, nodeId, networkId, epoch: 0,
  currentEpoch: () => 0, currentToken: () => token, signal,
});

const worker = createSessionSourceTransportWorker({
  hubUrl,
  daemonWorkDir: "/tmp/opencode/iso-daemon",
  home: "/tmp/opencode/iso-home",
  directoryEnabled: true,
  projectEnabled: false,
  attachEnabled: false,
  forkEnabled: false,
  pin,
});

const tick = () => { void worker.tick().catch((e: any) => console.log("[worker] " + (e?.message || e))); };
tick();
setInterval(tick, 1000);
console.log("worker loop started (daemon=" + nodeId + " net=" + networkId + ")");
