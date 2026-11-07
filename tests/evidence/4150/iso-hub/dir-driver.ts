// Real client body builders (imported from the shipped client tree) + real HTTP
// against the isolated Hub. Not a UI click-path: this exercises the exact request
// shape the UI sends, not the React components.
import { readFileSync } from "node:fs";
import { buildDirectoryBody, buildDirectorySelectBody, validateDirectoryRequest, parseDirectoryResponse } from "/tmp/opencode/app-4130-modelline/src/session-source-directory";

const reg = JSON.parse(readFileSync("/tmp/opencode/reg.json", "utf8"));
const base = "http://127.0.0.1:8899";
const auth = { authorization: `Bearer ${reg.token}`, "content-type": "application/json" };
const sel = { networkId: reg.network_id, sourceNodeId: "p_source", daemonNodeId: "p_daemon" };

const v = validateDirectoryRequest(sel);
console.log("client validate:", JSON.stringify(v));
const body = buildDirectoryBody(sel);
console.log("client body keys:", Object.keys(body).sort().join(","));

async function main() {
  const post = await fetch(`${base}/api/node-session-control/source/directory`, {
    method: "POST", headers: auth, body: JSON.stringify(body),
  });
  const created = await post.json() as any;
  console.log("POST status:", post.status, "keys:", Object.keys(created).sort().join(","));
  console.log("POST body:", JSON.stringify(created).slice(0, 400));
  const id = created?.request_id;
  if (!id) return;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await fetch(`${base}/api/node-session-control/source/directory/${encodeURIComponent(id)}?network_id=${encodeURIComponent(reg.network_id)}`, { headers: auth });
    const b = await r.json() as any;
    console.log(`poll ${i + 1}:`, r.status, b?.status ?? "?", (b?.snapshot_id ?? ""), (b?.servers ? `servers=${b.servers.length}` : ""), (b?.error ?? ""));
    if (b?.status === "ready" || b?.status === "failed") {
      console.log("ready/failed body:", JSON.stringify(b).slice(0, 600));
      const snap = b?.snapshot;
      if (b?.status === "ready" && snap?.servers?.length) {
        const sb = buildDirectorySelectBody(sel, snap.servers[0].server_id, id);
        const r2 = await fetch(`${base}/api/node-session-control/source/directory`, { method: "POST", headers: auth, body: JSON.stringify(sb) });
        const c2 = await r2.json() as any;
        console.log("select POST:", r2.status, JSON.stringify(c2).slice(0, 300));
        const id2 = c2?.request_id;
        for (let j = 0; j < 12 && id2; j++) {
          await new Promise(r => setTimeout(r, 1000));
          const r3 = await fetch(`${base}/api/node-session-control/source/directory/${encodeURIComponent(id2)}?network_id=${encodeURIComponent(reg.network_id)}`, { headers: auth });
          const b3 = await r3.json() as any;
          console.log(`select poll ${j + 1}:`, r3.status, b3?.status ?? "?", b3?.error ?? "");
          if (b3?.status === "ready" || b3?.status === "failed") {
            const parsed = parseDirectoryResponse(b3, id2);
            console.log("select body:", JSON.stringify(b3).slice(0, 500));
            console.log("client parse:", parsed.kind, parsed.kind === "ready" ? `projects=${parsed.snapshot.projects.length} sessions=${parsed.snapshot.sessions.length} servers=${parsed.snapshot.servers.length} selExp=${parsed.snapshot.selectionExpiresAt}` : "");
            break;
          }
        }
      }
      break;
    }
  }
}
main().catch(e => { console.log("driver error:", e?.message || e); process.exit(1); });
