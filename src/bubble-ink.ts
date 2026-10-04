// #545:「我发出的」气泡是实底强调色(晴蓝)。气泡里直接画在底色上的字 —— 正文、链接、附件行
// (「📎 文件名」「↓ 下载原图」)、上传状态 —— 原来用 accent / textMuted / failed,画在蓝底上要么看不见
// (蓝字配蓝底),要么对比不够。在气泡外层挂 MineBubble,里面的组件用 useBubbleInk() 换成
// onBubbleMine / linkOnBubbleMine;不在气泡里时返回 undefined,样式照旧。
// 有自己卡片底(inputBg)的东西(缩略图、失败卡片、视频卡)不受影响,也不该用它。
import { createContext, useContext } from 'react';
import { colors } from './theme';

export const MineBubbleContext = createContext(false);
export const MineBubble = MineBubbleContext.Provider;
export const useMineBubble = () => useContext(MineBubbleContext);

/** 气泡里直接画在底色上的字的颜色覆盖:kind='link' 用于可点的字(链接 / 下载),其余用 'text'。 */
export const bubbleInk = (mine: boolean, kind: 'text' | 'link' = 'text'): { color: string } | undefined =>
  mine ? { color: kind === 'link' ? colors.linkOnBubbleMine : colors.onBubbleMine } : undefined;

export const useBubbleInk = (kind: 'text' | 'link' = 'text') => bubbleInk(useMineBubble(), kind);
