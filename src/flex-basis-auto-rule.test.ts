// flexBasis: 'auto' 守卫(2026-09-30,0.2.161 平板「成员」弹窗:按机器 / 按类型的分段控件塌成半截青色药丸、没有字)。
// ck 风格,自执行。
//
// 为什么:原生 Yoga 的 `flex` 是独立字段。flex > 0 时,flexBasis 为 'auto' 等于没写,基准取 0 ——
// 所以「叠在 flex: 1 上,再用 flexBasis: 'auto' 撤回」在原生上什么也没撤回:宽 / 高按 0 起算,
// 只剩内边距。react-native-web 把 flex 展开成三个 CSS 属性、后写的覆盖先写的,web 上看着正常,
// web 导出的截图和布局扫描都抓不到。同一个形状已经在真机上塌过两次:
//   0.2.143 看板列 [4,4,4](task-board-layout.ts 顶部),0.2.161 成员弹窗的分段控件(UserManagementPanel segmentSmall)。
// 而没有 flex 时 flexBasis 的默认值本来就是 'auto',写出来只可能是为了撤回某个 flex —— 那正是原生上不生效的写法。
//
// 规则:代码里的 `flexBasis: 'auto'` 只许出现在 web 专用分支里(同一行有 `Platform.OS === 'web'`)。
// 要按内容 / width 定尺寸:别叠 flex 的样式,给它一套自己的底样式。
//
// 两层分开自检:判据(给它一行,看它报不报)与取集(造一棵目录树,看该收的收进来了没有)。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

const here = import.meta.dir;
const BASIS_AUTO = /flexBasis\s*:\s*['"`]auto['"`]/;
const WEB_ONLY = /Platform\.OS\s*===\s*['"]web['"]/;
// 只看代码:注释里讲这条规则的说明文字不算。
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** 判据:返回违规行号(1 起)。 */
export function violations(src: string): number[] {
  const out: number[] = [];
  stripComments(src.replace(/\r\n?/g, '\n')).split('\n').forEach((line, i) => {
    if (BASIS_AUTO.test(line) && !WEB_ONLY.test(line)) out.push(i + 1);
  });
  return out;
}

/** 取集:目录下(递归)所有非测试的 .ts / .tsx。 */
export function collect(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root)) {
    const f = join(root, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules') out.push(...collect(f)); }
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
}

console.log('判据自检');
// 0.2.161 的原样(修之前的 UserManagementPanel.tsx:835)必须红。
ck('旧 segmentSmall(叠在 flex:1 上的 flexBasis:auto)→ 红',
  violations("  segmentSmall: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: spacing.md, paddingVertical: 6 },").length === 1);
ck('旧 ScheduledTasks dialogPanel → 红',
  violations("  dialogPanel: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', borderRadius: radius.surface } as any,").length === 1);
ck('内联对象 / 双引号也认', violations('<View style={[s.a, { flexBasis: "auto", width }]} />').length === 1);
ck('web 专用分支放行(ChatScreen 输入框那一行的形状)',
  violations("style={[styles.input, Platform.OS === 'web' && { height: h, flexBasis: 'auto' }]}").length === 0);
ck('注释里的说明文字不算', violations("// 原生上 flex: 1 + flexBasis: 'auto' 的基准是 0\n/* flexBasis: 'auto' */").length === 0);
ck('数值基准不管(原生会用)', violations('  col: { flex: 1, flexBasis: 0 },').length === 0);
ck('报的是正确的行号', JSON.stringify(violations("a\n// flexBasis: 'auto'\nx: { flexBasis: 'auto' },")) === '[3]');

console.log('取集自检');
{
  const tmp = mkdtempSync(join(tmpdir(), 'basis-rule-'));
  try {
    mkdirSync(join(tmp, 'deep', 'er'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules'));
    for (const f of ['a.tsx', 'b.ts', 'deep/er/c.tsx', 'x.test.ts', 'node_modules/y.tsx', 'z.md']) writeFileSync(join(tmp, f), '');
    const got = collect(tmp).map(f => relative(tmp, f)).sort();
    ck(`递归收进子目录的 .ts / .tsx,跳过测试与 node_modules(收到 ${got.join(', ')})`, JSON.stringify(got) === JSON.stringify(['a.tsx', 'b.ts', 'deep/er/c.tsx']));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log('src/');
const files = collect(here);
ck(`取集收到了真实文件(${files.length} 个,含 UserManagementPanel.tsx)`, files.length > 100 && files.some(f => f.endsWith('/UserManagementPanel.tsx')));
const bad: string[] = [];
for (const f of files) for (const line of violations(readFileSync(f, 'utf8'))) bad.push(`${relative(here, f)}:${line}`);
ck(`没有在原生会生效的样式里写 flexBasis: 'auto'${bad.length ? ` —— ${bad.join(', ')}(给它一套不带 flex 的底样式,别叠在 flex:1 上再撤回)` : ''}`, bad.length === 0);

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
