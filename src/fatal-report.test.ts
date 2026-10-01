// ck-style (self-executing; run by scripts/run-tests.mjs — NOT bun:test).
// 「上次异常退出」诊断:序列化 / 截断 / 接在原全局处理器前面 / 存储 / 顶层错误边界的状态流转,以及接线契约。
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement, Fragment } from 'react';

const {
  truncate, buildFatalReport, serializeFatal, parseFatalReport, fatalSummary, fatalDiagnosticsText, installFatalRecorder,
  MAX_MESSAGE, MAX_STACK, MAX_COMPONENT_STACK, FATAL_REPORT_VERSION,
} = await import('./fatal-report');
const { createFatalStore } = await import('./fatal-store');
const { FatalBoundaryCore } = await import('./fatal-boundary');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

const meta = { appVersion: '0.2.180', platform: 'ios', osVersion: '18.7.10', width: 1080.4, height: 810 };
const at = new Date('2026-10-01T07:55:39.000Z');

// ── truncate ────────────────────────────────────────────────────────────────
check(truncate('abc', 5) === 'abc', 'short strings untouched');
check(truncate('abcdefgh', 3) === 'abc…[+5]', 'long strings cut with a marker naming how much was dropped');
check(truncate(undefined, 3) === '' && truncate(null, 3) === '' && truncate(42, 5) === '42', 'non-strings are coerced, null/undefined → empty');

// ── buildFatalReport: anything that can be thrown ───────────────────────────
{
  const e = new TypeError("undefined is not an object (evaluating 'a.b')");
  const r = buildFatalReport(e, meta, 'global', null, at);
  check(r.v === FATAL_REPORT_VERSION && r.kind === 'global' && r.at === '2026-10-01T07:55:39.000Z', 'version, kind, timestamp');
  check(r.name === 'TypeError' && r.message.startsWith('undefined is not an object') && r.stack.includes('TypeError'), 'Error: name, message and stack kept');
  check(r.appVersion === '0.2.180' && r.platform === 'ios' && r.osVersion === '18.7.10' && r.width === 1080 && r.height === 810, 'meta copied, sizes rounded');
  check(!('componentStack' in r), 'no componentStack key when there is none');
}
check(buildFatalReport('boom', meta, 'global', null, at).message === 'boom' && buildFatalReport('boom', meta, 'global', null, at).name === 'string', 'a thrown string');
check(buildFatalReport({ code: 7 }, meta, 'global', null, at).message === '{"code":7}', 'a thrown plain object is JSON-ed');
check(buildFatalReport(undefined, meta, 'global', null, at).message === 'undefined', 'a thrown undefined');
{
  const cyclic: any = { message: undefined }; cyclic.self = cyclic;
  const r = buildFatalReport(cyclic, meta, 'global', null, at);
  check(typeof r.message === 'string', 'a cyclic object does not make the recorder throw');
  const hostile = { get message() { throw new Error('getter'); } };
  check(buildFatalReport(hostile, meta, 'global', null, at).message === '<unreadable error>', 'a throwing getter → placeholder, never a second throw');
}
{
  const e = new Error('x'.repeat(5000));
  e.stack = 's'.repeat(50_000);
  const r = buildFatalReport(e, meta, 'boundary', 'c'.repeat(9000), at);
  check(r.message.length <= MAX_MESSAGE + 12 && r.stack.length <= MAX_STACK + 12 && r.componentStack!.length <= MAX_COMPONENT_STACK + 12, 'message / stack / componentStack truncated');
  const json = serializeFatal(r);
  check(json.length < 8 * 1024, `worst case stays small enough for a sync write (${json.length} bytes)`);
}

