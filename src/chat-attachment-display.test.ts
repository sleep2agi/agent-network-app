import { cleanAttachmentDebugText, parseAttachmentRefs, parseMetaAttachmentRefs } from './attachment-display';
import { readFileSync } from 'node:fs';

const original = [
  '请查看图片',
  '',
  '📎 附件 image.png（image/png）',
  '服务器路径: /home/hub/.anet/server/uploads/2026-08-23/private.png',
  'API: GET /api/files/a9017bd8d01c493e8c9a8a89b3c19f02',
].join('\n');

const cleaned = cleanAttachmentDebugText(original);
if (!cleaned.includes('请查看图片') || !cleaned.includes('📎 附件 image.png')) {
  throw new Error(`user-facing copy was removed: ${cleaned}`);
}
if (/服务器路径|\/home\/hub|API\s*:|\/api\/files\//i.test(cleaned)) {
  throw new Error(`transport metadata leaked: ${cleaned}`);
}

const nodeReply = [
  '本轮截图如下：',
  '图片 file_id: e697d597107f418ba1fe7d71e9464b98',
  '取回: GET /api/files/e697d597107f418ba1fe7d71e9464b98 (需 Bearer)',
].join('\n');
const replyRefs = parseAttachmentRefs(nodeReply);
if (replyRefs.length !== 1
  || replyRefs[0].fileId !== 'e697d597107f418ba1fe7d71e9464b98'
  || replyRefs[0].mime !== 'image/*') {
  throw new Error(`node image marker was flattened or downgraded: ${JSON.stringify(replyRefs)}`);
}
const cleanReply = cleanAttachmentDebugText(nodeReply);
if (cleanReply !== '本轮截图如下：' || /file_id|取回|Bearer|\/api\/files/.test(cleanReply)) {
  throw new Error(`internal node retrieval hint is still visible: ${cleanReply}`);
}

const many = parseAttachmentRefs([
  '图片 file_id: aaaaaaaa11111111 first.png',
  '取回: GET /api/files/aaaaaaaa11111111 (需 Bearer)',
  '中间说明',
  '图片 file_id: bbbbbbbb22222222 second.jpg',
  '取回: GET /api/files/bbbbbbbb22222222 (需 Bearer)',
].join('\n'));
if (many.length !== 2 || many[0].mime !== 'image/png' || many[1].mime !== 'image/jpeg') {
  throw new Error(`multi-image reply lost type/order: ${JSON.stringify(many)}`);
}

const structured = parseMetaAttachmentRefs(JSON.stringify({ attachments: [
  { type: 'file', file_id: 'cccccccc33333333', name: 'report.png', mime: 'image/png', size: 321 },
  { type: 'file', file_id: 'dddddddd44444444', name: 'photo.jpg', mime: 'image/jpeg', size: 654 },
] }));
if (structured.length !== 2 || structured[0].name !== 'report.png'
  || structured[0].mime !== 'image/png' || structured[0].size !== 321) {
  throw new Error(`structured attachment fields were not preserved: ${JSON.stringify(structured)}`);
}
if (parseMetaAttachmentRefs({ attachments: [{ type: 'file', file_id: '../../token' }] }).length !== 0) {
  throw new Error('untrusted structured file id reached the cache/download path');
}

const chatSource = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
if (!chatSource.includes('AuthedWebThumb') || !chatSource.includes('__TAURI_INTERNALS__')) {
  throw new Error('Tauri authenticated images do not use the native HTTP thumbnail path');
}
if (!chatSource.includes('parseAttachmentRefs(text)') || !chatSource.includes('label="下载原图"')) {
  throw new Error('both chat windows do not wire parsed node images to preview + download');
}
const viewerScope = chatSource.match(
  /const attachmentViewerScope = `\$\{conversationKeyFor\}::\$\{attachmentCacheScope\(cfg\.serverUrl, cfg\.token\)\}`;/,
);
const viewerReset = chatSource.match(
  /useEffect\(\(\) => setViewerUri\(null\), \[attachmentViewerScope\]\);/,
);
if (!viewerScope || !viewerReset) {
  throw new Error('the image viewer is closed when conversation or authenticated scope changes');
}
if (!/AuthedWebThumb[\s\S]*?onPress=\{objectUrl => setViewerUri\(objectUrl\)\}/.test(chatSource)) {
  throw new Error('the scoped viewer guard does not cover Tauri blob previews');
}
if (!/AuthedThumb[\s\S]*?onPress=\{localUri => setViewerUri\(localUri\)\}/.test(chatSource)) {
  throw new Error('the scoped viewer guard does not cover native file previews');
}

console.log('chat attachment display: 16 checks passed');
