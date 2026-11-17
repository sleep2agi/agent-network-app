// Surgical reproduction of the *published* .209 writer, not a daemon E2E.
// Extract its synchronous helpers without evaluating the CLI entrypoint.
// All filesystem/crypto calls below are real, confined to a temporary fixture.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";

const root = fs.mkdtempSync(path.join(tmpdir(), "anet-writer & "));
const url = "https://registry.npmjs.org/@sleep2agi/agent-node/-/agent-node-2.5.0-preview.209.tgz";
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
assert(response.ok, `published runtime download: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash("sha256").update(bytes).digest("hex"), "cc32d818e9f780a60a1d6c976d5a9ea2174b0a9cf4e5700f626f9a377ad489b1", "published .209 artifact identity");
fs.writeFileSync(path.join(root, "runtime.tgz"), bytes);
execFileSync("tar", ["-xzf", path.join(root, "runtime.tgz"), "-C", root], { timeout: 10_000 });
const bundle = fs.readFileSync(path.join(root, "package/dist/cli.js"), "utf8");
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package/package.json"), "utf8")).version, "2.5.0-preview.209");
assert(bundle.includes("ensureGlobalAnetConfig:()=>KZ"));
assert(bundle.includes("KZ(cC(process.env,process.platform),Q.hubUrl)"));
const names = ["KZ", "cC", "LQ", "AD", "dc", "nc", "oc", "SJ"];
const functions = names.map(name => {
  const match = bundle.match(new RegExp(`function ${name}\\([^]*?(?=function )`));
  assert(match, `pinned helper missing: ${name}`); return match[0];
});
const api = runInNewContext(functions.join("\n") + ";({write:KZ,home:cC})", {
  process, Buffer,
  YB: path.join, vD: fs.mkdirSync, jU: fs.readFileSync,
  cc: path.dirname, nWA: path.join, dWA: path.basename, oWA: path.resolve, aWA: path.sep,
  rWA: randomBytes, A0: fs.constants, Qj: fs.openSync, iWA: fs.writeFileSync,
  Aj: fs.fchmodSync, lWA: fs.fsyncSync, ZV: fs.closeSync, NA: fs.renameSync,
  pWA: fs.rmSync, uc: fs.lstatSync, mc: fs.fstatSync, s2: fs.existsSync,
});
const hub = "http://127.0.0.1:58122";
let cases = 0;
for (const platform of ["win32", "darwin", "linux"]) {
  for (const original of ["CLOUD-SENTINEL-DO-NOT-READ-OR-WRITE", JSON.stringify({ hub: "https://cloud.example", token: "fake-cloud-token", network_id: "fake-cloud-net" })]) {
    const home = path.join(root, `${platform}-${cases++}`);
    fs.mkdirSync(path.join(home, ".anet"), { recursive: true });
    const config = path.join(home, ".anet/config.json"); fs.writeFileSync(config, original);
    const env = { HOME: home, USERPROFILE: home };
    api.write(api.home(env, platform), hub);
    const changed = JSON.parse(fs.readFileSync(config, "utf8"));
    assert.equal(changed.hub, hub);
    if (original.startsWith("CLOUD")) assert.deepEqual(changed, { hub });
    else { assert.equal(changed.token, "fake-cloud-token"); assert.equal(changed.network_id, "fake-cloud-net"); }
  }
}
// The Windows fix redirects exactly this writer, without changing its package.
const cloud = path.join(root, "cloud-home"), isolated = path.join(root, "private-home");
fs.mkdirSync(path.join(cloud, ".anet"), { recursive: true });
const sentinel = path.join(cloud, ".anet/config.json"); fs.writeFileSync(sentinel, "cloud-sentinel");
api.write(api.home({ HOME: isolated, USERPROFILE: isolated, HOMEDRIVE: "", HOMEPATH: isolated }, "win32"), hub);
assert.equal(fs.readFileSync(sentinel, "utf8"), "cloud-sentinel");
assert.equal(JSON.parse(fs.readFileSync(path.join(isolated, ".anet/config.json"), "utf8")).hub, hub);
console.log(JSON.stringify({ status: "PASS", scope: "published writer/helper extraction, real temporary filesystem; not native macOS/Windows daemon acceptance",
  runtime: "2.5.0-preview.209", tarball_sha256: createHash("sha256").update(bytes).digest("hex"),
  bundle_sha256: createHash("sha256").update(bundle).digest("hex"), overwritten_cases: cases, private_home_redirect: "PASS" }, null, 2));

// App main's Unix pin is older than the Windows branch. Inspect that exact
// published package too; do not assume .209's result establishes .138 delivery.
const oldResponse = await fetch("https://registry.npmjs.org/@sleep2agi/agent-node/-/agent-node-2.5.0-preview.138.tgz", { signal: AbortSignal.timeout(30_000) });
assert(oldResponse.ok);
const oldBytes = Buffer.from(await oldResponse.arrayBuffer());
assert.equal(createHash("sha256").update(oldBytes).digest("hex"), "101c9a85622db3c6934e48ec5239d105e1b315cc0f7d53a183056b6514ccfd7f", "published .138 artifact identity");
const oldRoot = path.join(root, "unix-pin"); fs.mkdirSync(oldRoot);
fs.writeFileSync(path.join(oldRoot, "runtime.tgz"), oldBytes);
execFileSync("tar", ["-xzf", path.join(oldRoot, "runtime.tgz"), "-C", oldRoot], { timeout: 10_000 });
const oldBundle = fs.readFileSync(path.join(oldRoot, "package/dist/cli.js"), "utf8");
const alias = oldBundle.match(/ensureGlobalAnetConfig:\(\)=>\s*(\w+)/)?.[1]; assert(alias);
const oldWriter = oldBundle.match(new RegExp(`function ${alias}\\([^]*?(?=function )`))?.[0]; assert(oldWriter);
assert(oldWriter.includes('".anet"') && oldWriter.includes('"config.json"') && oldWriter.includes(".hub="));
const call = oldBundle.match(new RegExp(`${alias}\\([^;]*?\\.hubUrl\\)`))?.[0]; assert(call);
console.log(JSON.stringify({ status: "PASS", scope: "static published Unix-pin writer and call-site inspection, not native macOS execution",
  runtime: "2.5.0-preview.138", tarball_sha256: createHash("sha256").update(oldBytes).digest("hex"),
  writer: oldWriter, call }, null, 2));
