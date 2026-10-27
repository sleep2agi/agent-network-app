import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { filePresentation, fileStatusKey, formatFileSize, localFileStatus } from './attachment-file-model';
import { saveBrowserDownload, downloadAuthedBytes } from './desktop-download';
import { dmSendBody } from './human-dm';
import { groupSendBody } from './group-chat';
import { localAttachmentViews } from './dm-attachment-model';
import { setLanguagePreference, languagePreference, t } from './i18n';
import { chatTranslations } from './i18n-chat';

assert.equal(formatFileSize(0), '0 B');
assert.equal(formatFileSize(1), '1 B');
assert.equal(formatFileSize(1024), '1.0 KB');
assert.equal(formatFileSize(10.5 * 1024 ** 2), '10.5 MB');
assert.equal(formatFileSize(1024 ** 3), '1.0 GB');
for (const size of [undefined, -1, NaN, Infinity]) assert.equal(formatFileSize(size), undefined);
for (const [name, label] of [['proposal.DOCX', 'DOC'], ['slides.pptx', 'PPT'], ['report.pdf', 'PDF'], ['table.xlsx', 'XLS'], ['table.csv', 'XLS'], ['bundle.tar.gz', 'ZIP'], ['app.tsx', 'CODE'], ['README.md', 'TXT'], ['unknown', 'FILE']]) {
  assert.equal(filePresentation(name).label, label);
}
assert.equal(filePresentation('unnamed', 'application/pdf').label, 'PDF');
assert.equal(filePresentation('very-long-'.repeat(100) + 'proposal.PDF').extension, '.PDF');
assert.equal(filePresentation('.gitignore').extension, '.gitignore');
assert.equal(localFileStatus(), 'queued');
assert.equal(localFileStatus({ status: 'queued' }, true), 'queued');
assert.equal(localFileStatus({ status: 'uploading' }, true), 'uploading');
assert.equal(localFileStatus({ status: 'done' }, true), 'waitingSend');
assert.equal(localFileStatus({ status: 'done' }), 'uploaded');
assert.equal(localFileStatus({ status: 'failed', error: 'offline' }), 'sendFailed');
assert.equal(localFileStatus({ status: 'done' }, false, true), 'sendFailed');
assert.equal(localFileStatus(undefined, false, true), 'sendFailed');
assert.equal(localFileStatus(undefined, true, false, true), 'waitingSend', 'restored Hub ID proves upload even without transient upload state');
assert.equal(localFileStatus(undefined, false, false, true), 'uploaded');
assert.equal(localFileStatus(undefined, false, true, true), 'sendFailed', 'Hub upload does not override whole-message failure');
assert.deepEqual(Object.keys(fileStatusKey), ['queued', 'uploading', 'uploaded', 'waitingSend', 'sendFailed', 'ready', 'downloading', 'saved', 'error']);
// #1051 P2: the model exposes translation keys, never language-specific copy.
for (const key of Object.values(fileStatusKey)) assert.match(key, /^chat\.fileStatus\./, `status key must be an i18n key, got ${key}`);
const previousLanguage = languagePreference();
try {
  for (const language of ['zh', 'en'] as const) {
    setLanguagePreference(language);
    for (const key of Object.values(fileStatusKey)) {
      assert.equal(t(key), chatTranslations[key as keyof typeof chatTranslations][language === 'zh' ? 0 : 1]);
      assert.notEqual(t(key), key);
      if (language === 'en') assert.ok(!/[\u4e00-\u9fff]/.test(t(key)), 'English file states contain no Chinese copy');
    }
  }
} finally { setLanguagePreference(previousLanguage); }

// Real send bodies must preserve all available metadata, including zero bytes.
const attachment = { file_id: 'f1', name: 'empty.txt', mime: 'text/plain', size: 0 };
for (const body of [
  dmSendBody({ networkId: 'n', toUserId: 'u', message: '', attachments: [attachment], clientRequestId: 'same-id' }),
  groupSendBody({ message: '', attachments: [attachment], clientRequestId: 'same-id' }),
]) {
  assert.deepEqual(body.attachments?.[0], { type: 'file', ...attachment });
  assert.equal(body.client_request_id, 'same-id');
}
const views = localAttachmentViews([
  { uri: 'blob:image', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 20 },
  { uri: 'blob:file', fileName: 'empty.txt', mimeType: 'text/plain', fileSize: 0 },
]);
assert.equal(views[0].isImage, true);
assert.equal(views[1].isImage, false);
assert.equal(views[1].size, 0);

