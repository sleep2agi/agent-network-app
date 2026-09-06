const FILE_ID = '[A-Za-z0-9_-]{8,64}';
const VALID_FILE_ID = new RegExp(`^${FILE_ID}$`);

export type ParsedAttachmentRef = {
  fileId: string;
  name: string;
  /** The legacy reply says "image" but often loses the concrete PNG/JPEG
   * MIME. The downloader can refine this from bytes; rendering must not wait. */
  mime?: string;
  size?: number;
};

/** Preserve the Hub's canonical `meta.attachments` fields rather than making
 * callers re-parse them into text. Malformed metadata is an empty attachment
 * set, never a reason to hide the surrounding message. */
/** #1823 —— agent 回复带的附件:hub 把它们写在任务行 meta_json.reply_attachments(不和提问者的
 *  attachments 混在一个键里)。旧 hub 没有这个键 → 空数组(回复附件仍只能靠正文里的 /api/files 引用)。 */
export const parseMetaReplyAttachmentRefs = (raw: unknown): ParsedAttachmentRef[] => parseMetaRefs(raw, 'reply_attachments');

export const parseMetaAttachmentRefs = (raw: unknown): ParsedAttachmentRef[] => parseMetaRefs(raw, 'attachments');

const parseMetaRefs = (raw: unknown, key: 'attachments' | 'reply_attachments'): ParsedAttachmentRef[] => {
  if (!raw) return [];
  try {
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!meta || typeof meta !== 'object' || !Array.isArray((meta as any)[key])) return [];
    return (meta as any)[key].flatMap((value: any) => {
      if (!value || value.type !== 'file' || typeof value.file_id !== 'string'
        || !VALID_FILE_ID.test(value.file_id)) return [];
      return [{
        fileId: value.file_id,
        name: typeof value.name === 'string' ? value.name : value.file_id,
        mime: typeof value.mime === 'string' ? value.mime : undefined,
        size: typeof value.size === 'number' ? value.size : undefined,
      }];
    });
  } catch {
    return [];
  }
};

/** Normalize both structured-link compatibility text and the legacy node
 * reply form into attachment records. New tasks use `meta.attachments`, but
 * task replies are still stored in a plain-text database column.
 *
 * Nodes currently emit:
 *
 *   图片 file_id: e697…
 *   取回: GET /api/files/e697… (需 Bearer)
 *
 * The previous parser saw only the GET, named it "文件 e697…", and selected
 * the generic-file renderer. The typed first line must win over that fallback. */
export const parseAttachmentRefs = (text: string): ParsedAttachmentRef[] => {
  const out: ParsedAttachmentRef[] = [];
  const byId = new Map<string, number>();
  const push = (ref: ParsedAttachmentRef) => {
    const at = byId.get(ref.fileId);
    if (at === undefined) {
      byId.set(ref.fileId, out.length);
      out.push(ref);
      return;
    }
    if (!out[at].mime && ref.mime) out[at] = ref;
  };

  for (const m of text.matchAll(new RegExp(`\\[([^\\]]+)\\]\\([^()\\s]*\\/api\\/files\\/(${FILE_ID})\\)`, 'g'))) {
    push({ fileId: m[2], name: m[1] });
  }
  for (const m of text.matchAll(new RegExp(`^(?:\\s*(?:🖼️?\\s*)?)?(?:图片|图像|image)\\s+file[_ -]?id\\s*[:：]\\s*(${FILE_ID})(?:\\s+([^\\r\\n]+))?$`, 'gim'))) {
    const suppliedName = m[2]?.trim();
    push({
      fileId: m[1],
      name: suppliedName && /\.(?:png|jpe?g|gif|webp|heic)$/i.test(suppliedName)
        ? suppliedName
        : `图片 ${m[1].slice(0, 8)}…`,
      mime: suppliedName?.match(/\.png$/i) ? 'image/png'
        : suppliedName?.match(/\.jpe?g$/i) ? 'image/jpeg'
          : 'image/*',
    });
  }
  for (const m of text.matchAll(new RegExp(`\\/api\\/files\\/(${FILE_ID})`, 'g'))) {
    push({ fileId: m[1], name: `文件 ${m[1].slice(0, 8)}…` });
  }
  return out;
};

/** Keep transport hints in the task payload for legacy runtimes, but never
 * expose Hub filesystem paths, raw file IDs, or authenticated GET instructions
 * as chat copy. The attachment card owns filename, retry, preview and download. */
export const cleanAttachmentDebugText = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^()\s]*\/api\/files\/[A-Za-z0-9_-]{8,64}\)/g, '$1')
    .replace(new RegExp(`^(?:\\s*(?:🖼️?\\s*)?)?(?:图片|图像|image)\\s+file[_ -]?id\\s*[:：]\\s*${FILE_ID}(?:\\s+[^\\r\\n]+)?(?:\\r?\\n|$)`, 'gim'), '')
    .replace(/^服务器路径\s*:\s*.*(?:\r?\n|$)/gim, '')
    .replace(new RegExp(`^(?:API|取回)\\s*[:：]\\s*GET\\s+\\S*\\/api\\/files\\/${FILE_ID}(?:\\s*\\([^\\r\\n]*\\))?\\s*(?:\\r?\\n|$)`, 'gim'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
