import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const values = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) };
const { bytesToBase64, downloadAuthedBytes, displayDownloadPath, dirnameOf, joinPath, rememberSaveDir, loadLastSaveDir, LAST_SAVE_DIR_KEY } = await import('./desktop-download');
let ck = 0; const check = (c: boolean, m: string) => { assert.ok(c, m); ck++; };
check(bytesToBase64(new Uint8Array([104, 105])) === 'aGk=', 'base64 of "hi"');
const big = new Uint8Array(100_000).map((_, i) => i % 251);
check(bytesToBase64(big) === Buffer.from(big).toString('base64'), 'chunked base64 equals Buffer for 100k bytes');
// 带凭据取字节:头里带 Bearer;非 2xx / 空体报错
{
  const calls: any[] = [];
  const bytes = await downloadAuthedBytes(async (u, init) => { calls.push([u, init]); return new Response(new Uint8Array([1, 2, 3])); }, 'http://h/api/files/x', 'tok');
  check(bytes.length === 3 && calls[0][1].headers.Authorization === 'Bearer tok', 'fetches with bearer and returns bytes');
  let err = ''; try { await downloadAuthedBytes(async () => new Response('nope', { status: 401 }), 'u', 't'); } catch (e) { err = (e as Error).message; }
  check(err === 'HTTP 401', 'non-2xx throws with status');
  err = ''; try { await downloadAuthedBytes(async () => new Response(new Uint8Array(0)), 'u', 't'); } catch (e) { err = (e as Error).message; }
  check(err === '空文件', 'empty body throws');
}
check(displayDownloadPath('/Users/v/Downloads/a.pdf') === '…/Downloads/a.pdf' && displayDownloadPath('C:\\Users\\v\\Downloads\\a.pdf') === '…/Downloads/a.pdf', 'short display path');
// 接线契约
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
check(chat.includes("a.needsAuth && a.uri && Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ ? (") && chat.includes('<AttachmentFileDesktop'), 'desktop non-image attachments render the downloadable component');
const thumb = readFileSync(new URL('./AuthedWebThumb.tsx', import.meta.url), 'utf8');
check(thumb.includes('if (!isTauriDesktop()) { saveImageObjectUrl(url, name); return; }') && thumb.includes('saveToDownloads(name, bytes, target ?? null)'), 'desktop 下载原图 goes through Rust save_download; plain web keeps the anchor');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
check(lib.includes('fn save_download(app: tauri::AppHandle, name: String, bytes_base64: String, target_path: Option<String>)') && lib.includes('save_download,'), 'Rust save_download command registered');
const cap = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
check(cap.permissions.includes('opener:allow-reveal-item-in-dir'), 'reveal-in-folder permission granted');
// 另存为:路径拆分/拼接、记住上次目录(只在 Tauri 桌面端)
check(dirnameOf('/Users/v/Desktop/a.pdf') === '/Users/v/Desktop' && dirnameOf('C:\\Users\\v\\a.pdf') === 'C:\\Users\\v' && dirnameOf('a.pdf') === '', 'dirnameOf');
check(joinPath('/Users/v/Desktop', 'a.pdf') === '/Users/v/Desktop/a.pdf' && joinPath('C:\\Users\\v', 'a.pdf') === 'C:\\Users\\v\\a.pdf' && joinPath('/x/', 'a') === '/x/a', 'joinPath');
rememberSaveDir('/Users/v/Desktop/a.pdf');
check(loadLastSaveDir() === null, 'non-desktop: nothing remembered');
(globalThis as any).__TAURI_INTERNALS__ = {};
rememberSaveDir('/Users/v/Desktop/a.pdf');
check(values.get(LAST_SAVE_DIR_KEY) === '/Users/v/Desktop' && loadLastSaveDir() === '/Users/v/Desktop', 'desktop: last dir remembered');
delete (globalThis as any).__TAURI_INTERNALS__;
const fileDesk = readFileSync(new URL('./AttachmentFileDesktop.tsx', import.meta.url), 'utf8');
check(fileDesk.includes('chooseSavePath(name)') && fileDesk.includes("if (target === null) return;") && fileDesk.includes('altKey'), 'file download: dialog by default, alt-click direct, cancel aborts');
check(thumb.includes('chooseSavePath(name)') && thumb.includes('saveToDownloads(name, bytes, target ?? null)'), '下载原图 uses the same dialog path');
check(lib.includes('target_path: Option<String>') && lib.includes('.plugin(tauri_plugin_dialog::init())') && cap.permissions.includes('dialog:allow-save'), 'Rust accepts target_path; dialog plugin registered with allow-save');
console.log(`desktop download: ${ck} checks passed`);
