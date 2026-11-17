import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeGate, runCommand, type Stage } from "./native-gate";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "native-gate & "));
  const file = join(root, "evidence.json");
  const evidence: { status: string; stages: Record<string, Stage> } = { status: "RUNNING", stages: {} };
  const gate = new NativeGate(evidence, () => writeFileSync(file, JSON.stringify(evidence)));
  return { root, file, evidence, gate };
}

test("each phase persists ENTER and PASS before the next phase", async () => {
  const f = fixture();
  await f.gate.run("probe", 1000, async () => {
    expect(JSON.parse(readFileSync(f.file, "utf8")).stages.probe.status).toBe("RUNNING");
  });
  expect(JSON.parse(readFileSync(f.file, "utf8")).stages.probe.status).toBe("PASS");
});

test("never-settling work fails and persists without waiting for job timeout", async () => {
  const f = fixture(), at = Date.now();
  await expect(f.gate.run("stalled", 60, () => new Promise(() => {}))).rejects.toThrow("hard deadline exceeded: stalled");
  const result = JSON.parse(readFileSync(f.file, "utf8"));
  expect(result.status).toBe("FAIL"); expect(result.stages.stalled.status).toBe("FAIL");
  expect(result.stages.stalled.reason).toContain("hard deadline"); expect(Date.now() - at).toBeLessThan(1000);
});

test("absolute first-reply budget is shared, not restarted for later steps", async () => {
  const f = fixture(), end = Date.now() + 100;
  await f.gate.run("install", 1000, async () => { await Bun.sleep(60); }, end);
  await expect(f.gate.run("reply", 1000, () => new Promise(() => {}), end)).rejects.toThrow("hard deadline");
  expect(f.evidence.stages.reply.deadline_at).toBe(end);
  let entered = false;
  await expect(f.gate.run("too_late", 1000, () => { entered = true; }, end)).rejects.toThrow("hard deadline");
  expect(entered).toBe(false);
});

test("direct child deadline aborts child without waiting for output close", async () => {
  const f = fixture(); let exited: number | null | undefined;
  await expect(f.gate.run("driver", 100, signal => runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    signal, logPrefix: join(f.root, "driver"), onEvent: e => { if (e.state === "exited") exited = e.code; },
  }))).rejects.toThrow("hard deadline");
  await Bun.sleep(200); expect(exited).not.toBeUndefined();
  expect(f.evidence.stages.driver.status).toBe("FAIL");
});

test("detached descendant inherited stdout does not delay direct driver exit", async () => {
  const f = fixture();
  await f.gate.run("driver_exit", 800, signal => runCommand(process.execPath, ["-e",
    `require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:'inherit'}).unref()`],
  { signal, logPrefix: join(f.root, "driver") }));
  expect(f.evidence.stages.driver_exit.status).toBe("PASS");
});

test("stalled loopback HTTP is aborted and attributed to the exact stage", async () => {
  const f = fixture();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise(() => {}) });
  try {
    await expect(f.gate.run("create_node", 60, signal => fetch(server.url, { signal }))).rejects.toThrow("hard deadline");
    expect(JSON.parse(readFileSync(f.file, "utf8")).stages.create_node.status).toBe("FAIL");
  } finally { server.stop(true); }
});

test("spaces and ampersands remain literal cwd/argv without a command shell", async () => {
  const f = fixture(), argument = "literal & echo MUST_NOT_EXECUTE";
  const result = await f.gate.run("literal_argv", 1500, signal => runCommand(process.execPath,
    ["-e", "console.log(JSON.stringify({cwd:process.cwd(),argv:process.argv}))", argument],
    { signal, cwd: f.root, logPrefix: join(f.root, "argv") }));
  const value = JSON.parse(result.stdout);
  expect(value.cwd).toBe(f.root); expect(value.argv).toContain(argument);
});
