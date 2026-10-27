// 桌面端(Tauri)附件落盘。Vincent 2026-09-07「点击了没反应」:
//   - 非图片附件在桌面端只画了「📎 名字」,没有点击动作;
//   - 图片的「下载原图」走 <a download>,WKWebView / WebView2 不会真的下载。
// 现在:前端带 Bearer 取字节 → base64 → Rust `save_download` 写进系统「下载」目录 → 返回路径,
// 再用 opener 在访达/资源管理器里定位。凭据只用于取字节,不进 DOM、不进下载管理器。
export type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function downloadAuthedBytes(fetcher: AuthedFetch, url: string, token: string, onProgress?: (received: number, total?: number) => void): Promise<Uint8Array> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  const total = Number.isFinite(declared) && declared > 0 ? declared : undefined;
  // admin 2026-10-26「下载显示一下剩余时长」:有 body 流就边读边报进度,没有就退回整块读。
  const body = (response as unknown as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!onProgress || !body || typeof body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.byteLength, total ?? bytes.byteLength);
    return bytes;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); received += value.byteLength; onProgress(received, total); }
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export const isTauriDesktop = (): boolean => !!(globalThis as any).__TAURI_INTERNALS__;

/** User-initiated browser download; object URLs contain bytes, never credentials. */
export function saveBrowserDownload(bytes: Uint8Array, name: string, mime?: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** 写进系统「下载」目录(或 targetPath),返回落盘路径。只在 Tauri 桌面端可用。 */
export async function saveToDownloads(name: string, bytes: Uint8Array, targetPath?: string | null): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('save_download', { name, bytesBase64: bytesToBase64(bytes), targetPath: targetPath ?? null });
}

export const LAST_SAVE_DIR_KEY = 'attachment_last_save_dir_v1';

/** 上次「另存为」选的目录(只在 Tauri 桌面端持久化)。 */
export function loadLastSaveDir(): string | null {
  try {
    if (!isTauriDesktop() || typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(LAST_SAVE_DIR_KEY);
    return v && v.trim() ? v : null;
  } catch { return null; }
}

export function rememberSaveDir(path: string): void {
  try {
    const dir = dirnameOf(path);
    if (dir && isTauriDesktop() && typeof localStorage !== 'undefined') localStorage.setItem(LAST_SAVE_DIR_KEY, dir);
  } catch { /* storage unavailable */ }
}

export function dirnameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : '';
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** 弹系统「另存为」;返回用户选的路径,取消返回 null。默认目录 = 上次选的目录,否则系统「下载」。 */
export async function chooseSavePath(name: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const last = loadLastSaveDir();
  let defaultPath = name;
  if (last) defaultPath = joinPath(last, name);
  else {
    try { const { downloadDir } = await import('@tauri-apps/api/path'); defaultPath = joinPath(await downloadDir(), name); } catch { /* fall back to bare name */ }
  }
  const chosen = await save({ title: `保存 ${name}`, defaultPath });
  if (!chosen) return null;
  rememberSaveDir(chosen);
  return chosen;
}

export async function revealInFolder(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

/** 从「下载」目录路径里取给人看的短名(~/Downloads/x.pdf)。 */
export function displayDownloadPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? `…/${parts.slice(-2).join('/')}` : path;
}
