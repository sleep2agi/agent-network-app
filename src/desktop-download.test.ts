import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const { bytesToBase64, downloadAuthedBytes, displayDownloadPath } = await import('./desktop-download');
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
check(thumb.includes('if (!isTauriDesktop()) { saveImageObjectUrl(url, name); return; }') && thumb.includes('saveToDownloads(name, bytes)'), 'desktop 下载原图 goes through Rust save_download; plain web keeps the anchor');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
check(lib.includes('fn save_download(app: tauri::AppHandle, name: String, bytes_base64: String)') && lib.includes('save_download,'), 'Rust save_download command registered');
const cap = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
check(cap.permissions.includes('opener:allow-reveal-item-in-dir'), 'reveal-in-folder permission granted');
console.log(`desktop download: ${ck} checks passed`);
