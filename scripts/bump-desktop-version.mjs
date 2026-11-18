#!/usr/bin/env node
// #1446 — 发版 bump 的 **dry-run** 版本：只计算并打印将发生的修改，不写任何文件。
//
// 为什么先做 dry-run：bump 会动发版关键文件（Cargo.toml / Cargo.lock / workflow / 生成物），
// 一旦正则锚错就会在打包阶段才炸。先用 0.2.567 的 dry-run patch 与人工 bump 的 diff 逐字对比，
// 一致后再加落盘、自检与回滚。
//
// 用法：
//   node scripts/bump-desktop-version.mjs --to 0.2.567 --notes-file /tmp/notes.md
//
// 约束（负责人 2026-11-19）：
//   · --notes-file 必填：没有就不执行（避免生成空的 What's new 段）；
//   · Cargo.toml / Cargo.lock 必须按 **根包名** 锚定（本仓是 agent-network-desktop），
//     不靠「第一个匹配」——人工 bump 能过只是因为根包碰巧排在最前。
//
// 退出码：0 = 计划可行；非 0 = 参数/文件不匹配（并说明哪一处）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_PACKAGE = 'agent-network-desktop';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { to: '', notesFile: '', dryRun: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i] || '';
    else if (a === '--notes-file') out.notesFile = argv[++i] || '';
    else if (a === '--apply') out.dryRun = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else fail(`未知参数 ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法: node scripts/bump-desktop-version.mjs --to <x.y.z> --notes-file <path>   （默认 dry-run）');
  process.exit(0);
}
if (!args.to) fail('缺少 --to <x.y.z>');
if (!args.notesFile) fail('缺少 --notes-file（必填：拒绝生成空的 What\'s new 段）');
if (!args.dryRun) fail('本版本只支持 dry-run；--apply 等人工 diff 对齐后再开');

const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(args.to);
if (!semver) fail(`--to 不是 x.y.z：${args.to}`);
const [major, minor, patch] = [Number(semver[1]), Number(semver[2]), Number(semver[3])];
const wantCode = major * 1_000_000 + minor * 1_000 + patch;

const notes = readFileSync(args.notesFile, 'utf8').trim();
if (!notes) fail('notes 文件为空');

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const plans = [];
function plan(file, detail, before, after, count = 1) {
  plans.push({ file, detail, before, after, count });
}
function replaceOnce(file, text, pattern, after, detail) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) fail(`${file}: ${detail} 命中 ${matches.length} 处（要求 1 处），拒绝继续`);
  const before = matches[0][0];
  plan(file, detail, before, before.replace(pattern, after));
}

const pkgRaw = read('package.json');
const current = JSON.parse(pkgRaw).version;
if (!/^\d+\.\d+\.\d+$/.test(current)) fail(`当前版本不是 x.y.z：${current}`);
const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
if (cmp(args.to, current) <= 0) fail(`目标 ${args.to} 必须大于当前 ${current}`);

// 1/2 package.json + package-lock.json（版本号字符串，锁文件必须正好两处）
replaceOnce('package.json', pkgRaw, /"version":\s*"[^"]+"/, `"version": "${args.to}"`, 'version');
const lockRaw = read('package-lock.json');
{
  const matches = [...lockRaw.matchAll(/"version":\s*"(\d+\.\d+\.\d+)"/g)].filter((m) => m[1] === current);
  if (matches.length < 2) fail(`package-lock.json: 当前版本字符串命中 ${matches.length} 处（要求 ≥2：顶层 + packages[""]）`);
  plan('package-lock.json', `version 出现 ${matches.length} 处（顶层 + packages[""]）`, current, args.to, matches.length);
}

// 3/4 app.json
const appRaw = read('app.json');
const appJson = JSON.parse(appRaw);
if (appJson?.expo?.version !== current) fail(`app.json: expo.version=${appJson?.expo?.version}，与 package.json 的 ${current} 不一致`);
replaceOnce('app.json', appRaw, /"version":\s*"[^"]+"/, `"version": "${args.to}"`, 'expo.version');
replaceOnce('app.json', appRaw, /"versionCode":\s*\d+/, `"versionCode": ${wantCode}`, 'expo.android.versionCode');

// 5 tauri.conf.json
replaceOnce('src-tauri/tauri.conf.json', read('src-tauri/tauri.conf.json'), /"version":\s*"[^"]+"/, `"version": "${args.to}"`, 'version');

// 6 Cargo.toml —— 锚定 [package] 段；不靠第一个匹配
const cargoToml = read('src-tauri/Cargo.toml');
{
  const m = /\[package\][\s\S]*?\nname\s*=\s*"([^"]+)"[\s\S]*?\nversion\s*=\s*"([^"]+)"/.exec(cargoToml);
  if (!m) fail('Cargo.toml: 找不到 [package] 段的 name/version');
  if (m[1] !== ROOT_PACKAGE) fail(`Cargo.toml: [package].name=${m[1]}，期望 ${ROOT_PACKAGE}`);
  if (m[2] !== current) fail(`Cargo.toml: [package].version=${m[2]}，与 ${current} 不一致`);
  plan('src-tauri/Cargo.toml', `[package] ${ROOT_PACKAGE}.version`, m[2], args.to);
}

// 7 Cargo.lock —— 锚定包裹名的块
const cargoLock = read('src-tauri/Cargo.lock');
{
  const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${ROOT_PACKAGE}"\\nversion = ")([^"]+)(")`);
  const m = re.exec(cargoLock);
  if (!m) fail(`Cargo.lock: 找不到 [[package]] name = "${ROOT_PACKAGE}" 块`);
  if (m[2] !== current) fail(`Cargo.lock: 根包 version=${m[2]}，与 ${current} 不一致`);
  plan('src-tauri/Cargo.lock', `[[package]] ${ROOT_PACKAGE}.version`, m[2], args.to);
}

