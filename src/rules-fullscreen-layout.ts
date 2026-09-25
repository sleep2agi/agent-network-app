// 规则文件全屏的纯布局判定(0.2.104,Vincent 0.2.102 小米折叠屏展开横屏截图)。
// 纯逻辑,不 import react-native —— NodeRulesSection.tsx 把 Platform.OS / 安全区 / StatusBar 高度喂进来。
//
// ① 状态栏压住全屏工具条:
//    全屏是一个 react-native Modal。Expo 56 / RN 0.85 在 Android 上默认 edge-to-edge,
//    ReactModalHostView 的 statusBarTranslucent getter 是 `field || isEdgeToEdgeFeatureFlagOn`
//    ⇒ 不管传不传,Modal 窗口都画到状态栏底下(横屏还画进挖孔/刘海那条边)。
//    主窗口没事,是因为 App.tsx 的根 View 按 StatusBar.currentHeight / 安全区自己垫了;Modal 是另一个
//    窗口,那层垫子不在它里面 ⇒ 全屏得自己垫。
// ② 编辑框行高:编辑框和跳行滚动的数学共用同一个行高常量,别各写一个 19。

export interface EdgeInsets { top: number; right: number; bottom: number; left: number }
export interface FullscreenPadding { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number }

const nonNeg = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * 全屏 Modal 四边要垫多少,让工具条和正文避开状态栏 / 挖孔 / 手势条。
 * - android / ios:按安全区四边垫。Android 顶边再和 StatusBar.currentHeight 取大 —— 万一安全区
 *   上下文在 Modal 里读成 0,状态栏高度是现成的兜底(主窗口 app-styles.ts 用的就是它)。
 * - web(浏览器 / Tauri 桌面):一律 0。桌面顶部空带由 MacTitleStrip / WinTitleBar 负责,
 *   这里再垫会叠成两层。
 */
export function rulesFullscreenPadding(os: string, insets: Partial<EdgeInsets> | null | undefined, statusBarHeight?: number | null): FullscreenPadding {
  if (os !== 'android' && os !== 'ios') return { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
  const i = insets ?? {};
  const top = os === 'android' ? Math.max(nonNeg(i.top), nonNeg(statusBarHeight)) : nonNeg(i.top);
  return { paddingTop: top, paddingRight: nonNeg(i.right), paddingBottom: nonNeg(i.bottom), paddingLeft: nonNeg(i.left) };
}

/** 规则编辑框字号 / 行高(dp)。行高写死,每一行的盒子高度都是它,不随「这一行用了哪个字体」变。 */
export const RULES_EDITOR_FONT_SIZE = 13;
export const RULES_EDITOR_LINE_HEIGHT = 19;

/** 读到的计算行高(web getComputedStyle 的 '19px' / 'normal' / 空)→ 数值;读不出就用编辑框的常量。 */
export function editorLineHeightPx(computed: unknown): number {
  const n = typeof computed === 'number' ? computed : parseFloat(String(computed ?? ''));
  return Number.isFinite(n) && n > 0 ? n : RULES_EDITOR_LINE_HEIGHT;
}

/** 跳到某行时编辑框的 scrollTop:让目标行落在框的垂直中间(caretTop = 该行顶部相对内容顶部的 y)。 */
export function editorScrollTopForLine(caretTop: number, clientHeight: number, lineHeight: number): number {
  return Math.max(0, caretTop - clientHeight / 2 + lineHeight / 2);
}
