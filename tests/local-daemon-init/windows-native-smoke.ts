// Native gate: unchanged Rust installer + downloaded exact npm pair + real Hub
// and Claude SDK. Only model HTTP and CLI-missing registry metadata are fixtures.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const app = resolve(import.meta.dir, "../..");
const hubSource = resolve(app, ".native-hub-source");
const hubSha = "f8332b965cf428cf843daa6888c3e1f433f60b61";
const evidenceDir = join(import.meta.dir, "evidence");
mkdirSync(evidenceDir, { recursive: true });
const stages: Record<string, { status: string; reason?: string; ms?: number }> = Object.fromEntries(
  ["environment", "private_node", "verified_cli", "pair", "installer", "sdk_reply", "stop_ack", "cleanup"]
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
function save() { writeFileSync(join(evidenceDir, "windows-native.json"), JSON.stringify(evidence, null, 2)); }
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
let hub: any, vendor: any, registry: any;
const privateEnv: NodeJS.ProcessEnv = {};
for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "windir", "COMSPEC", "PATHEXT", "TEMP", "TMP", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]) {
  if (process.env[key]) privateEnv[key] = process.env[key];
}
Object.assign(privateEnv, { PATH: osPath, HOME: cloud, USERPROFILE: cloud, HOMEDRIVE: cloud.slice(0, 2), HOMEPATH: cloud.slice(2),
  APPDATA: join(cloud, "AppData", "Roaming"), LOCALAPPDATA: join(cloud, "AppData", "Local"),
  ANET_TEST_ROOT: appRoot, ANET_TEAM_RULES: "0", npm_config_cache: join(root, "npm-cache"), npm_config_audit: "false", npm_config_fund: "false" });
