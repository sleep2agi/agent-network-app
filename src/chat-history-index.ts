// 一条会话里出现过的文件和链接。只看已加载的消息，不另打接口。
// 项目文件夹是节点工作目录，不是这里的文件。

const FILE_ID = '[A-Za-z0-9_-]{8,64}';
const URL_RE = /https?:\/\/[^\s<>"'）)]+/gi;

export type HistoryFile = { fileId: string; name: string };
export type HistoryLink = { url: string; label: string };

export type HistoryMessage = {
  content?: string | null;
  result?: string | null;
  reply?: string | null;
  meta_json?: unknown;
};

function textOf(message: HistoryMessage): string {
  return [message.content, message.result ?? message.reply].filter(Boolean).join('\n');
}

function pushFile(out: HistoryFile[], seen: Set<string>, fileId: string, name: string) {
  if (!fileId || seen.has(fileId)) return;
  seen.add(fileId);
  out.push({ fileId, name: name.trim() || fileId });
}

function filesFromMeta(raw: unknown, out: HistoryFile[], seen: Set<string>) {
  if (!raw) return;
  try {
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!meta || typeof meta !== 'object') return;
    for (const key of ['attachments', 'reply_attachments'] as const) {
      const list = (meta as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const row = item as { type?: unknown; file_id?: unknown; name?: unknown };
        if (row.type !== 'file' || typeof row.file_id !== 'string') continue;
        if (!new RegExp(`^${FILE_ID}$`).test(row.file_id)) continue;
        pushFile(out, seen, row.file_id, typeof row.name === 'string' ? row.name : row.file_id);
      }
    }
  } catch {
    /* malformed meta is not a reason to hide the rest */
  }
}

export function historyFiles(messages: readonly HistoryMessage[]): HistoryFile[] {
  const out: HistoryFile[] = [];
  const seen = new Set<string>();
  const fileRe = new RegExp(`/api/files/(${FILE_ID})`, 'g');
  for (const message of messages) {
    filesFromMeta(message.meta_json, out, seen);
    for (const match of textOf(message).matchAll(fileRe)) pushFile(out, seen, match[1], match[1]);
  }
  return out;
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?，。；：！？]+$/g, '');
}

export function historyLinks(messages: readonly HistoryMessage[]): HistoryLink[] {
  const out: HistoryLink[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const match of textOf(message).matchAll(URL_RE)) {
      const url = cleanUrl(match[0]);
      if (!url || url.includes('/api/files/') || seen.has(url)) continue;
      seen.add(url);
      let label = url;
      try { label = new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, ''); } catch { /* keep raw */ }
      out.push({ url, label });
    }
  }
  return out;
}
