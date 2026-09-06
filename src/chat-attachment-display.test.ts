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

// #1823 —— 回复附件读 meta_json.reply_attachments;attachments 仍属提问者;旧 hub 无此键 → 空
{
  const { parseMetaReplyAttachmentRefs: parseReply, parseMetaAttachmentRefs: parseSent } = await import('./attachment-display');
  const meta = JSON.stringify({
    attachments: [{ type: 'file', file_id: 'a1b2c3d4e5f6a7b8', name: 'asked.png', mime: 'image/png', size: 10 }],
    reply_attachments: [{ type: 'file', file_id: 'f1e2d3c4b5a69788', name: 'answer.md', mime: 'text/markdown', size: 20 }, { type: 'file', file_id: 'bad id' }],
  });
  const reply = parseReply(meta);
  const sent = parseSent(meta);
  if (reply.length !== 1 || reply[0].fileId !== 'f1e2d3c4b5a69788' || reply[0].name !== 'answer.md') throw new Error(`reply refs wrong: ${JSON.stringify(reply)}`);
  if (sent.length !== 1 || sent[0].fileId !== 'a1b2c3d4e5f6a7b8') throw new Error(`sent refs wrong: ${JSON.stringify(sent)}`);
  if (parseReply(JSON.stringify({ attachments: [{ type: 'file', file_id: 'a1b2c3d4e5f6a7b8' }] })).length !== 0) throw new Error('old hub shape must not leak into reply refs');
  if (parseReply('not json').length !== 0 || parseReply(null).length !== 0) throw new Error('garbage → empty');
  const { readFileSync } = await import('node:fs');
  const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  const fn = chat.slice(chat.indexOf('const replyAttachmentViews'), chat.indexOf('const replyAttachmentViews') + 700);
  if (!fn.includes('parseMetaReplyAttachmentRefs((item as any).meta_json)')) throw new Error('reply bubble must read meta_json.reply_attachments');
  console.log('PASS: reply attachments read from meta_json.reply_attachments (#1823)');
}