const profile = (name: string) => join(work, ".anet", "nodes", name);
function redact(text: string) {
  for (const name of ["local-daemon", "first-agent"]) {
    try { const cfg = JSON.parse(readFileSync(join(profile(name), "config.json"), "utf8"));
      for (const key of ["token", "auth_token"]) if (cfg[key]) secrets.add(cfg[key]); } catch {}
  }
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text.replace(/\b(?:ntok|atok|utok)_[A-Za-z0-9_-]+/g, "[redacted]");
}
async function mcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${hub.url.origin}/mcp`, { method: "POST", signal: AbortSignal.timeout(10_000), headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, network_id: network } } }) });
  assert(response.ok, `MCP HTTP ${response.status}`);
  const raw = await response.text(), data = raw.split("\n").find(line => line.startsWith("data: "));
  const wire = JSON.parse(data ? data.slice(6) : raw);
  assert(!wire.error, redact(JSON.stringify(wire.error ?? null)));
  return JSON.parse(wire.result.content[0].text);
}
async function wait<T>(read: () => Promise<T | null | false>, label: string, ms: number): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await read(); if (value) return value; await Bun.sleep(100); }
  throw Error(`timeout: ${label}`);
}
function collectLogs() {
  const result: Record<string, string> = {};
  for (const [key, path] of [["installer", join(root, "install-report.json")], ["start", join(work, "start.log")],
    ["child", join(profile("first-agent"), "logs", "spawn.log")]]) {
    try { result[key] = redact(readFileSync(path, "utf8")).slice(-16_000); } catch {}
  }
  return result;
}
try {
  evidence.app_source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: app, encoding: "utf8" }).trim();
  evidence.app_pr_head = process.env.ANET_APP_PR_HEAD ?? "NOT_RUN: not supplied outside CI";
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: hubSource, encoding: "utf8" }).trim(), hubSha);
  evidence.installer_source_sha256 = digest(join(app, "src-tauri", "src", "local_daemon.rs"));
  evidence.driver_sha256 = digest(driver);
  // OS-provided wsl/bash aliases can exist in System32; neither is invoked.
  for (const tool of ["node.exe", "npm.cmd", "anet.cmd", "git.exe"]) {
    let found = false;
    try { execFileSync(join(system32, "where.exe"), [tool], { env: privateEnv, windowsHide: true, stdio: "pipe" }); found = true; } catch {}
    assert(!found, `native installer must not find ambient ${tool}`);
  }
  assert(!existsSync(join(work, "node")) && !existsSync(join(work, "anet")));
  stages.environment = { status: "PASS" };
  const { bootServer } = await import(pathToFileURL(join(hubSource, "server", "src", "server.ts")).href);
  hub = bootServer({ port: 0, hostname: "127.0.0.1" });
  const login = await (await fetch(`${hub.url.origin}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `app_windows_${Date.now()}`, password: "LocalWindowsSmoke123!" }) })).json() as any;
  assert(login.ok, "local Hub registration failed"); token = login.token; network = login.network_id; secrets.add(token);
  const sessionFile = join(root, "session.json"), reportFile = join(root, "install-report.json");
  writeFileSync(sessionFile, JSON.stringify({ endpoint: hub.url.origin, token, network_id: network }));
  registry = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (decodeURIComponent(url.pathname).toLowerCase() === "/@sleep2agi/agent-network") {
      registryMisses++; return Response.json({ error: "fixture exact CLI missing" }, { status: 404 });
    }
    const upstream = await fetch(`https://registry.npmjs.org${url.pathname}${url.search}`);
    const headers = new Headers(upstream.headers); headers.delete("content-encoding"); headers.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers });
  } });
  privateEnv.npm_config_registry = registry.url.origin;
  const installStarted = Date.now();
  await exec(driver, [sessionFile, reportFile], { cwd: app, env: privateEnv, shell: false, windowsHide: true, timeout: 15 * 60_000, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(report.install.ok, true);
  assert(report.install.steps.every((step: any) => step.ok === true));
  assert(report.install.steps.some((step: any) => step.name.includes("下载私有 Node") && step.output.includes(".zip") && step.output.includes("SHA256 校验通过")));
  assert(registryMisses > 0 && report.install.steps.some((step: any) => step.output.includes("CLI SHA256 已校验")), "real verified release fallback must run");
  stages.private_node = { status: "PASS" }; stages.verified_cli = { status: "PASS" };
  const node = join(work, "node", "node.exe"), prefix = join(work, "anet"), cli = join(prefix, "node_modules", "@sleep2agi", "agent-network", "dist", "bin", "anet.cjs");
  assert.equal(report.scan.privateNode.path.toLowerCase(), node.toLowerCase());
  assert.equal(report.scan.anet.path.toLowerCase(), cli.toLowerCase());
  assert.equal(report.scan.anetCompatible, true); assert.equal(report.scan.agentNodeCompatible, true);
  for (const [name, pin] of [["agent-network", cliPin], ["agent-node", runtimePin]]) {
    assert.equal(JSON.parse(readFileSync(join(prefix, "node_modules", "@sleep2agi", name, "package.json"), "utf8")).version, pin.split("@").at(-1));
  }
  evidence.packages = { cli: cliPin, cli_tarball_url: constant("ANET_TARBALL_URL"), cli_tarball_sha256: cliHash, cli_entry_sha256: digest(cli), agent_node: runtimePin,
    node_version: report.scan.privateNode.version, node_executable_sha256: digest(node), node_distribution: "product latest-v22.x SHASUMS256 verified Windows ZIP",
    node_download: report.install.steps.find((step: any) => step.name.includes("下载私有 Node"))?.output };
  stages.pair = { status: "PASS" }; stages.installer = { status: "PASS", ms: Date.now() - installStarted };
  const daemonCfg = JSON.parse(readFileSync(join(profile("local-daemon"), "config.json"), "utf8"));
  assert.equal(daemonCfg.node_id, report.install.nodeId);
  assert.deepEqual(daemonCfg.runtimes_supported, ["claude-agent-sdk"]);
  const isolated = JSON.parse(readFileSync(join(home, ".anet", "config.json"), "utf8"));
  assert.equal(isolated.hub, hub.url.origin); assert.equal(isolated.network_id, network);
  const nodeEnv = { ...privateEnv, PATH: `${dirname(node)};${osPath}` };
  // The Rust driver has exited. The direct native node.exe launcher must
  // remain alive without its parent; inspect metadata, never emit argv.
  const quotePs = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const processProbe = await exec(join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
    `$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); $expected=${quotePs(node)}; $entry=${quotePs(cli)}; ` +
    "$matched=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $expected -and $_.CommandLine.Contains($entry) -and $_.CommandLine -match 'daemon\\s+start\\s+local-daemon' }); " +
    "if($matched.Count -ne 1){throw 'expected one surviving direct private-node daemon launcher'}; Write-Output 'direct-private-node-detached-ok'"],
    { env: nodeEnv, shell: false, windowsHide: true, timeout: 20_000 });
  assert.equal(processProbe.stdout.trim(), "direct-private-node-detached-ok");
  evidence.detached_launcher = "direct private node.exe + anet.cjs survives Rust installer exit (production DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP path)";
  // Execute under product-selected private node.exe, no runner Node or shell.
  const probe = await exec(node, ["-e", "console.log(JSON.stringify({home:require('node:os').homedir(),exec:process.execPath}))"], {
    env: { ...nodeEnv, HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2) }, shell: false, windowsHide: true,
  });
  assert.equal(JSON.parse(probe.stdout).home.toLowerCase(), home.toLowerCase());
  assert.equal(JSON.parse(probe.stdout).exec.toLowerCase(), node.toLowerCase());
  evidence.home_isolation = "private init credential path and explicit HOME/USERPROFILE os.homedir probe; sentinel detects writes, not a complete process-environment/read-isolation audit";
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
  const created = await mcp("create_node", { daemon_node_id: daemonCfg.node_id,
    node_spec: { name: "first-agent", runtime: "claude-agent-sdk", model: "claude-sonnet-4-5", channels: [] } });
  assert(created.ok, redact(JSON.stringify(created)));
  const child = await wait(async () => { const { session } = await mcp("get_session_status", { alias: "first-agent" });
    return session?.node_id && session.status === "idle" ? session : null; }, "SDK node online", 60_000);
  const sent = await mcp("send_task", { alias: "first-agent", task: "Say hello. Do not use tools." });
  const taskId = sent.task_id ?? sent.message_id; assert(sent.ok && taskId);
  await wait(async () => { const result = await mcp("get_task", { task_id: taskId }); const row = result.task ?? result;
    assert(!["failed", "cancelled"].includes(row.status), redact(JSON.stringify(row)));
    return typeof row.result === "string" && row.result.includes(marker) ? row : null; }, "SDK first reply", 120_000);
  assert(modelHits > 0, "reply must originate in model HTTP fixture");
  const installToReply = Date.now() - installStarted;
  evidence.install_to_reply_ms = installToReply; evidence.model_http_requests = modelHits;
  assert(installToReply <= 180_000, `download/install-to-reply exceeded 3 minutes: ${installToReply}ms`);
  stages.sdk_reply = { status: "PASS", ms: installToReply };
  assert.equal(readFileSync(sentinel, "utf8"), "CLOUD-SENTINEL-DO-NOT-READ-OR-WRITE");
  assert.equal(JSON.parse(readFileSync(join(profile("first-agent"), "config.json"), "utf8")).hub, hub.url.origin);
  const { db } = await import(pathToFileURL(join(hubSource, "server", "src", "db.ts")).href);
  const stopStarted = Date.now();
  const stopped = await mcp("stop_node", { node_id: child.node_id }); assert(stopped.ok, redact(JSON.stringify(stopped)));
  const ack = await wait(async () => {
    const row = db.get("SELECT status, error, exit_signal, acked_at FROM node_stop_requests WHERE request_id = ?1", stopped.request_id) as any;
    assert(row?.status !== "stop_failed", redact(JSON.stringify(row)));
    return row?.status === "stopped" ? row : null;
  }, "Hub accepts strict stopped ACK", 15_000);
  const stopMs = Date.now() - stopStarted;
  assert(stopMs <= 15_000, `dispatch through accepted Hub ACK exceeded 15 seconds: ${stopMs}ms`);
  assert(ack.acked_at && ack.exit_signal === "taskkill");
  stages.stop_ack = { status: "PASS", ms: stopMs };
  evidence.stopped = true; evidence.cloud_sentinel = "unchanged (write evidence, not proof of read isolation)";
} catch (error) {
  evidence.error = redact(String(error)); evidence.diagnostics = collectLogs();
  console.error(evidence.error); process.exitCode = 1;
} finally {
  // Cleanup is not the SDK stop acceptance. Delegate ownership checks to the
  // same pinned product CLI; no raw-PID/name-based kill fallback is permitted.
  let cleanupFailed = false;
  try {
    for (const name of readdirSync(join(work, ".anet", "nodes"))) {
      const dir = profile(name);
      if (!existsSync(join(dir, ".pid"))) continue;
      const node = join(work, "node", "node.exe");
      const cli = join(work, "anet", "node_modules", "@sleep2agi", "agent-network", "dist", "bin", "anet.cjs");
      try {
        await exec(node, [cli, "node", "stop", name], { cwd: work, env: { ...privateEnv, PATH: `${dirname(node)};${osPath}`,
          HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2) },
          shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
        assert(!existsSync(join(dir, ".pid")), "product cleanup must remove its stopped PID receipt");
      } catch { cleanupFailed = true; }
    }
  } catch (error: any) { if (error.code !== "ENOENT") cleanupFailed = true; }
  hub?.stop(true); vendor?.stop(true); registry?.stop(true);
  stages.cleanup = { status: cleanupFailed ? "FAIL" : "PASS", reason: "pinned product CLI ownership-checked cleanup only; no daemon crash-recovery claim" };
  if (cleanupFailed) process.exitCode = 1;
  evidence.status = process.exitCode || Object.values(stages).some(stage => stage.status !== "PASS") ? "FAIL" : "PASS";
  if (evidence.status !== "PASS") process.exitCode = 1;
  save(); console.log(JSON.stringify({ ...evidence, diagnostics: undefined }));
}
