// #735 类：截断标签的悬停提示（web 挂 title；原生返回 undefined）。
import { fullTextTitleRef, hasDomNode } from './full-text-title';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log('✅', name); } else console.log('❌', name); };

const web = hasDomNode();
ck('web 环境识别（bun 下无 document → 非 web 分支）', web === (typeof document !== 'undefined'));
ck('空文本不挂 ref', fullTextTitleRef('   ') === undefined && fullTextTitleRef(null) === undefined && fullTextTitleRef(undefined) === undefined);

if (!web) {
  ck('非 web（原生/纯 node）→ 不挂 ref', fullTextTitleRef('很长的名字') === undefined);
} else {
  const el = { setAttribute: (k: string, v: string) => { (el as any).set = [k, v]; } } as any;
  const ref = fullTextTitleRef(' 很长的名字 ') as any;
  ref(el);
  ck('web → 挂 title 且去掉首尾空白', el.set?.[0] === 'title' && el.set?.[1] === '很长的名字');
  ck('坏节点不抛', (() => { try { ref(null); ref({}); return true; } catch { return false; } })());
}

console.log(`full text title: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
