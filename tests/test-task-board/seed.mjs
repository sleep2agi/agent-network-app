// Seed a THROWAWAY hub for measure.mjs (placeholder names / ids only; never point it at a real hub).
//   bun tests/test-task-board/seed.mjs <hub.db> <hub_url> <network_id> <owner_user_id> <owner_token> <member_user_id>
// Nodes go straight into sqlite (no agent process needed); requirements go through the REST API the app uses
// (POST with owner {kind,id}, PATCH column), so the seed exercises the same contract.
//   demo-node-a / demo-node-b / demo-node-c   — placeholder nodes
//   8 requirements across 需求池 / 进行中 / 完成, owners (two nodes, the tester, a second member, unassigned),
//   priorities high / normal / low, dues: one overdue, one today, a few later, some empty.
import { Database } from "bun:sqlite";
const [dbPath, hub, net, uid, token, member] = process.argv.slice(2);
if (!dbPath || !hub || !net || !uid || !token || !member) throw new Error("usage: seed.mjs <hub.db> <hub_url> <network_id> <owner_user_id> <owner_token> <member_user_id>");
if (/:9200\b/.test(hub)) throw new Error("refusing :9200 — that is the production hub port");
const db = new Database(dbPath);
const nodes = [
  { id: "node_demo_a", alias: "demo-node-a" },
  { id: "node_demo_b", alias: "demo-node-b" },
  { id: "node_demo_c", alias: "demo-node-c" },
];
for (const n of nodes) {
  db.run(`INSERT OR IGNORE INTO nodes (node_id,node_name,alias,runtime,created_at,updated_at,network_id,lifecycle_state,owner_user_id) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,'active',?)`, [n.id, n.alias, n.alias, "claude-code", net, uid]);
  db.run(`INSERT OR IGNORE INTO sessions (resume_id,alias,status,network_id,registered_at,updated_at,node_id,last_seen_at,agent) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,datetime('now'),'claude-code')`, [`res_${n.id}`, n.alias, "idle", net, n.id]);
}
db.run(`INSERT OR IGNORE INTO network_members (network_id,user_id,role,invited_by) VALUES (?,?,'member',?)`, [net, member, uid]);

const pad = (x) => String(x).padStart(2, "0");
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const A = { kind: "node", id: "node_demo_a" }, B = { kind: "node", id: "node_demo_b" }, ME = { kind: "user", id: uid }, M2 = { kind: "user", id: member };
const rows = [
  { name: "登录页支持扫码登录", priority: "high", due: day(-3), owner: A, column: "pool" },            // overdue
  { name: "整理 9 月的发版说明,补上安卓和桌面端的差异", priority: "normal", due: day(5), owner: ME, column: "pool" },
  { name: "看板卡片支持拖动换列", priority: "normal", due: "", owner: null, column: "pool" },
  { name: "修复通知在后台不弹", priority: "high", due: day(0), owner: B, column: "doing" },          // today
  { name: "设置页拆分子页面", priority: "low", due: day(12), owner: A, column: "doing" },
  { name: "Hub 升级到最新预览版并回归一遍核心流程", priority: "normal", due: day(2), owner: M2, column: "doing" },
  { name: "节点日志查看器", priority: "normal", due: day(-10), owner: B, column: "done" },
  { name: "语音输入快捷键", priority: "low", due: "", owner: ME, column: "done" },
];
const call = async (path, init) => {
  const res = await fetch(`${hub}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
};
for (const r of rows) {
  const { requirement } = await call("/api/requirements", { method: "POST", body: JSON.stringify({ name: r.name, priority: r.priority, due: r.due, assignee: "", network_id: net, ...(r.owner ? { owner: r.owner } : {}) }) });
  if (r.column !== "pool") await call(`/api/requirements/${requirement.id}?network_id=${net}`, { method: "PATCH", body: JSON.stringify({ column: r.column }) });
}
const { requirements } = await call(`/api/requirements?network_id=${net}`);
console.log(`seeded ${requirements.length} requirements`);
