// 弹窗遮罩守卫(2026-09-30,0.2.161 平板「成员」弹窗:遮罩没盖住屏幕底部,后面页面的「新建分组」没变暗)。
// ck 风格,自执行。
//
// 为什么:ModalKeyboardAvoider(以及 RN 的 KeyboardAvoidingView)在 Android 上是改**自己的 height** 来避让键盘。
// 遮罩画在它里面的 backdrop 上,避让层一收,遮罩就跟着短一截 —— 键盘弹着、或可见状态没复位(keyboard-visibility.ts)时,
// 窗口底部那一截是没变暗、还能点到的下层页面。web 上没有软键盘,避让层恒等于 flex:1,web 截图永远看不出来。
//
// 规则:
//   1. 每个 <ModalKeyboardAvoider> 都带 scrim —— 遮罩由它画在避让层外面、铺满整个 Modal 窗口;
//   2. 它里面(直到对应的 </ModalKeyboardAvoider>)不许再画遮罩:没有 rgba(0,0,0,…) 字面量,
//      也不许引用本文件里带 rgba(0,0,0,…) 底色的样式;
//   3. <Modal> 里不直接用 <KeyboardAvoidingView>(一律走 ModalKeyboardAvoider,遮罩规则只在一处)。
//
// 两层分开自检:判据(喂修之前的真实代码形状,必须红)与取集(递归、数对个数)。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

const here = import.meta.dir;
// 块注释换成等量换行,报出来的行号才对得上源文件。
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const DIM = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/;

/** 本文件里底色是黑色半透明的样式名(`name: { … backgroundColor: 'rgba(0,0,0,…)' … }`,单层对象)。 */
/** 底色也可能写成常量(SettingsScreen 的 MODAL_SCRIM):`const X = 'rgba(0,0,0,…)'` 的 X 同样算。 */
function dimStyleNames(src: string): Set<string> {
  const consts = [...src.matchAll(/\bconst\s+(\w+)\s*=\s*['"`]rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/g)].map(m => m[1]);
  const color = new RegExp(`backgroundColor\\s*:\\s*(?:['"\`]rgba\\(\\s*0\\s*,\\s*0\\s*,\\s*0\\s*,${consts.map(c => `|${c}\\b`).join('')})`);
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(\w+)\s*:\s*\{([^{}]*)\}/g)) if (color.test(m[2])) out.add(m[1]);
  return out;
}

/** 判据:返回问题描述;另返回找到的 <ModalKeyboardAvoider> 个数(取集对数用)。 */
export function check(raw: string): { problems: string[]; avoiders: number } {
  const src = stripComments(raw.replace(/\r\n?/g, '\n'));
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  const dim = dimStyleNames(src);
  const problems: string[] = [];
  let avoiders = 0;
  for (const m of src.matchAll(/<ModalKeyboardAvoider\b([^>]*)>/g)) {
    avoiders++;
    const at = m.index!;
    if (!/\bscrim\s*=/.test(m[1])) problems.push(`${lineOf(at)}: <ModalKeyboardAvoider> 没带 scrim`);
    const end = src.indexOf('</ModalKeyboardAvoider>', at);
    const body = src.slice(at + m[0].length, end < 0 ? undefined : end);
    if (DIM.test(body)) problems.push(`${lineOf(at)}: 避让层里面又画了 rgba(0,0,0,…) 遮罩`);
    for (const r of body.matchAll(/\b(?:styles|s)\.(\w+)\b/g)) if (dim.has(r[1])) problems.push(`${lineOf(at)}: 避让层里面用了带遮罩底色的样式 ${r[1]}`);
  }
  for (const m of src.matchAll(/<Modal\b/g)) {
    const end = src.indexOf('</Modal>', m.index!);
    const body = src.slice(m.index!, end < 0 ? undefined : end);
    if (/<KeyboardAvoidingView\b/.test(body)) problems.push(`${lineOf(m.index!)}: <Modal> 里直接用了 <KeyboardAvoidingView>,改用 ModalKeyboardAvoider`);
  }
  return { problems, avoiders };
}

export function collect(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root)) {
    const f = join(root, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules') out.push(...collect(f)); }
    else if (e.endsWith('.tsx') && !/\.test\.tsx$/.test(e)) out.push(f);
  }
  return out;
}

