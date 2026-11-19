// #735 类：列表/页头里的名字被省略号截断后，桌面（web / Tauri webview）悬停要能看到全名。
// react-native-web 会把未知的 `title` prop 过滤掉，所以只能拿到 DOM 节点后自己 setAttribute。
// 原生端没有 hover（长按已有行菜单/详情），不挂 ref；也不 import react-native，测试可直接跑。
export type TitleRef = ((node: unknown) => void) | undefined;

/** 当前环境有没有 DOM（web / Tauri webview）；原生 RN 没有。 */
export const hasDomNode = (): boolean => typeof document !== 'undefined';

export const fullTextTitleRef = (text: string | null | undefined): TitleRef => {
  const value = (text ?? '').trim();
  if (!value || !hasDomNode()) return undefined;
  return (node: unknown) => {
    try {
      (node as { setAttribute?: (k: string, v: string) => void } | null)?.setAttribute?.('title', value);
    } catch {
      /* 不是 DOM 节点（测试 mock / 原生）：忽略 */
    }
  };
};
