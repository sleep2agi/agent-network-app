// ck-style (self-executing; run by scripts/run-tests.mjs — NOT bun:test).
// iOS 发图闪退(TestFlight 崩溃日志 0.2.178 build 70 / build 28):`ImageManipulator.manipulate(<ImageRef>)`
// 在 iOS 上 SIGTRAP。原生签名 Either<URL, SharedRef<UIImage>> 先按 URL 试转 → JavaScriptValue.getAny()
// 遍历 ImageRef 的属性 → 碰到函数 → FatalError.unimplemented()。JS try/catch 接不住,只能不传。
// 这里钉住:app 里每一处 manipulate( 的参数都是 uri 字符串,不是 renderAsync 的结果。
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

const root = fileURLToPath(new URL('.', import.meta.url)); // Windows: pathname 是 /D:/…,不能直接用
const walk = (dir: string): string[] => readdirSync(dir).flatMap(e => {
  const p = join(dir, e);
  if (statSync(p).isDirectory()) return walk(p);
  return /\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : [];
});
const rel = (p: string) => p.slice(root.length).replace(/\\/g, '/').replace(/^\//, '');
const files = walk(root).map(p => ({ path: p, name: rel(p) }));

// 取集自检:attach.ts 和 share-card-capture.ts 都在扫描范围里(各有一处已知的 manipulate 调用)。
check(files.some(f => f.name === 'attach.ts') && files.some(f => f.name === 'share-card-capture.ts'), `scan covers attach.ts + share-card-capture.ts (${files.length} files)`);

// 允许的实参:只认名字里带 uri 的字符串变量、`raw`(captureRef 的 tmpfile 路径)。
const ALLOWED = /^(uri|decoded\.uri|raw)$/;
const calls: { file: string; arg: string }[] = [];
for (const f of files) {
  const src = readFileSync(f.path, 'utf8');
  for (const m of src.matchAll(/ImageManipulator\.manipulate\(([^)]+)\)/g)) calls.push({ file: f.name, arg: m[1].trim() });
}
check(calls.length >= 3, `found the native manipulate calls (${calls.map(c => `${c.file}:${c.arg}`).join(', ')})`);
for (const c of calls) check(ALLOWED.test(c.arg), `${c.file}: manipulate(${c.arg}) must take a uri string, never an ImageRef (iOS SIGTRAP)`);

// 判据自检:把崩溃那一版的写法喂进去,必须判红。
check(!ALLOWED.test('decoded'), 'witness: the crashing shape manipulate(decoded) is rejected');

// attach.ts 的 decode 量完尺寸就释放 ImageRef 和 context;resize 从 uri 重新开始。
const attach = readFileSync(join(root, 'attach.ts'), 'utf8');
const deps = attach.slice(attach.indexOf('const nativeResizeDeps'), attach.indexOf('const nativeResizeSerial'));
check(/ref\.release\(\)/.test(deps) && (deps.match(/context\.release\(\)/g) ?? []).length === 2, 'decode releases its ImageRef and both contexts are released');
check(/manipulate\(decoded\.uri\)\.resize\(\{ width, height \}\)/.test(deps), 'resize starts from the uri');
check(!/release: \(decoded/.test(deps), 'no ImageRef handle outlives decode');

// 上游原生代码仍是这个形状(升级 expo-image-manipulator 后若改成先试 SharedRef,这条会提示可以复查)。
const swift = readFileSync(join(root, '../node_modules/expo-image-manipulator/ios/ImageManipulatorModule.swift'), 'utf8');
check(/Function\("manipulate"\) \{ \(source: Either<URL, SharedRef<UIImage>>\)/.test(swift), 'iOS manipulate still tries URL first (Either<URL, SharedRef>)');

console.log(`manipulate-uri-only: ${ck}/${ck} checks passed`);