// Browser path: authenticated bytes -> blob-only anchor -> delayed revoke.
const originalDocument = globalThis.document;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const originalTimeout = globalThis.setTimeout;
let blob: Blob | undefined;
let clicked = false;
let removed = false;
let appended = false;
let revoke: (() => void) | undefined;
const anchor = { href: '', download: '', style: { display: '' }, click() { clicked = true; }, remove() { removed = true; } };
try {
  globalThis.document = { createElement: () => anchor, body: { appendChild: () => { appended = true; } } } as unknown as Document;
  URL.createObjectURL = value => { blob = value as Blob; return 'blob:opaque-bytes'; };
  URL.revokeObjectURL = url => assert.equal(url, 'blob:opaque-bytes');
  globalThis.setTimeout = ((fn: () => void, ms: number) => { assert.equal(ms, 60_000); revoke = fn; return 0; }) as unknown as typeof setTimeout;
  const bytes = await downloadAuthedBytes(async (url, init) => {
    assert.equal(url, 'https://hub/api/files/f1');
    assert.deepEqual(init?.headers, { Authorization: 'Bearer secret' });
    return new Response(new Uint8Array([1, 2, 3]));
  }, 'https://hub/api/files/f1', 'secret');
  saveBrowserDownload(bytes, 'report.pdf', 'application/pdf');
  assert.equal(anchor.href, 'blob:opaque-bytes');
  assert.equal(anchor.download, 'report.pdf');
  assert.ok(clicked && removed && appended);
  assert.equal(blob?.type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await blob!.arrayBuffer())], [1, 2, 3]);
  assert.ok(revoke);
  revoke!();
} finally {
  globalThis.document = originalDocument;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  globalThis.setTimeout = originalTimeout;
}

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const chat = source('./ChatScreen.tsx');
const dm = source('./DmChatScreen.tsx');
const card = source('./AttachmentFileCard.tsx');
const desktop = source('./AttachmentFileDesktop.tsx');
const native = source('./AuthedThumb.tsx');
assert.ok(chat.includes('item._uploads?.[a.localIndex]'));
assert.ok(chat.includes('onPress={item._failed ? () => retry(item) : undefined}'));
assert.ok(chat.includes('if (a.needsAuth && !item._pending && !item._failed) return renderAttachment(a, gallery, mine);'), 'settled restored Hub-backed files use authenticated download instead of a disabled queued card');
assert.ok(chat.includes('localFileStatus(upload, item._pending, item._failed, a.needsAuth)'));
const webImageBranch = chat.indexOf("a.isImage && a.needsAuth && Platform.OS === 'web' ? (");
assert.ok(webImageBranch > 0 && webImageBranch < chat.indexOf("a.needsAuth && a.uri && Platform.OS === 'web' ? ("), 'browser image previews precede generic file downloads');
assert.ok(chat.includes('a.isImage && !!a.uri;'), 'browser images remain in mixed image grids');
assert.ok(chat.includes('{rest.map(a => localFile(a) ?? renderAttachment(a, gallery, mine))}'), 'mixed multi-image/file branch uses the same local status card');
assert.ok(dm.includes('m._uploads?.[views.indexOf(a)]'), 'mixed DM files retain original indices');
assert.ok(dm.includes('localFileStatus(uploadsFor(a), m.pending, m.failed)'));
assert.ok(dm.includes('onPress={m.failed ? () => retry(m) : undefined}'));
assert.ok(dm.includes("purpose: 'dm'"));
assert.ok(dm.includes('if (a.needsAuth && Platform.OS === \'web\') return <AttachmentFileDesktop'));
assert.ok(card.includes('numberOfLines={2}') && card.includes('attachment-file-extension'));
assert.ok(card.includes("extension: { flexShrink: 0, maxWidth: '45%' }") && card.includes('stem: { flexShrink: 1, minWidth: 0 }'), 'normal extensions never shrink; short names stay adjacent to their extension');
assert.ok(card.includes('<ActivityIndicator') && card.includes("status === 'uploading' || status === 'downloading'"), 'upload has no byte progress (we never get upload bytes)');
// admin 2026-10-26「下载显示一下剩余时长」:下载进度只能来自真实字节数(onProgress 轮询 part 文件),
// 卡片只负责显示别人算好的字符串 —— 不许在卡片里凭空造数字。
assert.ok(card.includes('progress?: string') && card.includes('{progress ?') && !/percent|Math\.round\(.*100/.test(card), 'card renders a caller-supplied progress string only (no fabricated numbers)');
assert.ok(card.includes('backgroundColor: colors.card') && card.includes('color: colors.text'));
assert.ok(card.includes('useTranslation()') && card.includes('t(fileStatusKey[status])'), 'file cards resolve current language reactively');
assert.ok(desktop.indexOf('busy.current = true') < desktop.indexOf('await chooseSavePath(name)'));
assert.ok(!desktop.includes('openPath') && !desktop.includes('shell'));
assert.ok(native.includes('await downloadAttachment(serverUrl, token, fileId, name, resolvedMime, onProgress)') && native.includes('await Sharing.shareAsync(local'));
console.log('attachment file card: pure model, metadata, browser transport and wiring checks passed');
