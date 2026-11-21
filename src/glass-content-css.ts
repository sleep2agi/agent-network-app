// 纯函数（测试不引 react-native）。见 glass-content.tsx。
/** 探针元素上的原子 class 里，以 r- 开头的那些就是这个背景色的规则（css- 开头的是 View 的基础样式）。 */
export function glassContentCss(classNames: readonly string[]): string {
  return classNames
    .filter(c => /^r-[A-Za-z0-9_-]+$/.test(c))
    .map(c => `[data-glass-content] .${c}:not([data-glass-opaque]){background-color:transparent !important}`)
    .join('\n');
}
