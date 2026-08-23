import { cleanAttachmentDebugText } from './attachment-display';
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

const chatSource = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
if (!chatSource.includes('AuthedWebThumb') || !chatSource.includes('__TAURI_INTERNALS__')) {
  throw new Error('Tauri authenticated images do not use the native HTTP thumbnail path');
}

console.log('chat attachment display tests passed');