// ── parse: what is on disk is untrusted ─────────────────────────────────────
{
  const r = buildFatalReport(new Error('m'), meta, 'boundary', 'in X', at);
  const back = parseFatalReport(serializeFatal(r));
  check(!!back && back.message === 'm' && back.kind === 'boundary' && back.componentStack === 'in X', 'round trip');
  check(parseFatalReport(null) === null && parseFatalReport('') === null && parseFatalReport('{"v":1') === null, 'missing / half-written → null');
  check(parseFatalReport(JSON.stringify({ ...r, v: 99 })) === null, 'another schema version → null');
  check(parseFatalReport(JSON.stringify({ ...r, kind: 'other' })) === null && parseFatalReport('[]') === null, 'wrong shape → null');
  check(fatalSummary(r) === 'Error: m', 'summary line');
  const text = fatalDiagnosticsText({ ...r, shown: true });
  check(text.startsWith('[diagnostics] last fatal JS error · v0.2.180 · ios 18.7.10 · ') && text.includes('"message": "m"') && !text.includes('shown'), 'diagnostics text: header + JSON, local shown flag stripped');
}

// ── installFatalRecorder: chain to the original handler ─────────────────────
const fakeErrorUtils = () => {
  const calls: string[] = [];
  let handler = (e: unknown, fatal?: boolean) => { calls.push(`orig:${String((e as Error)?.message ?? e)}:${fatal}`); };
  return { calls, eu: { getGlobalHandler: () => handler, setGlobalHandler: (h: typeof handler) => { handler = h; } }, fire: (e: unknown, fatal?: boolean) => handler(e, fatal) };
};
{
  const { calls, eu, fire } = fakeErrorUtils();
  const recorded: unknown[] = [];
  check(installFatalRecorder(eu, e => { calls.push('record'); recorded.push(e); }) === true, 'installs on a ErrorUtils-like object');
  const err = new Error('fatal one');
  fire(err, true);
  check(calls.join() === 'record,orig:fatal one:true', `fatal: record first, then the original handler with the same args (${calls.join()})`);
  check(recorded[0] === err, 'the original error object is recorded');
  calls.length = 0;
  fire(new Error('soft'), false);
  check(calls.join() === 'orig:soft:false', 'non-fatal: not recorded, still forwarded');
  calls.length = 0;
  check(installFatalRecorder(eu, () => { calls.push('record2'); }) === true, 'second install reports installed');
  fire(new Error('again'), true);
  check(calls.join() === 'record,orig:again:true', `idempotent: installing twice does not double-record (${calls.join()})`);
}
{
  const { calls, eu, fire } = fakeErrorUtils();
  installFatalRecorder(eu, () => { throw new Error('disk full'); });
  let threw = false;
  try { fire(new Error('x'), true); } catch { threw = true; }
  check(!threw && calls.join() === 'orig:x:true', 'a recorder that throws never stops the original handler');
}
check(installFatalRecorder(undefined, () => {}) === false && installFatalRecorder({} as any, () => {}) === false, 'no ErrorUtils (web) → not installed, no throw');

// ── store ───────────────────────────────────────────────────────────────────
{
  let disk: string | null = null;
  let failWrite = false;
  const store = createFatalStore({ read: () => disk, write: t => { if (failWrite) throw new Error('ro'); disk = t; }, remove: () => { disk = null; } });
  let events = 0;
  const off = store.subscribe(() => { events++; });
  check(store.read() === null, 'empty store reads null');
  const r = buildFatalReport(new Error('s'), meta, 'global', null, at);
  check(store.save(r) && store.read()?.message === 's' && events === 1, 'save → read back, listeners told');
  store.markShown();
  check(store.read()?.shown === true && events === 2, 'markShown keeps the report, flags it');
  store.markShown();
  check(events === 2, 'markShown twice is a no-op');
  store.clear();
  check(store.read() === null && disk === null && events === 3, 'clear removes it');
  failWrite = true;
  check(store.save(r) === false, 'a failing write returns false instead of throwing');
  disk = '{garbage';
  check(store.read() === null, 'garbage on disk reads as nothing');
  off();
  store.clear();
  check(events === 3, 'unsubscribe works');
}

