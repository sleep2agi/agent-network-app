#!/usr/bin/env node
// #1446 — 发版 bump：默认 **dry-run**（只打印计划，不写文件）；`--apply` 才落盘。
//
// 为什么默认 dry-run：bump 会动发版关键文件（Cargo.toml / Cargo.lock / workflow / 生成物），
// 正则锚错就要到打包阶段才炸。先与人工 diff 对齐，再用 --apply。
//
// 用法：
//   node scripts/bump-desktop-version.mjs --to 0.2.567 --notes-file /tmp/notes.md            # 只打印
//   node scripts/bump-desktop-version.mjs --to 0.2.567 --notes-file /tmp/notes.md --apply    # 落盘
//
// --apply 做的事：写 9 个文件 → 跑 scripts/changelog-bundle.mjs → 跑 version-consistency / changelog-bundled 两个测试；
// 任一步失败 ⇒ 用内存里的原文回滚全部文件并退出 1（不自动 commit/push/开 PR）。
//
// 约束：
//   · --notes-file 必填（拒绝生成空的 What's new 段）；
//   · Cargo.toml / Cargo.lock 按 **根包名**（从 Cargo.toml 的 [package].name 读出）锚定，不用「第一个匹配」；
//   · 新段与其后段落之间保留**一个空行**（与历史格式一致）。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const NOTES_BLANK_AFTER = true;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { to: '', notesFile: '', apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i] || '';
    else if (a === '--notes-file') out.notesFile = argv[++i] || '';
    else if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else fail(`未知参数 ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法: node scripts/bump-desktop-version.mjs --to <x.y.z> --notes-file <path> [--apply]');
  process.exit(0);
}
if (!args.to) fail('缺少 --to <x.y.z>');
if (!args.notesFile) fail('缺少 --notes-file（必填：拒绝生成空的 What\'s new 段）');

const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(args.to);
if (!semver) fail(`--to 不是 x.y.z：${args.to}`);
const [major, minor, patch] = [Number(semver[1]), Number(semver[2]), Number(semver[3])];
const wantCode = major * 1_000_000 + minor * 1_000 + patch;

const notes = readFileSync(args.notesFile, 'utf8').trim();
if (!notes) fail('notes 文件为空');

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const edits = [];
function edit(path, before, after, detail) {
  if (before === after) fail(`${path}: ${detail} 没有变化（拒绝写空补丁）`);
  edits.push({ path, before, after, detail });
}
function replaceCount(path, text, needle, replacement, expected, detail) {
  const hits = text.split(needle).length - 1;
  if (hits !== expected) fail(`${path}: ${detail} 命中 ${hits} 处（要求 ${expected}）`);
  return text.split(needle).join(replacement);
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

const oldCode = (() => {
  const [a, b, c] = current.split('.').map(Number);
  return a * 1_000_000 + b * 1_000 + c;
})();

// 1 package.json
edit('package.json', pkgRaw, replaceCount('package.json', pkgRaw, `"version": "${current}"`, `"version": "${args.to}"`, 1, 'version'), 'version');

// 2 package-lock.json（顶层 + packages[""]，共 2 处）
{
  const raw = read('package-lock.json');
  edit('package-lock.json', raw, replaceCount('package-lock.json', raw, `"version": "${current}"`, `"version": "${args.to}"`, 2, 'version ×2'), 'version ×2（顶层 + packages[""]）');
}

// 3/4 app.json
{
  const raw = read('app.json');
  const app = JSON.parse(raw);
  if (app?.expo?.version !== current) fail(`app.json: expo.version=${app?.expo?.version}，与 package.json 的 ${current} 不一致`);
  let next = replaceCount('app.json', raw, `"version": "${current}"`, `"version": "${args.to}"`, 1, 'expo.version');
  next = replaceCount('app.json', next, `"versionCode": ${oldCode}`, `"versionCode": ${wantCode}`, 1, 'expo.android.versionCode');
  edit('app.json', raw, next, `expo.version + versionCode ${oldCode}→${wantCode}`);
}

// 5 tauri.conf.json
{
  const raw = read('src-tauri/tauri.conf.json');
  edit('src-tauri/tauri.conf.json', raw, replaceCount('src-tauri/tauri.conf.json', raw, `"version": "${current}"`, `"version": "${args.to}"`, 1, 'version'), 'version');
}

// 6 Cargo.toml（[package] 段内，根包名从文件读取）
const cargoToml = read('src-tauri/Cargo.toml');
const rootName = (() => {
  const m = /\[package\][\s\S]*?\nname\s*=\s*"([^"]+)"/.exec(cargoToml);
  if (!m) fail('Cargo.toml: 找不到 [package].name');
  return m[1];
})();
{
  const re = new RegExp(`(\\[package\\][\\s\\S]*?\\nversion\\s*=\\s*")${current.replace(/\./g, '\\.')}(")`);
  const m = re.exec(cargoToml);
  if (!m) fail(`Cargo.toml: [package] 段找不到 version = "${current}"（根包 ${rootName}）`);
  edit('src-tauri/Cargo.toml', cargoToml, cargoToml.replace(re, `$1${args.to}$2`), `[package] ${rootName}.version`);
}

// 7 Cargo.lock（用同一个根包名锚定块）
{
  const raw = read('src-tauri/Cargo.lock');
  const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${rootName}"\\nversion = ")${current.replace(/\./g, '\\.')}(")`);
  const m = re.exec(raw);
  if (!m) fail(`Cargo.lock: 找不到 [[package]] name = "${rootName}" version = "${current}"`);
  edit('src-tauri/Cargo.lock', raw, raw.replace(re, `$1${args.to}$2`), `[[package]] ${rootName}.version`);
}

