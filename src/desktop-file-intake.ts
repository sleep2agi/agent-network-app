// 桌面端(Tauri 壳 / 宽布局)把文件放进聊天输入框的三个入口 —— 点「＋」、拖进聊天区、Ctrl/⌘+V ——
// 共用这一个出口:浏览器 File → 草稿里的 PickedImage。图片和普通文件是同一个形状,发送时由
// image-draft.isDraftImage(按 MIME / 扩展名)决定走图片那条路(缩略图、多图、压缩)还是文件附件那条路。
//
// 0.2.123(owner 1200×800 截图):桌面点「＋」弹出手机那套「相册 / 文件」面板,还钉在窗口左下角、
// 盖住 agent 列表。桌面没有「相册」这个概念:「＋」直接打开系统文件选择器(多选、任意类型)。
// 手机保持微信式面板不变。
//
// 纯逻辑,不 import react-native;浏览器对象只按鸭子类型用,测试传替身。
import type { PickedImage } from './attach';

type FileLike = { name?: string; type?: string; size?: number };
type ItemLike = { kind?: string; getAsFile?: () => FileLike | null };
type DataTransferLike = { files?: ArrayLike<FileLike> | null; items?: ArrayLike<ItemLike> | null; types?: ArrayLike<string> | readonly string[] | null };

/** 「＋」按下去做什么。desktop = ChatScreen 的 desktop(Tauri 桌面工作区 / 分离的聊天窗)。 */
export type PlusPressAction = 'filePicker' | 'panel';
export function plusPressAction(env: { desktop: boolean; attachEnabled: boolean }): PlusPressAction {
  return env.desktop && env.attachEnabled ? 'filePicker' : 'panel';
}

const defaultUrl = (file: FileLike): string => URL.createObjectURL(file as Blob);

export function attachmentFromFile(file: FileLike, makeUrl: (f: FileLike) => string = defaultUrl): PickedImage {
  const type = file.type || '';
  return {
    uri: makeUrl(file),
    fileName: file.name || (type.startsWith('image/') ? 'pasted-image.png' : 'pasted-file'),
    mimeType: type || 'application/octet-stream',
    fileSize: file.size,
    webFile: file as Blob,
  };
}

export function attachmentsFromFiles(files: ArrayLike<FileLike> | null | undefined, makeUrl?: (f: FileLike) => string): PickedImage[] {
  const out: PickedImage[] = [];
  if (!files) return out;
  for (let i = 0; i < files.length; i++) if (files[i]) out.push(attachmentFromFile(files[i], makeUrl));
  return out;
}

/**
 * 拖放 / 粘贴带来的文件。优先 `files`(拖放);没有再看 `items` 里 kind=file 的(剪贴板截图常只在这里)。
 * 纯文字返回空数组 —— 调用方据此放行原生行为(文字照常粘贴)。
 */
export function filesFromTransfer(dt: DataTransferLike | null | undefined): FileLike[] {
  if (!dt) return [];
  const files: FileLike[] = [];
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) if (dt.files[i]) files.push(dt.files[i]);
    return files;
  }
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item?.kind !== 'file') continue;
      const f = item.getAsFile?.();
      if (f) files.push(f);
    }
  }
  return files;
}

/** dragover 时还拿不到文件本身,只能看 types 里有没有 'Files'(拖的是文字 / 链接就不接)。 */
export function transferHasFiles(dt: DataTransferLike | null | undefined): boolean {
  const types = dt?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}
