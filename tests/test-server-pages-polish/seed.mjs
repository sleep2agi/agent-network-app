// Seed a THROWAWAY hub's sqlite for measure.mjs (placeholder aliases/ids only; never a real hub DB).
//   bun tests/test-server-pages-polish/seed.mjs <hub.db> <network_id> <user_id>
// 120 online nodes (so the server sidebar's 节点 badge reads 「99+」, the case in the report) and
// 30 tasks across user → node, node → user and node → node with every common status.
import { Database } from "bun:sqlite";
const [dbPath, net, uid] = process.argv.slice(2);
if (!dbPath || !net || !uid) throw new Error("usage: seed.mjs <hub.db> <network_id> <user_id>");
const db = new Database(dbPath);
const alias = (i) => `demo-node-${String(i).padStart(3, "0")}`;
for (let i = 1; i <= 120; i++) {
  const node = `node_demo_${String(i).padStart(4, "0")}`;
  db.run(`INSERT INTO nodes (node_id,node_name,alias,runtime,created_at,updated_at,network_id,lifecycle_state,owner_user_id) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,'active',?)`, [node, alias(i), alias(i), "claude-code", net, uid]);
  db.run(`INSERT INTO sessions (resume_id,alias,status,network_id,registered_at,updated_at,node_id,last_seen_at,agent) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,datetime('now'),'claude-code')`, [`res_demo_${i}`, alias(i), i % 3 === 0 ? "working" : "idle", net, node]);
}
const statuses = ["replied", "delivered", "running", "queued", "failed", "expired", "replied", "cancelled"];
for (let i = 1; i <= 30; i++) {
  const kind = i % 3; // 0 user→node, 1 node→node, 2 node→user
  const a = alias(1 + (i % 7)), b = alias(8 + (i % 5));
  const from = kind === 0 ? "tester" : a;
  const to = kind === 2 ? "tester" : kind === 0 ? a : b;
  // Relative to now so the rows read 刚刚 / N 分钟前 / N 小时前 / N 天前 (task 30 is the newest).
  const minutesAgo = [0, 2, 5, 9, 14, 20, 27, 35, 44, 54, 65, 80, 100, 130, 170, 220, 300, 400, 520, 700, 900, 1200, 1500, 1800, 2400, 3000, 3600, 4300, 5000, 6000][30 - i];
  db.run(`INSERT INTO tasks (task_id,from_name,to_name,priority,status,content,result,requires_response,created_at,network_id) VALUES (?,?,?,?,?,?,?,'reply',datetime('now', ?),?)`,
    [`task_demo_${String(i).padStart(3, "0")}`, from, to, i % 9 === 0 ? "high" : "normal", statuses[i % statuses.length], `PRIVATE-CONTENT-${i}`, i % 2 ? `PRIVATE-RESULT-${i}` : null, `-${minutesAgo} minutes`, net]);
}
console.log("seeded");
