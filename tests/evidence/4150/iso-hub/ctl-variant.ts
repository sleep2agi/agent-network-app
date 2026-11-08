// Runs INSIDE the READY container (no browser, no CORS): proves whether the
// runtime/backend can apply same-child variant high then clear, as a control.
import { readFileSync } from "node:fs";
const op = JSON.parse(readFileSync("/state/operator.json", "utf8"));
const ready = JSON.parse(readFileSync("/state/ready.json", "utf8"));
const HUB = ready.hub_url, net = ready.network_id;
const stamp = Date.now().toString(36);
const H = { authorization: `Bearer ${op.human_token}`, "content-type": "application/json" };
const D = "/api/node-session-control/source/directory", P = "/api/node-session-control/source/project-create";
const sel = { network_id: net, source_node_id: ready.source_node_id, daemon_node_id: ready.daemon_node_id };
const TERM = { [D]: ["ready", "failed"], [P]: ["registration_confirmed", "unknown_rotation_required", "refused", "failed"] };
const poll = async (path, id) => { for (let k = 0; k < 30; k++) { await new Promise(r => setTimeout(r, 1000)); const r = await fetch(`${HUB}${path}/${id}?network_id=${encodeURIComponent(net)}`, { headers: H }); const j = await r.json(); if ((TERM[path] || []).includes(j.status)) return j; } return null; };
const post = async (path, body) => { const r = await fetch(HUB + path, { method: "POST", headers: H, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

const d1 = await post(D, sel); const r1 = await poll(D, d1.body?.request_id);
const d2 = await post(D, { ...sel, server_id: r1?.snapshot?.servers?.[0]?.server_id, selection_scope: d1.body?.request_id });
const r2 = await poll(D, d2.body?.request_id);
const snap = r2?.snapshot;
const childName = "ctl-var-" + stamp;
const d3 = await post(P, { selection_scope: d2.body?.request_id, snapshot_id: snap?.snapshot_id, project_id: snap?.projects?.[0]?.project_id, child_name: childName, intent_id: "ctl-" + stamp });
const r3 = await poll(P, d3.body?.request_id);
const child = r3?.child_node_id;
const out = { dir: r1?.status, select: r2?.status, create: r3?.status, child, steps: [] };
if (!child) { console.log("CTL:", JSON.stringify(out)); process.exit(0); }

const cfg = async () => await fetch(`${HUB}/api/nodes/${encodeURIComponent(child)}/config`, { headers: H }).then(r => r.json());
const patchVariant = async (value) => {
  const c0 = await cfg();
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_node_config", arguments: { node_id: child, base_revision: c0.config_revision, patch: { modelVariant: value }, network_id: net } } };
  const r = await fetch(`${HUB}/mcp`, { method: "POST", headers: { ...H, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" }, body: JSON.stringify(body) });
  const text = await r.text();
  let updateId = null;
  try { const j = JSON.parse(text); const inner = j?.result?.content?.[0]?.text; updateId = inner ? JSON.parse(inner).update_id : null; } catch {}
  out.lastMcp = (out.lastMcp || []); out.lastMcp.push(text.slice(0, 260));
  for (let k = 0; k < 20; k++) {
    await new Promise(res => setTimeout(res, 1000));
    const c = await cfg(); const lu = c?.last_update;
    if (lu && (updateId ? lu.update_id === updateId : true) && lu.status === "applied")
      return { http: r.status, update: updateId ? "matched" : "no-id", applied: true, modelVariant: c.modelVariant ?? null, model: c.model ?? null };
  }
  return { http: r.status, update: updateId ? "matched" : "no-id", applied: false };
};
out.steps.push({ step: "high", ...(await patchVariant("high")) });
out.steps.push({ step: "clear", ...(await patchVariant(null)) });
console.log("CTL:", JSON.stringify(out));
