import { chromium } from "/home/vansin/agent-network-dashboard/node_modules/playwright/index.mjs";
const UI="http://127.0.0.1:8930/", HUB="http://127.0.0.1:8899";
const b=await chromium.launch({args:["--no-sandbox"]}); const p=await b.newPage();
await p.goto(UI,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(2000);
const i=p.locator("input"); await i.nth(0).fill(HUB); await i.nth(1).fill(process.env.ISO_USER); await i.nth(2).fill(process.env.ISO_PASS);
await p.getByText("登录工作区").first().click(); await p.waitForTimeout(5000);
const out = await p.evaluate(async (hub) => {
  const all = Object.entries(localStorage).map(([k,v]) => [k, v]);
  let token = null;
  for (const [k,v] of all) { if (/^utok_|^tok_/.test(v)) token = v; else { try { const j = JSON.parse(v); const s = JSON.stringify(j); const m = s.match(/"(?:token|access_token)":"((?:utok|tok)_[A-Za-z0-9_]+)"/); if (m) token = m[1]; } catch {} } }
  if (!token) return { error: "no token" };
  const me = await fetch(`${hub}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());
  const net = me?.current_network?.network_id || me?.current_network?.id || me?.networks?.[0]?.network_id || me?.networks?.[0]?.id;
  const body = { network_id: net, source_node_id: "p_source", daemon_node_id: "p_daemon" };
  const r1 = await fetch(`${hub}/api/node-session-control/source/directory`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j1 = await r1.json();
  const poll = async (id) => { for (let k = 0; k < 15; k++) { await new Promise(r => setTimeout(r, 1000)); const r = await fetch(`${hub}/api/node-session-control/source/directory/${id}?network_id=${encodeURIComponent(net)}`, { headers: { authorization: `Bearer ${token}` } }); const j = await r.json(); if (j.status !== "pending" && j.status !== "claimed") return j; } return null; };
  const d1 = await poll(j1.request_id);
  const server = d1?.snapshot?.servers?.[0]?.server_id;
  let sel = null;
  if (server) {
    const b2 = { ...body, server_id: server, selection_scope: j1.request_id };
    const r2 = await fetch(`${hub}/api/node-session-control/source/directory`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b2) });
    const j2 = await r2.json();
    const d2 = await poll(j2.request_id);
    sel = { postStatus: r2.status, post: j2.status ?? j2.error, final: d2?.status, projects: d2?.snapshot?.projects?.length ?? null, sessions: d2?.snapshot?.sessions?.length ?? null, selExp: d2?.snapshot?.selection_expires_at ?? null };
  }
  return { netCarrier: Object.keys(me.current_network || {}), first: { status: r1.status, s: j1.status ?? j1.error, final: d1?.status, servers: d1?.snapshot?.servers?.length ?? null }, sel };
}, HUB);
console.log(JSON.stringify(out).slice(0, 900));
await b.close();
