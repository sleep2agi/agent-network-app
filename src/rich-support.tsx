// 所见即所得描述编辑的入口(原生版)。安卓 / iOS 没有 contenteditable,RN 的 TextInput 做不了富文本 ——
// 手机仍是 Markdown 编辑 + 预览。这个文件不 import 任何 TipTap 的东西,原生包里就没有它。
// web / 桌面壳走 rich-support.web.tsx(Metro 按平台后缀挑)。两边导出同一组名字。
// 🔴 两个文件必须同一个扩展名(.tsx):Metro 按扩展名逐个试「.web.<ext> 再 .<ext>」,这里若是 .ts,
//    web 上会先命中 rich-support.ts,根本轮不到 rich-support.web.tsx(实测:web 导出里拿到的是这个占位)。
import type { RichDescriptionEditorProps } from './rich-editor-types';

export const RICH_EDITOR_AVAILABLE = false;

/** 这段 Markdown 能不能进富文本;null = 判据(rich-markdown)还没加载完。 */
export function richSafetyNow(_markdown: string): boolean | null {
  return false;
}

export function loadRich(): Promise<void> {
  return Promise.resolve();
}

export function RichDescriptionEditor(_props: RichDescriptionEditorProps) {
  return null;
}
