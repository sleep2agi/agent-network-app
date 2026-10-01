// 弹层的 Esc:keydown 布防并吞掉,keyup 才关并吞掉 keyup(src/escape-close.ts)。
// 在 keydown 上就关的话,同一下的 keyup 落到下面那层 Modal(窄窗口的整页任务详情、新建对话框)上,把它也关了
// —— react-native-web 的 Modal 在 document 的 keyup 上对「最上层」Modal 调 onRequestClose。
// 浏览器复现 / 回归:tests/test-select-menu-esc/drive.mjs(改前红、改后绿)。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { escapeCloseHandlers } from './escape-close';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

console.log('# escapeCloseHandlers');
{
  const ev = (key: string, o: Record<string, unknown> = {}) => { const e = { key, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...o }; return e; };
  let closed = 0;
  const h = escapeCloseHandlers(() => { closed++; });
  const down = ev('Escape'); h.onKeyDown(down);
  ck('keydown:不关,吞掉', closed === 0 && down.stopped && down.prevented);
  const up = ev('Escape'); h.onKeyUp(up);
  ck('keyup:关一次,并吞掉 keyup(下面那层 Modal 收不到)', closed === 1 && up.stopped);
  h.onKeyUp(ev('Escape'));
  ck('没有对应 keydown 的 keyup 不关(打开它的那下 Esc 的 keyup 不算)', closed === 1);
  h.onKeyDown(ev('Escape', { isComposing: true })); h.onKeyUp(ev('Escape'));
  ck('组字中的 Esc(取消输入法)不关', closed === 1);
  const other = ev('ArrowDown'); h.onKeyDown(other); h.onKeyUp(ev('ArrowDown'));
  ck('别的键不碰', closed === 1 && !other.stopped);
}

console.log('# 六个弹层都走 listenEscapeClose,keydown 处理里不再有 Esc 关闭');
const FILES = ['TaskSelectMenu.tsx', 'TaskDuePicker.tsx', 'TaskListCellEditor.tsx', 'AppSelect.tsx', 'TaskListFields.tsx', 'RequirementPeoplePicker.tsx'];
for (const f of FILES) {
  const code = src(f);
  ck(`${f}:用 listenEscapeClose`, /listenEscapeClose\(/.test(code) && /offEsc\(\)/.test(code));
  const lines = code.split('\n').filter(l => /e\.key === 'Escape'/.test(l));
  ck(`${f}:keydown 里没有「Esc 就关」`, lines.every(l => !/onClose\(|setOpen\(false\)|close\(\)/.test(l)));
}

console.log('# 审过、保持原样的');
const full = src('TaskDescriptionFullscreen.tsx');
ck('TaskDescriptionFullscreen:web 上 Modal 不给 onRequestClose,自己 keyup 才关', /onRequestClose=\{WEB \? undefined : onClose\}/.test(full) && /addEventListener\('keyup', onUp\)/.test(full));

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
