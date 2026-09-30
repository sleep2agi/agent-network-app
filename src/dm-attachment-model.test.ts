// 私信附件(owner 2026-09-30「给人好像发不了图片」)—— 纯逻辑 + DmChatScreen 接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { attachmentPreviewText, dmAttachmentViews, eventAttachmentPreview, localAttachmentViews } from './dm-attachment-model';
import { viewerImageFor } from './image-viewer-model';
import { uploadUrlFor } from './upload-url';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

// —— hub 上的附件 → 可画的视图 ——
{
  const meta_json = JSON.stringify({ attachments: [
    { type: 'file', file_id: 'f_img', name: 'shot.png', mime: 'image/png', size: 10 },
    { type: 'file', file_id: 'f_pdf', name: 'spec.pdf', mime: 'application/pdf' },
    { type: 'file', file_id: 'f_img', name: 'dup.png', mime: 'image/png' },
    { type: 'file', file_id: '', name: 'empty.png' },
  ] });
  const v = dmAttachmentViews({ meta_json }, 'https://hub.example');
  ck('dedupes by file_id and drops empty ids', v.length === 2 && v[0].key === 'f_img' && v[1].key === 'f_pdf');
  ck('hub attachments need auth and point at /api/files', v.every(a => a.needsAuth) && v[0].uri === 'https://hub.example/api/files/f_img');
  ck('image vs file by mime', v[0].isImage && !v[1].isImage);
  ck('no meta → no views', dmAttachmentViews({ meta_json: null }, 'h').length === 0 && dmAttachmentViews({ meta_json: '{bad' }, 'h').length === 0);
  // 桌面(Tauri web)要走带令牌的 authUri,手机走 fileId —— 与 agent 会话同一个判定
  ck('Tauri desktop previews via authUri', viewerImageFor(v[0], { os: 'web', tauri: true })?.authUri === v[0].uri);
  ck('phone previews via fileId', viewerImageFor(v[0], { os: 'android', tauri: false })?.fileId === 'f_img');
  ck('files are not previewable', viewerImageFor(v[1], { os: 'web', tauri: true }) === null);
}

// —— 发送中的那条画本地草稿 ——
{
  const v = localAttachmentViews([
    { uri: 'blob:1', fileName: 'image.png', mimeType: 'image/png', fileSize: 5 },
    { uri: 'blob:2', fileName: 'image.png', mimeType: 'image/png' },
    { uri: 'file:///a.zip', fileName: 'a.zip', mimeType: 'application/zip' },
  ]);
  ck('local views keep order and distinct keys for same-named pastes', v.map(a => a.key).join() === 'blob:1,blob:2,file:///a.zip');
  ck('local views need no auth', v.every(a => !a.needsAuth));
  ck('local image previews with its own uri', viewerImageFor(v[0], { os: 'web', tauri: true })?.uri === 'blob:1');
}

// —— 上传地址:私信带 purpose=dm,agent 会话不带(旧形状逐字不变)——
{
  ck('chat upload url unchanged', uploadUrlFor('https://h') === 'https://h/api/upload' && uploadUrlFor('https://h', { networkId: 'n 1' }) === 'https://h/api/upload?network_id=n%201');
  ck('DM upload url carries purpose=dm', uploadUrlFor('https://h', { networkId: 'n1', purpose: 'dm' }) === 'https://h/api/upload?network_id=n1&purpose=dm');
}

// —— 只有附件时的预览一行 ——
{
  ck('all images → [图片]', attachmentPreviewText([{ mime: 'image/png' }, { name: 'a.JPG' }]) === '[图片]');
  ck('any non-image → [文件]', attachmentPreviewText([{ mime: 'image/png' }, { name: 'a.pdf' }]) === '[文件]');
  ck('nothing → null', attachmentPreviewText([]) === null);
  ck('event meta parsed', eventAttachmentPreview({ attachments: [{ file_id: 'x', mime: 'image/webp' }] }) === '[图片]');
  ck('event meta junk → null', eventAttachmentPreview(null) === null && eventAttachmentPreview({ attachments: 'x' }) === null && eventAttachmentPreview({ attachments: [{}] }) === null);
}

// —— 接线:私信和 agent 会话同一套入口 / 画法(源码层;真跑见 PR 的两账号驱动截图)——
{
  const src = readFileSync(new URL('./DmChatScreen.tsx', import.meta.url), 'utf8');
  ck('paste: window paste listener feeds attachmentsFromClipboard', /addEventListener\('paste'/.test(src) && src.includes('attachmentsFromClipboard('));
  ck('drop: listens for drop scoped to the dm pane', /addEventListener\('drop'/.test(src) && src.includes('[data-testid="dm-pane"]'));
  ck('phone ＋ opens the WeChat panel (album / file / camera)', src.includes('plusPanelItems(') && src.includes('pickImages(') && src.includes('pickCameraPhoto('));
  ck('uploads go through the shared queue with the network id', src.includes('runUploadQueue(') && /uploadImage\(cfg, prepared, \{ networkId, purpose: 'dm' \}\)/.test(src));
  ck('send is blocked on oversize / too many (sendBlocker)', src.includes('sendBlocker('));
  ck('tapping an image opens the viewer', src.includes('<ImageViewer') && !src.includes('onPress={() => {}}'));
  // 桌面上 AuthedThumb / AttachmentFile(expo-file-system)下载不了 —— 必须先分出 Tauri 分支
  const tauriIdx = src.indexOf('if (tauriWeb) return <AuthedWebThumb');
  const nativeIdx = src.indexOf("if (Platform.OS !== 'web') return <AuthedThumb");
  ck('desktop images use AuthedWebThumb before the native AuthedThumb branch', tauriIdx > 0 && nativeIdx > tauriIdx);
  ck('desktop files use AttachmentFileDesktop', src.includes('<AttachmentFileDesktop'));
  ck('failed sends can be retried with the same client id', src.includes('retry(item)') && src.includes('deliver(m.message_id'));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