// 8 src/version.ts
{
  const raw = read('src/version.ts');
  edit('src/version.ts', raw, replaceCount('src/version.ts', raw, `APP_VERSION = '${current}'`, `APP_VERSION = '${args.to}'`, 1, 'APP_VERSION'), 'APP_VERSION');
}

// 9 version-consistency 测试
{
  const raw = read('src/version-consistency.test.ts');
  edit('src/version-consistency.test.ts', raw, replaceCount('src/version-consistency.test.ts', raw, `'${current}'`, `'${args.to}'`, 1, '期望版本字面量'), '期望版本字面量');
}

// 10 workflow（新段在既有首个 What's new 之前；段后保留一个空行）
{
  const raw = read('.github/workflows/release-desktop-auto-update.yml');
  const anchor = /(\n([ \t]+)What's new in \d+\.\d+\.\d+:)/.exec(raw);
  if (!anchor) fail('workflow: 找不到既有的 What\'s new 段作为插入点');
  const indent = anchor[2];
  const body = notes.split('\n').map((line) => (line.trim() ? `${indent}${line}` : '')).join('\n');
  const insertion = `\n${indent}What's new in ${args.to}:\n${body}${NOTES_BLANK_AFTER ? '\n' : ''}`;
  edit('.github/workflows/release-desktop-auto-update.yml', raw, raw.replace(anchor[0], `${insertion}${anchor[0]}`), `插入 What's new in ${args.to}（缩进 ${indent.length} 空格，段后空行）`);
}

console.log(`${args.apply ? 'apply' : 'dry-run'}: ${current} → ${args.to}（versionCode ${wantCode}，根包 ${rootName}）`);
for (const e of edits) console.log(`  ${e.path}: ${e.detail}`);

if (!args.apply) {
  console.log('\n没有写任何文件（dry-run）。加 --apply 才落盘。');
  process.exit(0);
}

// ── apply：写文件 → 生成物 → 自检；失败回滚 ──
const written = [];
// 🔴 changelog-bundled.ts 是**生成物**，不在 edits 里：跑生成器前先留原文，回滚时要把它也写回，
// 否则自检失败时会留下「版本号是旧的、生成物是新的」这种半套状态。
const GENERATED = 'src/changelog-bundled.ts';
let generatedBefore = null;
try { generatedBefore = readFileSync(resolve(process.cwd(), GENERATED), 'utf8'); } catch { generatedBefore = null; }
const restore = () => {
  for (const e of written.reverse()) {
    try { writeFileSync(resolve(process.cwd(), e.path), e.before); } catch { /* best effort */ }
  }
  if (generatedBefore !== null) {
    try { writeFileSync(resolve(process.cwd(), GENERATED), generatedBefore); } catch { /* best effort */ }
  }
  console.error('✗ 已回滚全部文件（含生成物，保持原样）');
};
for (const e of edits) {
  try {
    writeFileSync(resolve(process.cwd(), e.path), e.after);
    written.push(e);
  } catch (error) {
    restore();
    fail(`写 ${e.path} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { stdio: 'inherit' });
  return r.status === 0;
};

if (!run('node', ['scripts/changelog-bundle.mjs'])) {
  restore();
  fail('changelog-bundle.mjs 失败（生成物没有更新）');
}

const bun = process.env.BUN || 'bun';
for (const test of ['src/version-consistency.test.ts', 'src/changelog-bundled.test.ts']) {
  if (!run(bun, [test])) {
    restore();
    fail(`自检失败：${test}`);
  }
}

console.log('\n✓ 已落盘并通过自检。下一步：git diff --stat，再跑 verify-bump。');
