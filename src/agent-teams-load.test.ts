// Actual hook, deterministic hook harness (not a browser E2E).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AgentTeams.tsx', import.meta.url), 'utf8');
const hook = source.slice(source.indexOf('export function useAgentTeams('), source.indexOf('// 弹窗'));
const code = ts.transpileModule(hook, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let p = 0, total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: (v: any) => void, reject!: (e: any) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness() {
  const slots: any[] = [], effects: (() => void)[] = [], reads: ReturnType<typeof deferred>[] = [];
  let index = 0, writes = 0, nodesFail = false;
  const same = (a: any[], b: any[]) => a?.length === b.length && b.every((v, i) => Object.is(v, a[i]));
  const context = {
    exports: {} as any,
    useState(initial: any) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: any) => { writes++; slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial: any) { const i = index++; return slots[i] ??= { current: initial }; },
    useCallback(fn: any, deps: any[]) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn: any, deps: any[]) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    fetchAgentTeams() { const r = deferred(); reads.push(r); return r.promise; },
    async fetchHubNodes() { if (nodesFail) throw Error('HTTP 403'); return { nodes: [{ node_id: 'node', alias: 'example' }] }; },
  };
  runInNewContext(code, context);
  const cfg = { serverUrl: 'https://example.invalid', token: 'placeholder' };
  return {
    reads, cfg,
    render(net = 'B', account = cfg) { index = 0; const result = context.exports.useAgentTeams(account, net); effects.splice(0).forEach(fn => fn()); return result; },
    unmount() { slots.forEach(s => s?.cleanup?.()); },
    writes: () => writes,
    failNodes() { nodesFail = true; },
  };
}
{
  const h = harness(); h.render('A'); h.render('B');
  h.reads[1].resolve([{ id: 'B' }]); await flush();
  h.reads[0].resolve([{ id: 'A' }]); await flush();
  ck('late previous-network response ignored', h.render().teams?.[0]?.id === 'B');
  h.render().reload(); const older = h.reads[2];
  ck('same-scope refresh keeps the current team page mounted', h.render().teams?.[0]?.id === 'B');
  h.render().reload(); h.reads[3].resolve([{ id: 'new' }]); await flush();
  older.reject(Error('late error')); await flush();
  ck('late failure cannot replace newer reload', !h.render().loadError && h.render().teams[0].id === 'new');
}
{
  const h = harness(); h.render(); h.reads[0].reject(Error('HTTP 403')); await flush();
  ck('read failure is explicit, not empty teams', h.render().loadError && h.render().teams === undefined);
  h.render().reload(); h.reads[1].resolve([]); await flush();
  ck('retry clears failure and accepts genuinely empty teams', !h.render().loadError && h.render().teams.length === 0);
}
{
  const h = harness(); h.failNodes(); h.render(); h.reads[0].resolve([]); await flush();
  ck('node list failure is not an empty organisation', h.render().loadError);
}
{
  const h = harness(); h.failNodes(); h.render(); h.reads[0].resolve(null); await flush();
  ck('old Hub keeps upgrade state without node request', h.render().teams === null && !h.render().loadError);
}
{
  const h = harness(); h.render(); h.unmount(); const before = h.writes();
  h.reads[0].resolve([{ id: 'old' }]); await flush();
  ck('unmounted hook never writes late results', h.writes() === before);
}
ck('scope key resets editors for server, token and network', source.includes('key={JSON.stringify([cfg.serverUrl, cfg.token, networkId])}'));
ck('error UI exposes retry', source.includes('testID="team-load-error"') && source.includes('onPress={reload} testID="team-load-retry"'));
console.log(`${p}/${total}`); process.exit(p === total ? 0 : 1);
