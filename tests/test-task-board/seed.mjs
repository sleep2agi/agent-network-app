// Seed a THROWAWAY hub for measure.mjs (placeholder names / ids only; never point it at a real hub).
//   bun tests/test-task-board/seed.mjs <hub.db> <hub_url> <network_id> <owner_user_id> <owner_token> <member_user_id>
// Nodes go straight into sqlite (no agent process needed); requirements go through the REST API the app uses
// (POST with owner {kind,id}, PATCH column), so the seed exercises the same contract.
//   demo-node-a / demo-node-b / demo-node-c   — placeholder nodes
//   8 requirements across 需求池 / 进行中 / 完成, 负责人 (the tester, a second member) and 负责 Agent (two nodes)
//   in every combination (both, human only, agent only, neither),
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
// 40 idle placeholder nodes with no tasks: the sidebar must fold them into 「更多节点」 (owner's screenshot had ~300).
for (let i = 0; i < 40; i++) {
  const id = `node_idle_${String(i).padStart(2, "0")}`;
  db.run(`INSERT OR IGNORE INTO nodes (node_id,node_name,alias,runtime,created_at,updated_at,network_id,lifecycle_state,owner_user_id) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,'active',?)`, [id, `idle-node-${String(i).padStart(2, "0")}`, `idle-node-${String(i).padStart(2, "0")}`, "claude-code", net, uid]);
}
db.run(`INSERT OR IGNORE INTO network_members (network_id,user_id,role,invited_by) VALUES (?,?,'member',?)`, [net, member, uid]);

const pad = (x) => String(x).padStart(2, "0");
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const A = { kind: "node", id: "node_demo_a" }, B = { kind: "node", id: "node_demo_b" }, ME = { kind: "user", id: uid }, M2 = { kind: "user", id: member };
// owner = 负责人 (human), agent = 负责 Agent (node). A hub without agent_owner ignores the field (single-owner fallback run).
const rows = [
  { name: "登录页支持扫码登录", priority: "high", due: day(-3), owner: ME, agent: A, column: "pool",            // overdue
    description: "## 目标\n扫码即可登录,不用输密码。\n\n- 手机端扫码\n- 桌面端出码", checklist: ["出码接口", "手机扫码页", "轮询登录状态", "过期刷新", "埋点", "文档", "回归"].map((text, i) => ({ id: `s${i}`, text, done: i < 3 })) },
  { name: "整理 9 月的发版说明,补上安卓和桌面端的差异", priority: "normal", due: day(5), owner: ME, agent: null, column: "pool" },
  { name: "看板卡片支持拖动换列", priority: "normal", due: "", owner: null, agent: null, column: "pool" },
  { name: "修复通知在后台不弹", priority: "high", due: day(0), owner: M2, agent: B, column: "doing" },          // today
  { name: "设置页拆分子页面", priority: "low", due: day(12), owner: null, agent: A, column: "doing" },
  { name: "Hub 升级到最新预览版并回归一遍核心流程", priority: "normal", due: day(2), owner: M2, agent: null, column: "doing" },
  { name: "节点日志查看器", priority: "normal", due: day(-10), owner: ME, agent: B, column: "done" },
  { name: "语音输入快捷键", priority: "low", due: "", owner: ME, agent: A, column: "done" },
];
const call = async (path, init) => {
  const res = await fetch(`${hub}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
};
// Projects (a hub without them answers 404 → the fallback run has none). The hub never seeds; this fixture does.
const projects = {};
{
  const res = await fetch(`${hub}/api/requirements/projects?network_id=${net}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "军团项目" }) });
  if (res.status === 201) {
    projects.legion = (await res.json()).project.id;
    projects.tmai = (await call(`/api/requirements/projects?network_id=${net}`, { method: "POST", body: JSON.stringify({ name: "TMAI", color: "#7c3aed" }) })).project.id;
  }
}
// 参与人:一张卡 4 个人(卡片上 3 个头像 +1)
const participantsOf = { "登录页支持扫码登录": [ME, M2, A, B] };
const projectOf = { "登录页支持扫码登录": "legion", "整理 9 月的发版说明,补上安卓和桌面端的差异": "legion", "修复通知在后台不弹": "tmai", "设置页拆分子页面": "legion", "节点日志查看器": "tmai" };
for (const r of rows) {
  const { requirement } = await call("/api/requirements", { method: "POST", body: JSON.stringify({ name: r.name, priority: r.priority, due: r.due, assignee: "", network_id: net, ...(r.description ? { description: r.description } : {}), ...(r.checklist ? { checklist: r.checklist } : {}), ...(projects[projectOf[r.name]] ? { project_id: projects[projectOf[r.name]] } : {}), ...(participantsOf[r.name] ? { participants: participantsOf[r.name] } : {}), ...(r.owner ? { owner: r.owner } : {}), ...(r.agent ? { agent_owner: r.agent } : {}) }) });
  if (r.column !== "pool") await call(`/api/requirements/${requirement.id}?network_id=${net}`, { method: "PATCH", body: JSON.stringify({ column: r.column }) });
}
// Sub-requirements + a synced GitHub issue (a hub without #2081 ignores parent_id / external_* → fallback run).
{
  const list = (await call(`/api/requirements?network_id=${net}`)).requirements;
  const parent = list.find(r => r.name === "登录页支持扫码登录");
  for (const [name, column] of [["扫码登录:出码接口", "done"], ["扫码登录:手机扫码页", "doing"]]) {
    await call("/api/requirements", { method: "POST", body: JSON.stringify({ name, column, network_id: net, parent_id: parent.id }) });
  }
  await call(`/api/requirements/${parent.id}?network_id=${net}`, { method: "PATCH", body: JSON.stringify({ external_ref: "github:example-org/example-repo#42", external_url: "https://github.com/example-org/example-repo/issues/42" }) }).catch(() => null);
}
const { requirements } = await call(`/api/requirements?network_id=${net}`);
console.log(`seeded ${requirements.length} requirements`);
