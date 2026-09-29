// 任务描述里的图片:纯逻辑(不 import react-native,task-description-images.test.ts 直接引)。
// 图片走聊天同一条上传路(/api/upload,12MB 上限),描述里写 `![名字](/api/files/<id>)`,独占一行。
// Hub 的 /api/files 按网络成员放行(#503):上传时带 network_id,同网的人(含 viewer)查看任务都能看到;
// 地址里从不带 token —— 显示时由客户端带 Authorization 头下载。
import { MAX_ATTACHMENT_BYTES } from './attach-download';

/** 图片名放进 `![...]`:去掉会截断语法的 [ ] 和换行,太长截短。 */
export function imageAlt(name: string): string {
  const base = (name || '图片').replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || '图片').slice(0, 80);
}

export const hubImageMarkdown = (name: string, fileId: string): string => `![${imageAlt(name)}](/api/files/${fileId})`;

/**
 * 在光标处插入一段 markdown,保证它独占一行(前后不和文字粘在一起)。返回新文本和插入后光标位置。
 * 有选中文字时替换选中部分。
 */
export function insertAtCaret(text: string, sel: { start: number; end: number } | null, snippet: string): { text: string; caret: number } {
  const len = text.length;
  const start = Math.max(0, Math.min(sel?.start ?? len, len));
  const end = Math.max(start, Math.min(sel?.end ?? start, len));
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const tail = after && !after.startsWith('\n') ? '\n' : '';
  const next = `${before}${lead}${snippet}${tail}${after}`;
  return { text: next, caret: (before + lead + snippet).length };
}

/** 能当图片放进描述的文件(按 MIME,没有 MIME 时看扩展名)。 */
export function isImageFile(file: { name?: string; type?: string }): boolean {
  if (file.type) return /^image\/(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.type);
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name || '');
}

/** 上传前的检查:不是图片 / 超过 12MB → 返回要显示的错误,否则 null。 */
export function checkDescriptionImage(file: { name?: string; type?: string; size?: number }): string | null {
  if (!isImageFile(file)) return `「${file.name || '文件'}」不是图片,描述里只能放图片`;
  if (typeof file.size === 'number' && file.size > MAX_ATTACHMENT_BYTES) return `「${file.name || '图片'}」超过 12MB 上限`;
  return null;
}

/** 描述里引用到的全部 Hub 图片(按出现顺序、去重) —— 点开看大图时 ←/→ 在这些图之间走。 */
export function descriptionImages(markdown: string): { fileId: string; alt: string }[] {
  const out: { fileId: string; alt: string }[] = [];
  const seen = new Set<string>();
  const re = /^\s*!\[([^\]\n]*)\]\(\/api\/files\/([A-Za-z0-9_-]{1,80})\)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ fileId: m[2], alt: m[1] });
  }
  return out;
}
