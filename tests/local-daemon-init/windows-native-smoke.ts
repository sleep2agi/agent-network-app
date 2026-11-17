// Native gate: unchanged Rust installer + downloaded exact npm pair + real Hub
// and Claude SDK. Only model HTTP and CLI-missing registry metadata are fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { NativeGate, runCommand, type Stage } from "./native-gate";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(import.meta.dir, "../..");
const hubSource = resolve(app, ".native-hub-source");
const hubSha = "f8332b965cf428cf843daa6888c3e1f433f60b61";
const evidenceDir = join(import.meta.dir, "evidence");
mkdirSync(evidenceDir, { recursive: true });
const stages: Record<string, Stage> = Object.fromEntries(
  ["environment", "hub_setup", "installer", "installer_report", "private_node", "verified_cli", "pair", "profile", "detached_launcher", "home_probe", "model_fixture", "create_node", "sdk_online", "send_task", "sdk_reply", "isolation", "stop_ack", "cleanup"]
    .map(name => [name, { status: "NOT_RUN", reason: "preceding gate has not passed" }]),
);
const evidence: Record<string, any> = { status: "NOT_RUN", platform: process.platform, hub_source: hubSha, stages,
  fixtures: ["loopback model HTTP", "CLI metadata 404 only; other npm traffic forwarded"],
  not_run: [
    { step: "Unix shell/Python fault adapters", status: "NOT_RUN", reason: "requires POSIX shell/signals/mode bits; still required on Linux/macOS" },
    { step: "signed NSIS installation, GUI/IPC and physical clean Windows", status: "NOT_RUN", reason: "gate compiles actual Rust installer without Tauri windowing" },
    { step: "desktop credential-store/ACL helper integration", status: "NOT_RUN", reason: "crate supplies temporary app-root/directory/atomic-write helpers" },
  ],
};
function save() {
  const file = join(evidenceDir, "windows-native.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(evidence, null, 2)); renameSync(`${file}.tmp`, file);
}
save();
if (process.platform !== "win32") {
  stages.environment = { status: "NOT_RUN", reason: "requires native Windows; Linux execution is not a substitute" };
  save(); throw Error("native Windows gate cannot be replaced by Linux execution");
}
const root = mkdtempSync(join(tmpdir(), "anet-app-native & "));
const appRoot = join(root, "app"), cloud = join(root, "cloud-home"), hubHome = join(root, "hub-home");
for (const dir of [appRoot, cloud, hubHome, join(cloud, ".anet")]) mkdirSync(dir, { recursive: true });
const work = join(appRoot, "local-daemon"), home = join(work, "home");
const sentinel = join(cloud, ".anet", "config.json");
writeFileSync(sentinel, "CLOUD-SENTINEL-DO-NOT-READ-OR-WRITE");
process.env.COMMHUB_DB = join(root, "hub.db");
process.env.COMMHUB_NODE_PERMISSIONS = "enforce";
process.env.HOME = hubHome; process.env.USERPROFILE = hubHome;
const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
assert(systemRoot, "SystemRoot required");
const system32 = win32.join(systemRoot, "System32");
const osPath = [system32, win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"), systemRoot].join(";");
const driver = join(import.meta.dir, "target", "debug", "local-daemon-init-regression.exe");
const source = readFileSync(join(app, "src-tauri", "src", "local_daemon.rs"), "utf8");
const constant = (key: string) => {
  const value = source.match(new RegExp(`const ${key}: &str = "([^"]+)";`))?.[1];
  assert(value, `missing product constant ${key}`); return value;
};
const cliPin = constant("ANET_PACKAGE"), runtimePin = constant("AGENT_NODE_PACKAGE"), cliHash = constant("ANET_TARBALL_SHA256");
assert.equal(cliPin, "@sleep2agi/agent-network@2.3.0-preview.241");
assert.equal(runtimePin, "@sleep2agi/agent-node@2.5.0-preview.209");
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
let token = "", network = "", modelHits = 0, registryMisses = 0;
const marker = "APP_WINDOWS_SDK_FIRST_REPLY";
const secrets = new Set<string>(["sk-local-fixture-only"]);
let hub: any, hubDb: any, vendor: any, registry: any;
let firstReplyDeadline = Infinity, lastCommandPrefix = "", commandSequence = 0;
const privateEnv: NodeJS.ProcessEnv = {};
for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "windir", "COMSPEC", "PATHEXT", "TEMP", "TMP", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]) {
  if (process.env[key]) privateEnv[key] = process.env[key];
}
Object.assign(privateEnv, { PATH: osPath, HOME: cloud, USERPROFILE: cloud, HOMEDRIVE: cloud.slice(0, 2), HOMEPATH: cloud.slice(2),
  APPDATA: join(cloud, "AppData", "Roaming"), LOCALAPPDATA: join(cloud, "AppData", "Local"),
  ANET_TEST_ROOT: appRoot, ANET_TEAM_RULES: "0", ANET_SMOKE_DRIVER_PROGRESS: join(evidenceDir, "native-driver.json"),
  npm_config_cache: join(root, "npm-cache"), npm_config_audit: "false", npm_config_fund: "false" });