// ── boundary drive: a child that throws in render ───────────────────────────
{
  const recorded: { error: unknown; stack?: string | null }[] = [];
  let reloads = 0;
  const child = createElement('child', { id: 'app' });
  const props = {
    record: (error: unknown, stack?: string | null) => { recorded.push({ error, stack }); },
    fallback: (onReload: () => void) => createElement('fatal-screen', { onReload }),
    children: child,
  };
  const b: any = new (FatalBoundaryCore as any)(props);
  b.props = props;
  b.setState = (u: any) => { b.state = { ...b.state, ...(typeof u === 'function' ? u(b.state) : u) }; };
  const first = b.render();
  check(isValidElement(first) && first.type === Fragment && first.key === '0' && (first.props as any).children === child, 'healthy: renders the children under key 0');
  const err = new Error('render blew up');
  b.setState((FatalBoundaryCore as any).getDerivedStateFromError(err));
  b.componentDidCatch(err, { componentStack: '\n    in Thrower\n    in AppRoot' });
  const failed = b.render();
  check(isValidElement(failed) && failed.type === 'fatal-screen', 'after the throw: the fallback screen, not the children');
  check(recorded.length === 1 && recorded[0].error === err && recorded[0].stack!.includes('in Thrower'), 'the error and React component stack are recorded');
  (failed.props as any).onReload(); reloads++;
  const again = b.render();
  check(isValidElement(again) && again.type === Fragment && again.key === '1' && reloads === 1, '重新加载: children remount under a new key (fresh state)');
  const bad: any = new (FatalBoundaryCore as any)({ ...props, record: () => { throw new Error('rec'); } });
  let threw = false;
  try { bad.componentDidCatch(err, {}); } catch { threw = true; }
  check(!threw, 'a failing recorder never breaks the fallback');
}

// ── wiring (source contract) ────────────────────────────────────────────────
{
  const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  check(index.indexOf('installFatalRuntime();') > 0 && index.indexOf('installFatalRuntime();') < index.indexOf('registerRootComponent(App);'), 'index.ts installs the recorder before registering the root');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  check(/<FatalBoundary>\s*<AppRoot \/>\s*<\/FatalBoundary>/.test(app), 'App wraps AppRoot in the boundary');
  check((app.match(/<LastCrashChip cfg=\{cfg\} \/>/g) ?? []).length === 2, 'chip mounted on the signed-in desktop and mobile shells');
  const runtime = readFileSync(new URL('./fatal-runtime.ts', import.meta.url), 'utf8');
  check(/textSync\(\)/.test(runtime) && /\.write\(text\)/.test(runtime) && !/await /.test(runtime), 'native backend is synchronous (no await between the fatal handler and the write)');
  const chip = readFileSync(new URL('./LastCrashChip.tsx', import.meta.url), 'utf8');
  check(/CHIP_AUTO_HIDE_MS = 8000/.test(chip) && /fatalStore\.markShown\(\)/.test(chip), 'chip auto-hides after ~8s and marks the report shown (no repeat nag)');
  check(/sendTask\(cfg, DIAGNOSTICS_ALIAS, fatalDiagnosticsText\(report\)\)/.test(chip) && /fatalStore\.clear\(\)/.test(chip), 'send uses the normal sendTask path and deletes the record');
  check(!/Alert\./.test(chip), 'no blocking Alert');
  const phone = readFileSync(new URL('./SettingsPhonePages.tsx', import.meta.url), 'utf8');
  const desk = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
  check(/lastFatal && ctx\.show\('about', 'lastCrash'\)/.test(phone) && /lastFatal && show\('about', 'lastCrash'\)/.test(desk), 'Settings › 关于 shows the copy row only when a record exists (phone + desktop)');
}

console.log(`fatal-report: ${ck}/${ck} checks passed`);
