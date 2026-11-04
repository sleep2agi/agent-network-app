// 军团几何测试的最小断言垫片(2026-11-05)。
//
// 这三个测试文件是从 Dashboard(`agent-network-dashboard/app/lib/*.test.mjs`)原样搬来的,
// 那边用 `bun:test` 的 describe/test/expect。本仓的 runner 是「直接跑每个 *.test.ts 文件」,
// 不是 `bun test`,所以不能 import 'bun:test'(会报 "Cannot use describe outside of the test runner")。
//
// 与其把 700 行断言手改成 ck 风格(容易改错,也不该在搬家时动断言),这里提供等价语义的
// 小垫片:describe 顺序执行、test 捕获失败并计入汇总、expect 支持这些文件实际用到的匹配器。
// 搬家最重要的原则是「几何行为一字不改」,断言也必须一字不改。
//
// 不放进 node_modules,也不需要新增依赖;文件不以 .test.ts 结尾,runner 不会把它当测试跑。

type AnyFn = () => void;

let passed = 0;
const failures: string[] = [];

export function describe(_name: string, fn: AnyFn): void {
  fn();
}

export function test(name: string, fn: AnyFn): void {
  try {
    fn();
    passed += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`FAIL: ${name} — ${msg}`);
  }
}

export function afterAll(fn: AnyFn): void {
  fn();
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function subsetEqual(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return deepEqual(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((v, i) => subsetEqual(actual[i], v));
  }
  return Object.keys(expected as object).every((k) =>
    subsetEqual((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k]),
  );
}

const show = (v: unknown) => {
  try { return JSON.stringify(v); } catch { return String(v); }
};

function matchers(actual: unknown, negate: boolean) {
  const assert = (ok: boolean, what: string) => {
    const fine = negate ? !ok : ok;
    if (!fine) throw new Error(`expected ${show(actual)} ${negate ? 'not ' : ''}${what}`);
  };
  return {
    toBe: (v: unknown) => assert(Object.is(actual, v), `to be ${show(v)}`),
    toEqual: (v: unknown) => assert(deepEqual(actual, v), `to equal ${show(v)}`),
    toMatchObject: (v: unknown) => assert(subsetEqual(actual, v), `to match ${show(v)}`),
    toBeNull: () => assert(actual === null, 'to be null'),
    toBeUndefined: () => assert(actual === undefined, 'to be undefined'),
    toBeDefined: () => assert(actual !== undefined, 'to be defined'),
    toBeTruthy: () => assert(Boolean(actual), 'to be truthy'),
    toBeFalsy: () => assert(!actual, 'to be falsy'),
    toBeCloseTo: (v: number, digits = 2) => {
      const tol = Math.pow(10, -digits) / 2;
      assert(typeof actual === 'number' && Math.abs((actual as number) - v) <= tol, `to be close to ${v} (±${tol})`);
    },
    toBeGreaterThan: (v: number) => assert((actual as number) > v, `> ${v}`),
    toBeGreaterThanOrEqual: (v: number) => assert((actual as number) >= v, `>= ${v}`),
    toBeLessThan: (v: number) => assert((actual as number) < v, `< ${v}`),
    toBeLessThanOrEqual: (v: number) => assert((actual as number) <= v, `<= ${v}`),
    toContain: (v: unknown) => {
      const ok = Array.isArray(actual)
        ? actual.some((x) => deepEqual(x, v) || Object.is(x, v))
        : typeof actual === 'string' && actual.includes(String(v));
      assert(ok, `to contain ${show(v)}`);
    },
    toHaveLength: (n: number) => {
      const len = (actual as { length?: number } | null)?.length;
      assert(len === n, `to have length ${n} (got ${len})`);
    },
  };
}

export function expect(actual: unknown) {
  const base = matchers(actual, false);
  return Object.assign(base, { not: matchers(actual, true) });
}

/** 由每个测试文件的末行调用:打印汇总,失败则非零退出。 */
export function finish(label: string): void {
  if (failures.length) {
    console.log(`legion geometry (${label}): ${failures.length} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`legion geometry (${label}): ${passed}/${passed} passed`);
}
