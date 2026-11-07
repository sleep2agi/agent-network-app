// Chain 2: client project-create body (real client module) -> real isolated Hub
// -> daemon project worker -> synthetic resume child registration.
import { readFileSync } from "node:fs";
import { buildDirectoryBody, buildDirectorySelectBody, parseDirectoryResponse } from "/tmp/opencode/app-4130-modelline/src/session-source-directory";
import { buildProjectCreateBody, validateProjectCreateSelection } from "/tmp/opencode/app-4130-modelline/src/session-project-create";

const reg = JSON.parse(readFileSync("/tmp/opencode/reg.json", "utf8"));
const base = "http://127.0.0.1:8899";
const auth = { authorization: `Bearer ${reg.token}`, "content-type": "application/json" };
const sel = { networkId: reg.network_id, sourceNodeId: "p_source", daemonNodeId: "p_daemon" };
const poll = async (path: string) => {
  const r = await fetch(`${base}${path}?network_id=${encodeURIComponent(reg.network_id)}`, { headers: auth });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const wait = async (requestId: string, prefix: string) => {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const p = await poll(`${prefix}/${encodeURIComponent(requestId)}`);
    if (p.body?.status && !["pending", "claimed"].includes(p.body.status)) return p;
  }
  return null;
};

const created = await fetch(`${base}/api/node-session-control/source/directory`, { method: "POST", headers: auth, body: JSON.stringify(buildDirectoryBody(sel)) });
const c1 = await created.json() as any;
const r1 = await wait(c1.request_id, "/api/node-session-control/source/directory");
const snap = parseDirectoryResponse(r1?.body, c1.request_id);
console.log("directory:", r1?.body?.status, "servers=", snap.kind === "ready" ? snap.snapshot.servers.length : "-");

const sPost = await fetch(`${base}/api/node-session-control/source/directory`, {
  method: "POST", headers: auth,
  body: JSON.stringify(buildDirectorySelectBody(sel, snap.kind === "ready" ? snap.snapshot.servers[0].serverId : "", c1.request_id)),
});
const c2 = await sPost.json() as any;
console.log("select POST:", sPost.status, c2?.status ?? c2?.error);
const r2 = await wait(c2.request_id, "/api/node-session-control/source/directory");
const snap2 = parseDirectoryResponse(r2?.body, c2.request_id);
if (snap2.kind !== "ready") { console.log("select not ready:", JSON.stringify(r2?.body).slice(0, 300)); process.exit(2); }
console.log("select ready: projects=", snap2.snapshot.projects.length, "sessions=", snap2.snapshot.sessions.length, "selExp=", snap2.snapshot.selectionExpiresAt);

const choice = {
  networkId: reg.network_id,
  sourceNodeId: "p_source",
  selectionScope: c2.request_id,
  snapshotId: snap2.snapshot.snapshotId,
  sessionId: snap2.snapshot.sessions[0].sessionId,
  childName: "iso-attach-1",
  intentId: "iso-intent-attach-1",
};
const v = validateProjectCreateSelection(choice);
console.log("client validate:", JSON.stringify(v));
const body = buildProjectCreateBody(choice);
console.log("client body keys:", Object.keys(body).sort().join(","));

const pPost = await fetch(`${base}/api/node-session-control/source/project-create`, { method: "POST", headers: auth, body: JSON.stringify(body) });
const c3 = await pPost.json() as any;
console.log("project-create POST:", pPost.status, JSON.stringify(c3).slice(0, 260));
const r3 = await wait(c3.request_id, "/api/node-session-control/source/project-create");
console.log("project-create final:", JSON.stringify(r3?.body).slice(0, 600));
process.exit(0);