console.log('判据自检(修之前的真实形状)');
// DialogFrame.tsx:46-47 + :73(0.2.161)
const OLD_DIALOG_FRAME = `
      <ModalKeyboardAvoider>
        <View style={[styles.backdrop, withBasePadding(safe, spacing.lg)]}>
          <View style={styles.card} />
        </View>
      </ModalKeyboardAvoider>
const makeStyles = () => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});`;
ck('旧 DialogFrame(遮罩样式在避让层里)→ 红', check(OLD_DIALOG_FRAME).problems.length >= 1);
ck('没带 scrim 也单独报', check(OLD_DIALOG_FRAME).problems.some(x => x.includes('没带 scrim')));
// TaskCreateDialog.tsx:195-196(内联字面量)
ck('旧 TaskCreateDialog(内联 rgba)→ 红', check(`<ModalKeyboardAvoider scrim="x">\n<View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }]} />\n</ModalKeyboardAvoider>`).problems.length === 1);
// SideThreadDrawer.tsx:335(Modal 里直接用 KAV)
ck('旧 SideThreadDrawer(Modal 里裸 KAV)→ 红', check(`<Modal visible>\n<KeyboardAvoidingView style={styles.modalRoot}>\n</KeyboardAvoidingView>\n</Modal>`).problems.some(x => x.includes('KeyboardAvoidingView')));
ck('修好的形状 → 绿', check(`<ModalKeyboardAvoider scrim={SCRIM}>\n<View style={styles.backdrop} />\n</ModalKeyboardAvoider>\nconst x = { backdrop: { flex: 1, alignItems: 'center' } };`).problems.length === 0);
ck('常量写的遮罩色也认(SettingsScreen 的 MODAL_SCRIM 形状)', check(`const MODAL_SCRIM = 'rgba(0,0,0,0.55)';\n<ModalKeyboardAvoider scrim={MODAL_SCRIM}>\n<View style={[styles.modalBackdrop]} />\n</ModalKeyboardAvoider>\nconst x = { modalBackdrop: { flex: 1, backgroundColor: MODAL_SCRIM } };`).problems.length === 1);
ck('避让层外面的遮罩不管(没有避让层的弹窗照旧画在 backdrop 上)', check(`<Modal><View style={styles.b} /></Modal>\nconst x = { b: { backgroundColor: 'rgba(0,0,0,0.5)' } };`).problems.length === 0);
ck('屏幕级 KAV(不在 <Modal> 里)不管', check(`<KeyboardAvoidingView style={s.root}>\n</KeyboardAvoidingView>\n<Modal visible>\n</Modal>`).problems.length === 0);

console.log('取集自检');
{
  const tmp = mkdtempSync(join(tmpdir(), 'scrim-rule-'));
  try {
    mkdirSync(join(tmp, 'sub'));
    mkdirSync(join(tmp, 'node_modules'));
    for (const f of ['a.tsx', 'sub/b.tsx', 'c.ts', 'd.test.tsx', 'node_modules/e.tsx']) writeFileSync(join(tmp, f), '');
    const got = collect(tmp).map(f => relative(tmp, f).replace(/\\/g, '/')).sort();  // Windows: \ → /
    ck(`递归收 .tsx,跳过测试与 node_modules(收到 ${got.join(', ')})`, JSON.stringify(got) === JSON.stringify(['a.tsx', 'sub/b.tsx']));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log('src/');
const files = collect(here);
let avoiders = 0;
const bad: string[] = [];
for (const f of files) {
  const r = check(readFileSync(f, 'utf8'));
  avoiders += r.avoiders;
  for (const x of r.problems) bad.push(`${relative(here, f)}:${x}`);
}
// 2026-09-30 逐个审过的 9 处(DialogFrame、Settings 本地删除、NodeDetail 危险操作、转发、需求人员、新建需求、项目管理、标签管理、BTW 抽屉)。
// 个数变了 ⇒ 有人新加 / 删了带键盘避让的弹窗:先按上面三条过一遍,再改这个数。
const EXPECTED_AVOIDERS = 9;
ck(`取集:src 下 <ModalKeyboardAvoider> 共 ${avoiders} 处(审过的是 ${EXPECTED_AVOIDERS})`, avoiders === EXPECTED_AVOIDERS);
ck(`遮罩都画在避让层外面${bad.length ? ` —— ${bad.join('; ')}` : ''}`, bad.length === 0);

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
