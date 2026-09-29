// 所见即所得描述编辑器(RichDescriptionEditor.web.tsx / 原生占位 RichDescriptionEditor.tsx)的对外形状。
import type { MutableRefObject } from 'react';
import type { FileLike } from './desktop-file-intake';

/** 详情那边往编辑器里插东西(语音识别结果、上传完的图片)的把手。都插在编辑器当前选区(失焦后 ProseMirror 仍记着)。 */
export type RichEditorHandle = {
  insertText: (text: string, focus: boolean) => void;
  /** src = `/api/files/<id>`,独占一块。 */
  insertImage: (src: string, alt: string) => void;
  focus: () => void;
};

export type RichDescriptionEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  handleRef: MutableRefObject<RichEditorHandle | null>;
  /** 粘贴 / 拖进来的图片文件(上传走详情同一条路)。 */
  onFiles: (files: FileLike[]) => void;
  /** 双击图片看大图。objectUrl = 已经带鉴权下载好的图(有就传给图片窗口,省一次下载)。 */
  onOpenImage: (fileId: string, objectUrl?: string) => void;
  /** Hub 图片带 Authorization 下载:只有桌面壳有这条路;纯网页只显示图片名(地址里不放 token)。 */
  images: { serverUrl: string; token: string; authed: boolean };
  /** 'inline' = 详情里的小编辑框(随内容长高);'full' = 全屏(铺满、自己滚动)。 */
  variant: 'inline' | 'full';
  testID: string;
};
