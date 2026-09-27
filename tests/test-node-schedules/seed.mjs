// Seed a THROWAWAY hub's sqlite for measure.mjs (placeholder aliases/ids only; never point it at a real hub DB).
//   bun tests/test-node-schedules/seed.mjs <hub.db> <network_id> <user_id>
// Two nodes, both with Hub plans and node plans, so the node page must pick by node_id:
//   node_demo_a (demo-node-a): 3 Hub plans (active daily with a replied run, paused weekly, active interval whose
//     latest run is still running) + 2 node plans (managed cron — togglable; systemd — read-only).
//   node_demo_b (demo-node-b): 2 Hub plans — one of them carries target_alias 'demo-node-a' (an alias collision:
//     only node_id may decide) — + 1 node plan.
//   node_demo_c (demo-node-c): nothing — the empty state.
import { Database } from "bun:sqlite";
const [dbPath, net, uid] = process.argv.slice(2);
if (!dbPath || !net || !uid) throw new Error("usage: seed.mjs <hub.db> <network_id> <user_id>");
const db = new Database(dbPath);
const iso = (ms) => new Date(ms).toISOString();
const sql = (ms) => iso(ms).replace("T", " ").slice(0, 19);
const now = Date.now();
const H = 3600_000;

const nodes = [
  { id: "node_demo_a", alias: "demo-node-a" },
  { id: "node_demo_b", alias: "demo-node-b" },
  { id: "node_demo_c", alias: "demo-node-c" },
];
const external = {
  node_demo_a: { observed_at: iso(now - 60_000), schedules: [
    { id: "cron_demo_cleanup", name: "清理日志", kind: "cron", frequency: "30 3 * * *", last_run_at: iso(now - 20 * H), last_status: "success", last_error: null, next_run_at: iso(now + 4 * H), log_ref: null, enabled: true, editable: true, revision: 2 },
    { id: "sysd_demo_sync", name: "同步镜像", kind: "systemd", frequency: "hourly", last_run_at: iso(now - H / 2), last_status: "failed", last_error: "exit 1", next_run_at: iso(now + H / 2), log_ref: null, enabled: true },
  ] },
  node_demo_b: { observed_at: iso(now - 60_000), schedules: [
    { id: "cron_demo_other", name: "别的节点的 cron", kind: "cron", frequency: "0 * * * *", last_run_at: null, last_status: "unknown", last_error: null, next_run_at: iso(now + H), log_ref: null, enabled: true, editable: true, revision: 1 },
  ] },
};
for (const n of nodes) {
  db.run(`INSERT INTO nodes (node_id,node_name,alias,runtime,created_at,updated_at,network_id,lifecycle_state,owner_user_id) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,'active',?)`, [n.id, n.alias, n.alias, "claude-code", net, uid]);
  // demo-node-a reports rules/skills capability so its node page shows all seven sections (the tab row's widest case).
  db.run(`INSERT INTO sessions (resume_id,alias,status,network_id,registered_at,updated_at,node_id,last_seen_at,agent,external_schedules,rules_file_capable,skills_capable) VALUES (?,?,?,?,datetime('now'),datetime('now'),?,datetime('now'),'claude-code',?,?,?)`,
    [`res_${n.id}`, n.alias, "idle", net, n.id, external[n.id] ? JSON.stringify(external[n.id]) : null, n.id === "node_demo_a" ? 1 : 0, n.id === "node_demo_a" ? 1 : 0]);
}

const plans = [
  { id: "sched_demo_a_daily", node: "node_demo_a", alias: "demo-node-a", name: "每日巡检", type: "daily", spec: { type: "daily", time: "09:30" }, status: "active", next: now + 5 * H, last: now - 19 * H },
  { id: "sched_demo_a_weekly", node: "node_demo_a", alias: "demo-node-a", name: "周报汇总", type: "weekly", spec: { type: "weekly", time: "18:00", weekdays: [5] }, status: "paused", next: now + 50 * H, last: null },
  { id: "sched_demo_a_hourly", node: "node_demo_a", alias: "demo-node-a", name: "拉取新闻", type: "interval", spec: { type: "interval", every_seconds: 3600 }, status: "active", next: now + H / 3, last: now - 40 * 60_000 },
  { id: "sched_demo_b_daily", node: "node_demo_b", alias: "demo-node-b", name: "别的节点的日报", type: "daily", spec: { type: "daily", time: "08:00" }, status: "active", next: now + 3 * H, last: null },
  // alias collision: executor is node_demo_b even though the stored alias reads demo-node-a
  { id: "sched_demo_b_alias_trap", node: "node_demo_b", alias: "demo-node-a", name: "同名陷阱", type: "daily", spec: { type: "daily", time: "07:00" }, status: "active", next: now + 2 * H, last: null },
];
for (const p of plans) {
  db.run(`INSERT INTO scheduled_tasks (schedule_id,network_id,created_by,name,target_node_id,target_alias,task_content,priority,schedule_type,schedule_json,timezone,overlap_policy,misfire_policy,status,next_run_at,last_run_at,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'normal',?,?,'Asia/Shanghai','skip','skip',?,?,?,1,datetime('now'),datetime('now'))`,
    [p.id, net, uid, p.name, p.node, p.alias, `${p.name}:占位任务内容`, p.type, JSON.stringify(p.spec), p.status, iso(p.next), p.last ? iso(p.last) : null]);
}

const runs = [
  { run: "srun_demo_a_daily", sched: "sched_demo_a_daily", node: "node_demo_a", alias: "demo-node-a", task: "task_demo_a_daily", at: now - 19 * H, rstatus: "replied", tstatus: "replied", done: now - 19 * H + 90_000, result: "巡检完成,全部正常。" },
  { run: "srun_demo_a_hourly", sched: "sched_demo_a_hourly", node: "node_demo_a", alias: "demo-node-a", task: "task_demo_a_hourly", at: now - 40 * 60_000, rstatus: "delivered", tstatus: "running" },
  { run: "srun_demo_b_daily", sched: "sched_demo_b_daily", node: "node_demo_b", alias: "demo-node-b", task: "task_demo_b_daily", at: now - 21 * H, rstatus: "failed", tstatus: "failed", done: now - 21 * H + 30_000, code: "task_failed" },
];
for (const r of runs) {
  db.run(`INSERT INTO tasks (task_id,from_name,to_node_id,to_name,priority,status,content,result,requires_response,created_at,delivered_at,completed_at,network_id,meta_json)
    VALUES (?, 'scheduler', ?, ?, 'normal', ?, ?, ?, 'reply', ?, ?, ?, ?, ?)`,
    [r.task, r.node, r.alias, r.tstatus, "占位任务内容", r.result ?? null, sql(r.at), sql(r.at), r.done ? sql(r.done) : null, net,
     JSON.stringify({ scheduled_task_id: r.sched, scheduled_run_id: r.run, scheduled_for: iso(r.at), auth_origin: "hub_scheduler" })]);
  db.run(`INSERT INTO scheduled_task_runs (run_id,schedule_id,network_id,scheduled_for,task_id,status,error_code,error_message,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [r.run, r.sched, net, iso(r.at), r.task, r.rstatus, r.code ?? null, null, sql(r.at), r.done ? sql(r.done) : null]);
}
console.log("seeded");
