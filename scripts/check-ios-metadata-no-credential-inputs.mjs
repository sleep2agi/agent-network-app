#!/usr/bin/env node
// #2097 —— `.github/workflows/ios-app-store-metadata.yml` 的静态回归门。
//
// 背景：PR1045 合并后，该 workflow 仍把 `demo_account`（可含 user/password）定义成
// 普通 `workflow_dispatch` 输入，并把它拼进 reviewer notes；`dry_run=true` 时还会把
// notes 全文打出来。dispatch 输入会留在 run 元数据里 —— 谁能触发谁就能看到。
//
// 这条门只做三件事，多一条都不做：
//   1. 该文件不得再有 `demo_account` / `demo_hub_url` 这类**凭据型 dispatch 输入**；
//   2. 演示信息只能从 `secrets.REVIEW_DEMO_*` 读，不得从 `inputs.*` 读；
//   3. dry-run 不得回显 notes 全文（`printf … "$notes"`），只允许打印长度与 provided/not provided。
//
// 退出码：0 = 合规；1 = 违反（并打印**行号**，不打印任何值）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node 里没有 Bun 的 `import.meta.dir`；用 dirname(fileURLToPath(...)) 兼容两者。
const HERE = typeof import.meta.dir === "string" ? import.meta.dir : dirname(fileURLToPath(import.meta.url));

const FILE = join(HERE, "..", ".github", "workflows", "ios-app-store-metadata.yml");
const src = readFileSync(FILE, "utf8");
const lines = src.split(/\r?\n/);

/** 在 `on.workflow_dispatch.inputs` 段落里，找不允许出现的输入名。 */
function dispatchInputNames() {
  const names = [];
  let inInputs = false;
  let inputsIndent = null;
  for (const line of lines) {
    if (/^\s{0,6}inputs:\s*$/.test(line)) {
      inInputs = true;
      inputsIndent = line.match(/^\s*/)[0].length;
      continue;
    }
    if (!inInputs) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (line.trim() && indent <= inputsIndent) { inInputs = false; continue; }
    const m = line.match(/^\s+([A-Za-z0-9_-]+):\s*$/);
    if (m && indent === inputsIndent + 2) names.push(m[1]);
  }
  return names;
}

const failures = [];
const forbiddenInputs = ["demo_account", "demo_hub_url", "demo_password", "reviewer_account"];

for (const name of dispatchInputNames()) {
  if (forbiddenInputs.includes(name)) {
    failures.push(`dispatch input '${name}' must not exist (credentials belong in environment secrets)`);
  }
}

lines.forEach((line, i) => {
  const n = i + 1;
  if (/inputs\.(demo_account|demo_hub_url|demo_password|reviewer_account)/.test(line)) {
    failures.push(`line ${n}: reads a credential-bearing dispatch input via inputs.*`);
  }
  // dry-run 回显 notes 全文（含演示地址/账号）
  if (/\$\{?notes\}?/.test(line) && /printf|echo/.test(line) && !/length=\$\{#notes\}/.test(line)) {
    failures.push(`line ${n}: echoes the reviewer notes body (它可能包含演示地址/账号)`);
  }
});

if (failures.length > 0) {
  process.stderr.write("check-ios-metadata-no-credential-inputs: FAIL\n");
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write("check-ios-metadata-no-credential-inputs: OK\n");
