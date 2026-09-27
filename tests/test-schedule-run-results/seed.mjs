// Seed a THROWAWAY hub's sqlite for measure.mjs (placeholder alias/ids only; never point it at a real hub DB).
//   bun tests/test-schedule-run-results/seed.mjs <hub.db> <network_id> <user_id> <uploaded image file_id>
// Upload any small PNG first (POST /api/upload) and pass its file_id — the replied run references it as a
// reply attachment (meta_json.reply_attachments) and in the reply text.
import { Database } from "bun:sqlite";
const [dbPath, net, uid, fileId] = process.argv.slice(2);
const db = new Database(dbPath);
const node = "node_demo_0001", alias = "demo-node";
db.run(`INSERT INTO nodes (node_id,node_name,alias,runtime,created_at,updated_at,network_id,lifecycle_state,owner_user_id) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,'active',?)`, [node, alias, alias, "claude-code", net, uid]);
db.run(`INSERT INTO sessions (resume_id,alias,status,network_id,registered_at,updated_at,node_id,last_seen_at,agent) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,datetime('now'),'claude-code')`, ["res_demo", alias, "idle", net, node]);
const sched = "sched_demo_daily";
db.run(`INSERT INTO scheduled_tasks (schedule_id,network_id,created_by,name,target_node_id,target_alias,task_content,priority,schedule_type,schedule_json,timezone,overlap_policy,misfire_policy,status,next_run_at,last_run_at,revision,created_at,updated_at)
 VALUES (?,?,?,?,?,?,?,'normal','daily',?,'Asia/Shanghai','skip','skip','active','2026-09-28T02:53:00.000Z','2026-09-27T02:53:00.000Z',1,datetime('now'),datetime('now'))`,
 [sched, net, uid, "每日巡检", node, alias, "巡检一下各节点状态，把异常汇总成表格回我。", JSON.stringify({ type: "daily", time: "10:53" })]);
const meta = (runId, extra = {}) => JSON.stringify({ scheduled_task_id: sched, scheduled_run_id: runId, scheduled_for: "", auth_origin: "hub_scheduler", ...extra });
const reply = `## 巡检结果\n\n共 **4** 个节点，1 个异常：\n\n| 节点 | 状态 | 备注 |\n|---|---|---|\n| node-a | 在线 | — |\n| node-b | 离线 | 心跳 12 分钟前 |\n\n- 已重试连接 2 次\n- 建议检查 \`frpc\` 进程\n\n图表：[chart.png](/api/files/${fileId})`;
const rows = [
  { run: "srun_demo_1", task: "task_demo_1", for: "2026-09-27T02:53:00.000Z", created: "2026-09-27 02:53:00", rstatus: "delivered", tstatus: "running" },
  { run: "srun_demo_2", task: "task_demo_2", for: "2026-09-26T02:53:00.000Z", created: "2026-09-26 02:53:01", rstatus: "replied", tstatus: "replied", done: "2026-09-26 02:56:13", result: reply, replyMeta: true },
  { run: "srun_demo_3", task: "task_demo_3", for: "2026-09-25T02:53:00.000Z", created: "2026-09-25 02:53:00", rstatus: "expired", tstatus: "expired", done: "2026-09-26 02:53:00", code: "task_expired" },
  { run: "srun_demo_4", for: "2026-09-24T02:53:00.000Z", created: "2026-09-24 02:53:00", rstatus: "skipped", code: "previous_run_active", done: "2026-09-24 02:53:00" },
  { run: "srun_demo_5", task: "task_demo_5", for: "2026-09-23T02:53:00.000Z", created: "2026-09-23 02:53:00", rstatus: "delivered", tstatus: "delivered" },
];
for (const r of rows) {
  if (r.task) db.run(`INSERT INTO tasks (task_id,from_name,to_node_id,to_name,priority,status,content,result,requires_response,created_at,delivered_at,completed_at,network_id,meta_json)
    VALUES (?, 'scheduler', ?, ?, 'normal', ?, ?, ?, 'reply', ?, ?, ?, ?, ?)`,
    [r.task, node, alias, r.tstatus, "巡检一下各节点状态，把异常汇总成表格回我。", r.result ?? null, r.created, r.created, r.done ?? null, net,
     meta(r.run, r.replyMeta ? { reply_attachments: [{ type: "file", file_id: fileId, name: "chart.png", mime: "image/png", size: 821 }] } : {})]);
  db.run(`INSERT INTO scheduled_task_runs (run_id,schedule_id,network_id,scheduled_for,task_id,status,error_code,error_message,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [r.run, sched, net, r.for, r.task ?? null, r.rstatus, r.code ?? null, r.msg ?? null, r.created, r.done ?? null]);
}
// Newer chat exchanges (still inside the chat's first 20-row page) so that opening the conversation
// normally lands far below task_demo_2 — 去会话 has to scroll to it for the bubble to be in view.
for (let i = 1; i <= 12; i++) {
  const at = `2026-09-27 03:${String(10 + i).padStart(2, "0")}:00`;
  db.run(`INSERT INTO tasks (task_id,from_name,to_node_id,to_name,priority,status,content,result,requires_response,created_at,completed_at,network_id) VALUES (?,'tester',?,?,'normal','replied',?,?,'reply',?,?,?)`,
    [`task_chat_${i}`, node, alias, `第 ${i} 条普通消息`, `收到第 ${i} 条。\n\n这是一段占位回复，用来把会话撑长。`, at, at, net]);
}
console.log("seeded");
