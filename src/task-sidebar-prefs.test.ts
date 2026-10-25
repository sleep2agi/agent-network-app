// 左栏标签组折叠偏好：admin 2026-10-25「默认折叠起来」。
// 这里用一个最小 localStorage 假件，覆盖：没存过 / 明确展开 / 明确折叠 / 读写抛错 四种。
type Store = Map<string, string>;
const install = (impl: { get?: () => string | null; set?: (v: string) => void } | null) => {
  (globalThis as any).localStorage = impl === null ? undefined : {
    getItem: (_k: string) => (impl.get ? impl.get() : null),
    setItem: (_k: string, v: string) => { impl.set?.(v); },
  };
};

const { readTagsCollapsed, writeTagsCollapsed } = await import('./task-sidebar-prefs');

const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) process.exitCode = 1;
};

install({ get: () => null });
check('没存过 → 默认折叠（admin 要求）', readTagsCollapsed() === true);

install({ get: () => '0' });
check("用户明确展开过（'0'）→ 展开", readTagsCollapsed() === false);

install({ get: () => '1' });
check("明确折叠过（'1'）→ 折叠", readTagsCollapsed() === true);

install(null);
check('没有 localStorage（原生端）→ 折叠', readTagsCollapsed() === true);

install({ get: () => { throw new Error('denied'); } });
check('读取抛错 → 折叠（fail-closed，与默认一致）', readTagsCollapsed() === true);

let wrote: string | null = null;
install({ get: () => null, set: (v) => { wrote = v; } });
writeTagsCollapsed(true);
check("写折叠 → 存 '1'", wrote === '1');
writeTagsCollapsed(false);
check("写展开 → 存 '0'", wrote === '0');

install({ get: () => null, set: () => { throw new Error('denied'); } });
let threw = false;
try { writeTagsCollapsed(true); } catch { threw = true; }
check('写入抛错不冒泡（只是偏好）', threw === false);