// 8 src/version.ts
replaceOnce('src/version.ts', read('src/version.ts'), /APP_VERSION\s*=\s*'[^']+'/, `APP_VERSION = '${args.to}'`, 'APP_VERSION');

// 9 version-consistency 测试里的期望值
{
  const text = read('src/version-consistency.test.ts');
  const hits = text.split(`'${current}'`).length - 1;
  if (hits !== 1) fail(`version-consistency.test.ts: '${current}' 命中 ${hits} 处（要求 1 处）`);
  plan('src/version-consistency.test.ts', `期望版本字面量 ×${hits}`, current, args.to, hits);
}

// 10 workflow releaseBody：插入新段（保留缩进，新段在最前）
{
  const wf = read('.github/workflows/release-desktop-auto-update.yml');
  const anchor = /(\n([ \t]+)What's new in \d+\.\d+\.\d+:)/.exec(wf);
  if (!anchor) fail('workflow: 找不到既有的 What\'s new 段作为插入点');
  const indent = anchor[2];
  const body = notes.split('\n').map((line) => (line.trim() ? `${indent}${line}` : '')).join('\n');
  const insertion = `\n${indent}What's new in ${args.to}:\n${body}`;
  plan('.github/workflows/release-desktop-auto-update.yml', `插入 What's new in ${args.to}（缩进 ${indent.length} 空格）`, anchor[0].trim(), insertion.trim());
}

// 11 生成物：dry-run 只说明要跑生成器
plan('src/changelog-bundled.ts', '生成物（dry-run 不写；落盘版本会执行 node scripts/changelog-bundle.mjs）', current, args.to);

console.log(`dry-run: ${current} → ${args.to}（versionCode ${wantCode}）`);
for (const p of plans) {
  console.log(`  ${p.file}: ${p.detail}${p.count > 1 ? ` ×${p.count}` : ''}`);
  console.log(`      - ${p.before}`);
  console.log(`      + ${p.after}`);
}
console.log('\n没有写任何文件。对齐人工 diff 后再开落盘（--apply）。');
