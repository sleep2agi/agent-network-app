// AppSelect(设置里的下拉选择)的键盘逻辑 —— 纯函数,不 import react-native。
export type AppSelectOption = { value: string; label: string; disabled?: boolean };

/** 下一个可选项(跳过 disabled;到头停住)。from 可以是 -1 / length(Home / End 从外面往里找)。 */
export function stepOption(options: readonly AppSelectOption[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
  return Math.max(0, Math.min(options.length - 1, from));
}

/** 打开时高亮当前选中项(同系统下拉框);没有 / 被禁用就是第一个可选项。 */
export function initialActive(options: readonly AppSelectOption[], value: string): number {
  const i = options.findIndex(o => o.value === value);
  return i >= 0 && !options[i].disabled ? i : stepOption(options, -1, 1);
}