const profile = (name: string) => join(work, ".anet", "nodes", name);
function redact(text: string) {
  for (const name of ["local-daemon", "first-agent"]) {
    try { const cfg = JSON.parse(readFileSync(join(profile(name), "config.json"), "utf8"));
      for (const key of ["token", "auth_token"]) if (cfg[key]) secrets.add(cfg[key]); } catch {}
  }
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text.replace(/\b(?:ntok|atok|utok)_[A-Za-z0-9_-]+/g, "[redacted]");
}
const gate = new NativeGate(evidence as { stages: Record<string, Stage> }, save, redact);
const phase = <T>(name: string, ms: number, action: (signal: AbortSignal) => Promise<T> | T) => gate.run(name, ms, action, firstReplyDeadline);
function command(executable: string, args: string[], signal: AbortSignal, options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  lastCommandPrefix = join(root, `command-${++commandSequence}`);
  const stage = evidence.active_stage;
  return runCommand(executable, args, { ...options, signal, logPrefix: lastCommandPrefix,
    onEvent: event => { evidence.last_command = { stage, ...event }; save(); } });
}
async function mcp(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const response = await fetch(`${hub.url.origin}/mcp`, { method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, network_id: network } } }) });
  assert(response.ok, `MCP HTTP ${response.status}`);
  const raw = await response.text(), data = raw.split("\n").find(line => line.startsWith("data: "));
  const wire = JSON.parse(data ? data.slice(6) : raw);
  assert(!wire.error, redact(JSON.stringify(wire.error ?? null)));
  return JSON.parse(wire.result.content[0].text);
}
async function wait<T>(read: () => Promise<T | null | false>, signal: AbortSignal): Promise<T> {
  while (true) { signal.throwIfAborted(); const value = await read(); signal.throwIfAborted(); if (value) return value; await Bun.sleep(100); }
}
function collectLogs() {
  const result: Record<string, string> = {};
  for (const [key, path] of [["installer", join(root, "install-report.json")], ["start", join(work, "start.log")],
    ["child", join(profile("first-agent"), "logs", "spawn.log")], ["last_stdout", `${lastCommandPrefix}.stdout`], ["last_stderr", `${lastCommandPrefix}.stderr`]]) {
    try { result[key] = redact(readFileSync(path, "utf8")).slice(-16_000); } catch {}
  }
  return result;
}
async function runDriver(sessionFile: string, reportFile: string, signal: AbortSignal) {
  const controller = new AbortController();
  let observer: ReturnType<typeof setInterval> | undefined, previous = "";
  try {
    const watch = new Promise<never>((_, reject) => {
      observer = setInterval(() => {
        try {
        let history: any[] = [];
        try { history = JSON.parse(readFileSync(privateEnv.ANET_SMOKE_DRIVER_PROGRESS!, "utf8")); } catch {}
        const latest = history.at(-1);
        const observed = { driver_history: history, node: existsSync(join(work, "node", "node.exe")),
          cli: existsSync(join(work, "anet", "node_modules", "@sleep2agi", "agent-network", "package.json")),
          runtime: existsSync(join(work, "anet", "node_modules", "@sleep2agi", "agent-node", "package.json")),
          profile: existsSync(join(profile("local-daemon"), "config.json")), pid_receipt: existsSync(join(profile("local-daemon"), ".pid")),
          report: existsSync(reportFile), hub_daemon_status: hubDb.get("SELECT status FROM sessions WHERE network_id = ?1 AND alias = 'local-daemon' ORDER BY updated_at DESC LIMIT 1", network)?.status ?? null };
        const snapshot = JSON.stringify(observed);
        if (snapshot !== previous) { previous = snapshot; evidence.installer_observed = observed; save(); }
        if (latest?.status === "RUNNING" && ["before_scan", "after_scan"].includes(latest.stage) && Date.now() - latest.at >= 20_000) {
          const error = Error(`hard deadline exceeded: native-driver/${latest.stage}; budget_ms=20000`);
          evidence.driver_substage_failure = { stage: latest.stage, status: "FAIL", reason: error.message }; save();
          controller.abort(error); reject(error);
        }
        } catch (error) { controller.abort(error); reject(error); }
      }, 100);
    });
    await Promise.race([command(driver, [sessionFile, reportFile], AbortSignal.any([signal, controller.signal]), { cwd: app, env: privateEnv }), watch]);
  } finally { if (observer) clearInterval(observer); }
}
try {
  await phase("environment", 60_000, async () => {
  evidence.app_source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: app, encoding: "utf8", timeout: 10_000 }).trim();
  evidence.app_pr_head = process.env.ANET_APP_PR_HEAD ?? "NOT_RUN: not supplied outside CI";
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: hubSource, encoding: "utf8", timeout: 10_000 }).trim(), hubSha);
  evidence.installer_source_sha256 = digest(join(app, "src-tauri", "src", "local_daemon.rs"));
  evidence.driver_sha256 = digest(driver);
  // OS-provided wsl/bash aliases can exist in System32; neither is invoked.
  for (const tool of ["node.exe", "npm.cmd", "anet.cmd", "git.exe"]) {
    let found = false;
    try { execFileSync(join(system32, "where.exe"), [tool], { env: privateEnv, windowsHide: true, stdio: "pipe", timeout: 5000 }); found = true; }
    catch (error: any) { assert(error.status === 1, `where probe must return not-found, not a timeout or execution failure: ${tool}`); }
    assert(!found, `native installer must not find ambient ${tool}`);
  }
  assert(!existsSync(join(work, "node")) && !existsSync(join(work, "anet")));
  });
  await phase("hub_setup", 30_000, async signal => {
  const { bootServer } = await import(pathToFileURL(join(hubSource, "server", "src", "server.ts")).href);
  hub = bootServer({ port: 0, hostname: "127.0.0.1" });
  hubDb = (await import(pathToFileURL(join(hubSource, "server", "src", "db.ts")).href)).db;
  const login = await (await fetch(`${hub.url.origin}/api/auth/register`, { method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `app_windows_${Date.now()}`, password: "LocalWindowsSmoke123!" }) })).json() as any;
  assert(login.ok, "local Hub registration failed"); token = login.token; network = login.network_id; secrets.add(token);
  });
  const sessionFile = join(root, "session.json"), reportFile = join(root, "install-report.json");
  writeFileSync(sessionFile, JSON.stringify({ endpoint: hub.url.origin, token, network_id: network }));
  registry = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (decodeURIComponent(url.pathname).toLowerCase() === "/@sleep2agi/agent-network") {
      registryMisses++; return Response.json({ error: "fixture exact CLI missing" }, { status: 404 });
    }
    const upstream = await fetch(`https://registry.npmjs.org${url.pathname}${url.search}`, { signal: AbortSignal.timeout(20_000) });
    const headers = new Headers(upstream.headers); headers.delete("content-encoding"); headers.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers });
  } });
  privateEnv.npm_config_registry = registry.url.origin;
  const installStarted = Date.now();
  firstReplyDeadline = installStarted + 180_000;
  evidence.first_reply_deadline_at = firstReplyDeadline; save();
  await phase("installer", 180_000, signal => runDriver(sessionFile, reportFile, signal));
  const report = await phase("installer_report", 5000, () => {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(report.install.ok, true);
  assert(report.install.steps.every((step: any) => step.ok === true));
  return report;
  });
  await phase("private_node", 5000, () => {
  assert(report.install.steps.some((step: any) => step.name.includes("下载私有 Node") && step.output.includes(".zip") && step.output.includes("SHA256 校验通过")));
  });
  await phase("verified_cli", 5000, () => {
  assert(registryMisses > 0 && report.install.steps.some((step: any) => step.output.includes("CLI SHA256 已校验")), "real verified release fallback must run");
  });
  const node = join(work, "node", "node.exe"), prefix = join(work, "anet"), cli = join(prefix, "node_modules", "@sleep2agi", "agent-network", "dist", "bin", "anet.cjs");
  await phase("pair", 5000, () => {
  assert.equal(report.scan.privateNode.path.toLowerCase(), node.toLowerCase());
  assert.equal(report.scan.anet.path.toLowerCase(), cli.toLowerCase());
  assert.equal(report.scan.anetCompatible, true); assert.equal(report.scan.agentNodeCompatible, true);
  for (const [name, pin] of [["agent-network", cliPin], ["agent-node", runtimePin]]) {
    assert.equal(JSON.parse(readFileSync(join(prefix, "node_modules", "@sleep2agi", name, "package.json"), "utf8")).version, pin.split("@").at(-1));
  }
  evidence.packages = { cli: cliPin, cli_tarball_url: constant("ANET_TARBALL_URL"), cli_tarball_sha256: cliHash, cli_entry_sha256: digest(cli), agent_node: runtimePin,
    node_version: report.scan.privateNode.version, node_executable_sha256: digest(node), node_distribution: "product latest-v22.x SHASUMS256 verified Windows ZIP",
    node_download: report.install.steps.find((step: any) => step.name.includes("下载私有 Node"))?.output };
  });
  const daemonCfg = await phase("profile", 5000, () => {
  const daemonCfg = JSON.parse(readFileSync(join(profile("local-daemon"), "config.json"), "utf8"));
  assert.equal(daemonCfg.node_id, report.install.nodeId);
  assert.deepEqual(daemonCfg.runtimes_supported, ["claude-agent-sdk"]);
  const isolated = JSON.parse(readFileSync(join(home, ".anet", "config.json"), "utf8"));
  assert.equal(isolated.hub, hub.url.origin); assert.equal(isolated.network_id, network);
  return daemonCfg;
  });
  const nodeEnv = { ...privateEnv, PATH: `${dirname(node)};${osPath}` };
  // The Rust driver has exited. The direct native node.exe launcher must
  // remain alive without its parent; inspect metadata, never emit argv.
  const quotePs = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await phase("detached_launcher", 20_000, async signal => {
  const processProbe = await command(join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
    `$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); $expected=${quotePs(node)}; $entry=${quotePs(cli)}; ` +
    "$matched=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $expected -and $_.CommandLine.Contains($entry) -and $_.CommandLine -match 'daemon\\s+start\\s+local-daemon' }); " +
    "if($matched.Count -ne 1){throw 'expected one surviving direct private-node daemon launcher'}; Write-Output 'direct-private-node-detached-ok'"],
    signal, { env: nodeEnv });
  assert.equal(processProbe.stdout.trim(), "direct-private-node-detached-ok");
  evidence.detached_launcher = "direct private node.exe + anet.cjs survives Rust installer exit (production DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP path)";
  });
  // Execute under product-selected private node.exe, no runner Node or shell.
  await phase("home_probe", 10_000, async signal => {
  const probe = await command(node, ["-e", "console.log(JSON.stringify({home:require('node:os').homedir(),exec:process.execPath}))"], signal, {
    env: { ...nodeEnv, HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2) },
  });
  assert.equal(JSON.parse(probe.stdout).home.toLowerCase(), home.toLowerCase());
  assert.equal(JSON.parse(probe.stdout).exec.toLowerCase(), node.toLowerCase());
  evidence.home_isolation = "private init credential path and explicit HOME/USERPROFILE os.homedir probe; sentinel detects writes, not a complete process-environment/read-isolation audit";
  });
  await phase("model_fixture", 5000, () => {
  vendor = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "POST" || !url.pathname.startsWith("/v1/messages")) return Response.json({ ok: true });
    const body = await req.json() as any; modelHits++;
    const message = { id: "msg_app_win", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: marker }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 4 } };
    if (!body.stream) return Response.json(message);
    const events = [["message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: marker } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } }],
      ["message_stop", { type: "message_stop" }]];
    return new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  } });
  mkdirSync(profile("first-agent"), { recursive: true });
  writeFileSync(join(profile("first-agent"), "secrets.env"), `ANTHROPIC_API_KEY=sk-local-fixture-only\nANTHROPIC_BASE_URL=${vendor.url.origin}\nCLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\n`);
  });
  await phase("create_node", 15_000, async signal => {
  const created = await mcp("create_node", { daemon_node_id: daemonCfg.node_id,
    node_spec: { name: "first-agent", runtime: "claude-agent-sdk", model: "claude-sonnet-4-5", channels: [] } }, signal);
  assert(created.ok, redact(JSON.stringify(created)));
  });
  const child = await phase("sdk_online", 60_000, signal => wait(async () => { const { session } = await mcp("get_session_status", { alias: "first-agent" }, signal);
    return session?.node_id && session.status === "idle" ? session : null; }, signal));
  const taskId = await phase("send_task", 15_000, async signal => {
  const sent = await mcp("send_task", { alias: "first-agent", task: "Say hello. Do not use tools." }, signal);
  const id = sent.task_id ?? sent.message_id; assert(sent.ok && id); return id;
  });
  await phase("sdk_reply", 120_000, async signal => {
  await wait(async () => { const result = await mcp("get_task", { task_id: taskId }, signal); const row = result.task ?? result;
    assert(!["failed", "cancelled"].includes(row.status), redact(JSON.stringify(row)));
    return typeof row.result === "string" && row.result.includes(marker) ? row : null; }, signal);
  assert(modelHits > 0, "reply must originate in model HTTP fixture");
  const installToReply = Date.now() - installStarted;
  evidence.install_to_reply_ms = installToReply; evidence.model_http_requests = modelHits;
  assert(installToReply <= 180_000, `download/install-to-reply exceeded 3 minutes: ${installToReply}ms`);
  });
  firstReplyDeadline = Infinity;
  await phase("isolation", 5000, () => {
  assert.equal(readFileSync(sentinel, "utf8"), "CLOUD-SENTINEL-DO-NOT-READ-OR-WRITE");
  assert.equal(JSON.parse(readFileSync(join(profile("first-agent"), "config.json"), "utf8")).hub, hub.url.origin);
  });
  const db = hubDb;
  await phase("stop_ack", 15_000, async signal => {
  const stopStarted = Date.now();
  const stopped = await mcp("stop_node", { node_id: child.node_id }, signal); assert(stopped.ok, redact(JSON.stringify(stopped)));
  const ack = await wait(async () => {
    const row = db.get("SELECT status, error, exit_signal, acked_at FROM node_stop_requests WHERE request_id = ?1", stopped.request_id) as any;
    assert(row?.status !== "stop_failed", redact(JSON.stringify(row)));
    return row?.status === "stopped" ? row : null;
  }, signal);
  const stopMs = Date.now() - stopStarted;
  assert(stopMs <= 15_000, `dispatch through accepted Hub ACK exceeded 15 seconds: ${stopMs}ms`);
  assert(ack.acked_at && ack.exit_signal === "taskkill");
  evidence.stopped = true; evidence.cloud_sentinel = "unchanged (write evidence, not proof of read isolation)";
  });
} catch (error) {
  evidence.status = "FAIL"; evidence.failed_stage = evidence.active_stage; evidence.error = redact(String(error));
  for (const stage of Object.values(stages)) if (stage.status === "NOT_RUN") stage.reason = `not reached: ${evidence.failed_stage} failed`;
  if (evidence.failed_stage === "installer") {
    try {
      const history = JSON.parse(readFileSync(privateEnv.ANET_SMOKE_DRIVER_PROGRESS!, "utf8"));
      evidence.driver_history_at_failure = history;
      const last = history.at(-1);
      if (last?.status === "RUNNING") evidence.driver_substage_failure ??= { stage: last.stage, status: "FAIL", reason: evidence.error };
    } catch {}
  }
  save();
  evidence.diagnostics = collectLogs(); save();
  console.error(evidence.error); process.exitCode = 1;
} finally {
  // Cleanup is not the SDK stop acceptance. Delegate ownership checks to the
  // same pinned product CLI; no raw-PID/name-based kill fallback is permitted.
  firstReplyDeadline = Infinity;
  try {
    await gate.run("cleanup", 30_000, async signal => {
    for (const name of readdirSync(join(work, ".anet", "nodes"))) {
      const dir = profile(name);
      if (!existsSync(join(dir, ".pid"))) continue;
      const node = join(work, "node", "node.exe");
      const cli = join(work, "anet", "node_modules", "@sleep2agi", "agent-network", "dist", "bin", "anet.cjs");
        await command(node, [cli, "node", "stop", name], signal, { cwd: work, env: { ...privateEnv, PATH: `${dirname(node)};${osPath}`,
          HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2) },
        });
        assert(!existsSync(join(dir, ".pid")), "product cleanup must remove its stopped PID receipt");
    }
    });
  } catch (error: any) {
    // No profile means no product process reached cleanup; do not turn a
    // previous native failure into success, or wait on an unbounded fallback.
    evidence.cleanup_error = redact(String(error)); process.exitCode = 1; save();
  }
  hub?.stop(true); vendor?.stop(true); registry?.stop(true);
  evidence.status = process.exitCode || Object.values(stages).some(stage => stage.status !== "PASS") ? "FAIL" : "PASS";
  if (evidence.status !== "PASS") process.exitCode = 1;
  save(); console.log(JSON.stringify({ ...evidence, diagnostics: undefined }));
}
