import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";

export type Stage = { status: string; reason?: string; ms?: number; started_at?: number; deadline_at?: number; finished_at?: number };

/** Persist both sides of every await; timeout rejection does not wait for the
 * stalled operation, its output-pipe closure, or a workflow/job timeout. */
export class NativeGate {
  constructor(readonly evidence: { stages: Record<string, Stage>; [key: string]: any },
    private persist: () => void, private redact: (text: string) => string = text => text) {}

  async run<T>(name: string, budgetMs: number, action: (signal: AbortSignal) => Promise<T> | T, absoluteDeadline = Infinity): Promise<T> {
    const started = Date.now(), deadline = Math.min(started + budgetMs, absoluteDeadline);
    const stage: Stage = { status: "RUNNING", started_at: started, deadline_at: deadline };
    if (this.evidence.status !== "FAIL") this.evidence.status = "RUNNING";
    this.evidence.stages[name] = stage; this.evidence.active_stage = name; this.persist();
    console.log(`[native-gate] ${name} ENTER budget_ms=${Math.max(0, deadline - started)}`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failure = () => new Error(`hard deadline exceeded: ${name}; budget_ms=${Math.max(0, deadline - started)}`);
    try {
      if (deadline <= started) throw failure();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = failure();
          // Write before abort/reject, even if the caller's finally later stalls.
          Object.assign(stage, { status: "FAIL", reason: error.message, ms: Date.now() - started, finished_at: Date.now() });
          this.evidence.status = "FAIL"; this.persist();
          controller.abort(error); reject(error);
        }, deadline - started);
      });
      const result = await Promise.race([Promise.resolve().then(() => action(controller.signal)), timeout]);
      // A synchronous step that consumed its budget is not allowed to pass.
      if (Date.now() > deadline) throw failure();
      Object.assign(stage, { status: "PASS", ms: Date.now() - started, finished_at: Date.now() });
      this.persist(); console.log(`[native-gate] ${name} PASS ms=${stage.ms}`);
      return result;
    } catch (error) {
      Object.assign(stage, { status: "FAIL", reason: this.redact(String(error)), ms: Date.now() - started, finished_at: Date.now() });
      this.evidence.status = "FAIL"; this.persist(); controller.abort(error);
      console.error(`[native-gate] ${name} FAIL ms=${stage.ms}`);
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  }
}

/** Direct argv launch and exit-event wait, with file-backed output: a detached
 * descendant retaining an inherited pipe cannot hold the harness open. Abort
 * kills only this ChildProcess handle, never a raw PID or name-selected tree. */
export async function runCommand(executable: string, args: string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; signal: AbortSignal; logPrefix: string;
  onEvent?: (event: { state: string; pid?: number; code?: number | null; signal?: string | null }) => void;
}): Promise<{ stdout: string; stderr: string }> {
  options.signal.throwIfAborted();
  const stdout = `${options.logPrefix}.stdout`, stderr = `${options.logPrefix}.stderr`;
  const out = openSync(stdout, "w"), err = openSync(stderr, "w");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: options.cwd, env: options.env, shell: false,
        windowsHide: true, stdio: ["ignore", out, err] });
      const abort = () => { child.kill("SIGKILL"); reject(options.signal.reason ?? Error("command aborted")); };
      options.signal.addEventListener("abort", abort, { once: true });
      options.onEvent?.({ state: "spawned", pid: child.pid });
      child.once("error", error => { options.signal.removeEventListener("abort", abort); reject(error); });
      child.once("exit", (code, signal) => {
        options.signal.removeEventListener("abort", abort);
        try {
        options.onEvent?.({ state: "exited", pid: child.pid, code, signal });
        if (code !== 0) { reject(Error(`direct command exited code=${code} signal=${signal}`)); return; }
        resolve({ stdout: readFileSync(stdout, "utf8"), stderr: readFileSync(stderr, "utf8") });
        } catch (error) { reject(error); }
      });
      if (options.signal.aborted) abort();
    });
  } finally { closeSync(out); closeSync(err); }
}
