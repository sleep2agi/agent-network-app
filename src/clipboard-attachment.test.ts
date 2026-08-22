// @ts-nocheck -- repository tests run directly under Bun/Node.
import { attachmentFromClipboard, isTauriDesktop, releaseClipboardAttachment } from './clipboard-attachment';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let revoked = '';
URL.createObjectURL = () => 'blob:pasted-1';
URL.revokeObjectURL = value => { revoked = value; };

try {
  const file = new File(['png-bytes'], 'screen.png', { type: 'image/png' });
  const pasted = attachmentFromClipboard({
    0: { kind: 'string', getAsFile: () => null },
    1: { kind: 'file', getAsFile: () => file },
    length: 2,
  });
  ck('pasted image becomes an attachment', pasted?.fileName === 'screen.png');
  ck('clipboard MIME and size are preserved', pasted?.mimeType === 'image/png' && pasted.fileSize === file.size);
  ck('original browser File is retained for multipart upload', pasted?.webFile === file);
  ck('preview uses a blob URL', pasted?.uri === 'blob:pasted-1');
  ck('text-only clipboard keeps native text paste', attachmentFromClipboard({ 0: { kind: 'string' }, length: 1 }) === null);
  ck('non-Tauri web/mobile runtime does not install desktop paste handling', isTauriDesktop() === false);
  releaseClipboardAttachment(pasted);
  ck('discarding a pasted attachment releases its blob URL', revoked === 'blob:pasted-1');
} finally {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
