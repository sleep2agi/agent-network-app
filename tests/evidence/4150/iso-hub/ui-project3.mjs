import { chromium } from "/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs";
const UI = "http://127.0.0.1:8930/", HUB = process.env.HUB_URL || "http://127.0.0.1:8899";
const b = await chromium.launch({ args: ["--no-sandbox"] }); const p = await b.newPage();
await p.goto(UI, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2000);
const i = p.locator("input");
await i.nth(0).fill(HUB); await i.nth(1).fill(process.env.ISO_USER); await i.nth(2).fill(process.env.ISO_PASS);
await p.getByText("登录工作区").first().click(); await p.waitForTimeout(5000);

const out = await p.evaluate(async ([hub, CHILD]) => {
  let token = null;
  for (const [k, v] of Object.entries(localStorage)) {
    if (/^utok_|^tok_/.test(v)) token = v;
    else { try { const m = JSON.stringify(JSON.parse(v)).match(/"(?:token|access_token)":"((?:utok|tok)_[A-Za-z0-9_]+)"/); if (m) token = m[1]; } catch {} }
  }
  if (!token) return { error: "no token" };
  const me = await fetch(`${hub}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
  const net = me?.current_network?.network_id || me?.current_network?.id || me?.networks?.[0]?.network_id || me?.networks?.[0]?.id;
  const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const base = { network_id: net, source_node_id: "p_source", daemon_node_id: "p_daemon" };
  const poll = async (path, id) => { for (let k = 0; k < 25; k++) { await new Promise(r => setTimeout(r, 1000)); const r = await fetch(`${hub}${path}/${id}?network_id=${encodeURIComponent(net)}`, { headers: { authorization: `Bearer ${token}` } }); const j = await r.json(); if (!["pending", "claimed", "create_pending", "accepted"].includes(j.status)) return j; } return null; };

  const r1 = await fetch(`${hub}/api/node-session-control/source/directory`, { method: "POST", headers: H, body: JSON.stringify(base) });
  const j1 = await r1.json(); const d1 = await poll("/api/node-session-control/source/directory", j1.request_id);
  const server = d1?.snapshot?.servers?.[0]?.server_id;

  const r2 = await fetch(`${hub}/api/node-session-control/source/directory`, { method: "POST", headers: H, body: JSON.stringify({ ...base, server_id: server, selection_scope: j1.request_id }) });
  const j2 = await r2.json(); const d2 = await poll("/api/node-session-control/source/directory", j2.request_id);
  const proj = d2?.snapshot?.projects?.[0]?.project_id;

  const b3 = { selection_scope: j2.request_id, snapshot_id: d2?.snapshot?.snapshot_id, project_id: proj, child_name: CHILD, intent_id: "sv-intent-" + Date.now().toString(36) };
  const r3 = await fetch(`${hub}/api/node-session-control/source/project-create`, { method: "POST", headers: H, body: JSON.stringify(b3) });
  const j3 = await r3.json();
  const d3 = await poll("/api/node-session-control/source/project-create", j3.request_id);
  return {
    dir: { post: r1.status, status: j1.status ?? j1.error, final: d1?.status, servers: d1?.snapshot?.servers?.length ?? null },
    sel: { post: r2.status, status: j2.status ?? j2.error, final: d2?.status, projects: d2?.snapshot?.projects?.length ?? null, selExp: d2?.snapshot?.selection_expires_at ?? null },
    create: { post: r3.status, status: j3.status ?? j3.error, final: d3?.status, kind: d3?.operation_kind, creation: d3?.session_creation, child: d3?.child_node_id ?? null },
  };
}, [HUB, process.env.CHILD || "sv-child-1"]).catch(e => ({ err: String(e?.message||e) }));
console.log(JSON.stringify(out).slice(0, 900));
await b.close();
