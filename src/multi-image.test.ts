// ck-style (self-executing; run by scripts/run-tests.mjs — NOT bun:test).
// 「像微信一样支持选择多张图片」:草稿模型(上限/顺序)、原图压缩决策、上传队列(并发/失败)、
// 以及 ChatScreen / attach.ts 的接线契约。
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const draft = await import('./image-draft');
const queue = await import('./upload-queue');
const {
  addToDraft, removeFromDraft, remainingImageSlots, draftCountLabel, draftImageCount, isDraftImage,
  planCompression, PICKER_QUALITY, willCompressBeforeUpload, compressedFileName, oversizeMessage, sendBlocker,
  MAX_DRAFT_IMAGES, MAX_DRAFT_ATTACHMENTS, MAX_UPLOAD_BYTES, COMPRESS_MAX_EDGE, COMPRESS_QUALITY,
} = draft;
const { runUploadQueue, createUploadMemo, withUploadState, removeAttachmentAt, uploadFailureSummary, UPLOAD_CONCURRENCY } = queue;

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

const img = (n: number, extra: Record<string, unknown> = {}) => ({ uri: `file:///p/${n}.jpg`, fileName: `${n}.jpg`, mimeType: 'image/jpeg', fileSize: 1000, ...extra });
const file = (n: number) => ({ uri: `file:///d/${n}.pdf`, fileName: `${n}.pdf`, mimeType: 'application/pdf', fileSize: 1000 });
const uris = (list: { uri: string }[]) => list.map(x => x.uri.replace(/^file:\/\/\/\w\//, '')).join(',');

// ── draft model: limit + ordering ────────────────────────────────────────────
check(MAX_DRAFT_IMAGES === 9, 'WeChat limit: 9 images');
check(MAX_DRAFT_ATTACHMENTS === 20, 'hub validateAttachments cap: 20 per message');
check(MAX_UPLOAD_BYTES === 12 * 1024 * 1024, 'hub /api/upload cap: 12 MiB');
{
  const first = addToDraft([], [img(3), img(1), img(2)]);
  check(uris(first.next) === '3.jpg,1.jpg,2.jpg', 'selection order kept (no sorting)');
  check(first.notice === null && first.rejected.length === 0, 'within the limit: no notice');
  const second = addToDraft(first.next, [img(4), img(5), img(6), img(7), img(8), img(9), img(10), img(11)]);
  check(second.next.length === 9, 'limit enforced ACROSS picks: 3 + 8 → 9');
  check(uris(second.next) === '3.jpg,1.jpg,2.jpg,4.jpg,5.jpg,6.jpg,7.jpg,8.jpg,9.jpg', 'earlier picks keep their slots; overflow is the tail of the new pick');
  check(uris(second.rejected) === '10.jpg,11.jpg', 'the overflowing images are reported');
  check(second.notice === '最多选择 9 张图片，已忽略 2 张', 'toast text names the limit and the dropped count');
  const full = addToDraft(second.next, [img(12)]);
  check(full.next.length === 9 && full.accepted.length === 0 && !!full.notice, 'a full draft rejects further images with a toast');
  check(remainingImageSlots(second.next) === 0, 'no slots left → picker must not open');
  check(remainingImageSlots(first.next) === 6, 'remaining slots = 9 − images already in the draft');
  check(remainingImageSlots([]) === 9, 'empty draft → 9 slots');
}
{
  // files do not use image slots, but the total 20 cap still applies
  const mixed = addToDraft([file(1), file(2)], [img(1), img(2)]);
  check(draftImageCount(mixed.next) === 2 && mixed.next.length === 4, 'files do not count toward the 9 images');
  check(remainingImageSlots(mixed.next) === 7, 'files do not eat image slots');
  const manyFiles = Array.from({ length: 19 }, (_, i) => file(i));
  check(remainingImageSlots(manyFiles) === 1, 'remaining slots also bounded by the 20-attachment total');
  const over = addToDraft(manyFiles, [img(1), img(2)]);
  check(over.next.length === 20 && over.rejected.length === 1 && /20 个附件/.test(over.notice ?? ''), 'total cap 20 enforced with its own notice');
}
{
  const d = addToDraft([], [img(1), img(2), img(3)]).next;
  const r = removeFromDraft(d, 'file:///p/2.jpg');
  check(uris(r.next) === '1.jpg,3.jpg' && r.removed?.fileName === '2.jpg', 'remove keeps the order of the rest');
  check(removeFromDraft(d, 'nope').removed === null, 'removing an unknown uri is a no-op');
  check(remainingImageSlots(r.next) === 7, 'removing frees a slot');
  check(draftCountLabel(d) === '3/9 张图片', 'count label for images');
  check(draftCountLabel([...d, file(1)]) === '3/9 张图片 · 1 个文件', 'count label with files');
  check(isDraftImage({ fileName: 'x.HEIC', mimeType: '' }) && !isDraftImage({ fileName: 'x.pdf', mimeType: 'application/pdf' }), 'image detection by mime or extension');
}

// ── 原图 / compression decision ───────────────────────────────────────────────
{
  const big = { mimeType: 'image/jpeg', fileName: 'a.jpg', fileSize: 6_000_000, width: 4032, height: 3024 };
  const off = planCompression({ ...big, original: false });
  check(off.kind === 'resize', '原图 off + 4032×3024 → resize');
  check(off.kind === 'resize' && off.width === COMPRESS_MAX_EDGE && off.height === 1536, 'longest edge scaled to 2048, aspect kept (4032×3024 → 2048×1536)');
  check(off.kind === 'resize' && off.quality === 0.8 && off.mimeType === 'image/jpeg', 'JPEG quality 0.8');
  const portrait = planCompression({ ...big, width: 3000, height: 6000, original: false });
  check(portrait.kind === 'resize' && portrait.height === 2048 && portrait.width === 1024, 'portrait: the long edge is the height');
  const on = planCompression({ ...big, original: true });
  check(on.kind === 'keep' && on.reason === 'original', '原图 on → original bytes, never resized');
  check(planCompression({ ...big, width: 1200, height: 900, fileSize: 400_000, original: false }).kind === 'keep', 'already small → keep (no pointless re-encode)');
  const heavySmall = planCompression({ ...big, width: 1800, height: 1800, fileSize: 5_000_000, original: false });
  check(heavySmall.kind === 'resize' && heavySmall.width === 1800, 'within 2048 but heavy (>1.5MB) → re-encode at the same size');
  check(planCompression({ ...big, mimeType: 'image/gif', fileName: 'a.gif', original: false }).kind === 'keep', 'GIF kept (animation)');
  check(planCompression({ mimeType: 'application/pdf', fileName: 'a.pdf', fileSize: 9e6, width: 5000, height: 5000, original: false }).kind === 'keep', 'non-images never touched');
  check(planCompression({ ...big, width: 0, height: 0, original: false }).kind === 'keep', 'unknown pixel size → keep (never guess)');
  check(PICKER_QUALITY === 1 && COMPRESS_QUALITY === 0.8, 'picker always returns original bytes (quality 1); 0.8 is applied at send time');
  const jpg = { fileName: 'a.jpg', mimeType: 'image/jpeg' };
  check(willCompressBeforeUpload(jpg, { original: false, platform: 'android' }) && willCompressBeforeUpload(jpg, { original: false, platform: 'ios' }), 'native with 原图 off: compressed before upload');
  check(!willCompressBeforeUpload(jpg, { original: true, platform: 'android' }), '原图 on: never compressed');
  check(!willCompressBeforeUpload(jpg, { original: false, platform: 'web' }) && willCompressBeforeUpload({ ...jpg, webFile: new Blob(['x']) }, { original: false, platform: 'web' }), 'web compresses only when it has the File bytes');
  check(!willCompressBeforeUpload({ fileName: 'a.gif', mimeType: 'image/gif' }, { original: false, platform: 'android' }) && !willCompressBeforeUpload({ fileName: 'r.pdf', mimeType: 'application/pdf' }, { original: false, platform: 'android' }), 'GIF and files are never compressed');
  check(compressedFileName('IMG_0001.PNG') === 'IMG_0001.jpg' && compressedFileName('noext') === 'noext.jpg', 'compressed file gets a .jpg name');
}

// ── 12 MB ───────────────────────────────────────────────────────────────────
{
  check(oversizeMessage({ fileName: 'ok.jpg', fileSize: MAX_UPLOAD_BYTES }) === null, 'exactly 12 MiB is allowed (hub uses >)');
  const msg = oversizeMessage({ fileName: 'big.jpg', fileSize: MAX_UPLOAD_BYTES + 1 });
  check(!!msg && msg.includes('big.jpg') && msg.includes('12MB'), 'oversize error names the file and the limit');
  check(oversizeMessage({ fileName: 'x', fileSize: undefined }) === null, 'unknown size is not reported as oversize');
  const huge = img(9, { fileSize: 20 * 1024 * 1024 });
  const d = [img(1), huge];
  check(!!sendBlocker(d, () => false)?.includes('9.jpg'), '原图/native: a >12MB image blocks sending');
  check(sendBlocker(d, x => x === huge) === null, 'web with 原图 off: the big one will be compressed first, not blocked up front');
  check(sendBlocker([img(1), img(2)], () => false) === null, 'normal draft is sendable');
  check(!!sendBlocker(Array.from({ length: 10 }, (_, i) => img(i)), () => false), 'more than 9 images can never be sent');
}

// ── upload queue ─────────────────────────────────────────────────────────────
check(UPLOAD_CONCURRENCY >= 2 && UPLOAD_CONCURRENCY <= 3, 'concurrency is limited to 2–3');
{
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const delays = [30, 5, 20, 1, 15, 2, 8];
  const run = await runUploadQueue(delays, async (ms, i) => {
    started.push(i);
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, ms));
    active--;
    return `up-${i}`;
  }, { concurrency: 3 });
  check(peak === 3, `never more than 3 uploads in flight (peak=${peak})`);
  check(started.join(',') === '0,1,2,3,4,5,6', 'uploads start in selection order');
  check(run.results.join(',') === 'up-0,up-1,up-2,up-3,up-4,up-5,up-6', 'results come back in selection order even when finishing out of order');
  check(run.failed.length === 0, 'no failures');
}
{
  let peak = 0; let active = 0;
  await runUploadQueue([1, 2, 3, 4], async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 3)); active--; }, { concurrency: 2 });
  check(peak === 2, 'concurrency option honoured (2)');
}
{
  const states: string[] = [];
  const run = await runUploadQueue(['a', 'b', 'c', 'd'], async (x) => {
    await new Promise(r => setTimeout(r, 2));
    if (x === 'b' || x === 'd') throw new Error(`boom-${x}`);
    return x.toUpperCase();
  }, { concurrency: 3, onState: (i, s) => states.push(`${i}:${s.status}`) });
  check(run.failed.join(',') === '1,3', 'failed indices reported');
  check(run.results[0] === 'A' && run.results[2] === 'C' && run.results[1] === undefined, 'one failure does not stop the others');
  check(run.errors[1] === 'boom-b' && run.errors[0] === undefined, 'error text kept per item');
  check(states.includes('1:failed') && states.includes('0:done') && states.filter(s => s.endsWith(':queued')).length === 4, 'per-image state events: queued → uploading → done|failed');
  check(states.indexOf('0:uploading') < states.indexOf('0:done'), 'uploading precedes done');
  const summary = uploadFailureSummary(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'], run.errors);
  check(summary === '2 个附件上传失败：b.jpg（boom-b）、d.jpg（boom-d）', 'failure summary names each failed file');
  check(uploadFailureSummary(['a'], [undefined]) === null, 'no failure → no summary');
}
{
  const run = await runUploadQueue([1], async () => { throw 'plain'; }, { onState: () => { throw new Error('ui'); } });
  check(run.failed.length === 1 && run.errors[0] === 'plain', 'non-Error rejections and throwing UI callbacks are contained');
  const empty = await runUploadQueue([], async () => 1);
  check(empty.results.length === 0 && empty.failed.length === 0, 'empty queue resolves');
}
{
  const memo = createUploadMemo<string>();
  memo.set('https://hub', 'file:///1.jpg', false, 'F1');
  check(memo.get('https://hub', 'file:///1.jpg', false) === 'F1', 'retry reuses an uploaded result');
  check(memo.get('https://hub', 'file:///1.jpg', true) === undefined, 'switching 原图 re-uploads');
  check(memo.get('https://other', 'file:///1.jpg', false) === undefined, 'another hub re-uploads');
}
{
  const s = withUploadState(undefined, 3, 1, { status: 'uploading' });
  check(s.map(x => x.status).join(',') === 'queued,uploading,queued', 'state array padded with queued');
  const s2 = withUploadState(s, 3, 2, { status: 'failed', error: 'x' });
  check(s2[1].status === 'uploading' && s2[2].status === 'failed' && s[2].status === 'queued', 'state update is immutable');
  const r = removeAttachmentAt(['a', 'b', 'c'], s2, 2);
  check(r.imgs.join(',') === 'a,b' && r.states?.length === 2, 'remove a failed attachment from a failed message');
}

// ── grid bubble text: no per-image 📎 lines ──────────────────────────────────
{
  const { hideGridImageLines, cleanAttachmentDebugText } = await import('./attachment-display');
  const hint = (n: string, mime = 'image/jpeg') => `\n\n📎 附件 ${n}（${mime}）\n服务器路径: /x/${n}\nAPI: GET https://hub/api/files/abcdefgh12345678`;
  const raw = `看图${hint('a.jpg')}${hint('b.jpg')}${hint('r.pdf', 'application/pdf')}`;
  const cleaned = cleanAttachmentDebugText(raw);
  check(cleaned.includes('📎 附件 a.jpg（image/jpeg）'), 'precondition: cleaned text still lists each image');
  const out = hideGridImageLines(cleaned, ['a.jpg', 'b.jpg']);
  check(out.startsWith('看图') && !out.includes('a.jpg') && !out.includes('b.jpg'), 'grid images are not listed again as 📎 lines');
  check(out.includes('📎 附件 r.pdf（application/pdf）'), 'file lines stay');
  check(hideGridImageLines('📎 附件 a.jpg（application/octet-stream）', ['a.jpg', 'b.jpg']).includes('octet-stream'), 'only image/* lines are hidden, even on a name clash');
  check(hideGridImageLines(cleaned, ['a.jpg']) === cleaned, 'single image (no grid): text untouched');
  check(hideGridImageLines(cleanAttachmentDebugText(`x${hint('c.jpg')}${hint('d.jpg')}`), ['a.jpg', 'b.jpg']).includes('c.jpg'), 'only names actually in the grid are hidden');
}

// ── wiring (source contract) ─────────────────────────────────────────────────
const attach = readFileSync(new URL('./attach.ts', import.meta.url), 'utf8');
{
  const pick = attach.slice(attach.indexOf('export const pickImages'), attach.indexOf('export const prepareForUpload'));
  check(/allowsMultipleSelection:\s*true/.test(pick), 'picker: allowsMultipleSelection');
  check(/selectionLimit:\s*limit/.test(pick), 'picker: selectionLimit = remaining slots');
  check(/orderedSelection:\s*true/.test(pick), 'picker: orderedSelection (numbered badges)');
  check(/mediaTypes:\s*\['images'\]/.test(pick), 'picker: images only');
  check(/quality:\s*PICKER_QUALITY/.test(pick) && /export const pickImages = async \(limit: number\)/.test(pick), 'picker always takes original bytes; 原图 is not a pick-time input');
  check(/if \(limit <= 0\) return \[\]/.test(pick), 'never opens with 0 slots');
  check(!/\.slice\(0, limit\)/.test(pick) && /return result\.assets\.map\(/.test(pick), 'web ignores selectionLimit → overflow goes to addToDraft (toast), never silently sliced');
  check(!/\.sort\(/.test(pick), 'selection order is not re-sorted');
  const prep = attach.slice(attach.indexOf('export const prepareForUpload'));
  check(/if \(Platform\.OS !== 'web'\) return resizeForUpload\(img, original, nativeResizeDeps\)/.test(prep), 'prepareForUpload: native resizes via expo-image-manipulator');
  check(/SaveFormat\.JPEG/.test(attach) && /\.resize\(\{ width, height \}\)/.test(attach), 'native deps: resize + JPEG save');
  check(/decode: async \(uri: string\) => ImageManipulator\.manipulate\(uri\)\.renderAsync\(\)/.test(attach), 'native decodes first so EXIF-rotated dimensions drive the plan');
  check(/planCompression\(/.test(prep) && /toBlob\(resolve, plan\.mimeType, plan\.quality\)/.test(prep), 'web compression follows planCompression');
  check(/blob\.size >= /.test(prep), 'a bigger re-encode falls back to the original');
}
// the Kotlin side of expo-image-picker actually reads the options we pass (types say orderedSelection is iOS-only)
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const bundled = JSON.parse(readFileSync(new URL('../node_modules/expo/bundledNativeModules.json', import.meta.url), 'utf8'));
  check(pkg.dependencies['expo-image-manipulator'] === bundled['expo-image-manipulator'], `expo-image-manipulator pinned to the SDK's version (${bundled['expo-image-manipulator']})`);
  const kt = readFileSync(new URL('../node_modules/expo-image-picker/android/src/main/java/expo/modules/imagepicker/contracts/ImageLibraryContract.kt', import.meta.url), 'utf8');
  check(kt.includes('.setOrderedSelection(input.options.orderedSelection)'), 'Android picker forwards orderedSelection to the Photo Picker');
  check(kt.includes('PickMultipleVisualMedia(selectionLimit)'), 'Android picker forwards selectionLimit');
  const media = readFileSync(new URL('../node_modules/expo-image-picker/android/src/main/java/expo/modules/imagepicker/MediaHandler.kt', import.meta.url), 'utf8');
  check(/quality == ImagePickerConstants\.MAXIMUM_QUALITY\)\s*\{\s*RawImageExporter\(\)/.test(media), 'Android quality 1 = RawImageExporter (原图 = original bytes)');
}
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
{
  const send = chat.slice(chat.indexOf('  const doSend = async ('), chat.indexOf('  const submit = async'));
  check(/runUploadQueue\(imgs,/.test(send) && /concurrency: UPLOAD_CONCURRENCY/.test(send), 'doSend uploads through the limited queue');
  check(!/Promise\.all\(imgs\.map/.test(send), 'no unbounded Promise.all upload left in doSend');
  const failAt = send.indexOf('if (run.failed.length)');
  const sendAt = send.indexOf('await sendTask(');
  check(failAt > 0 && sendAt > failAt && /_failed: true, _uploadError: summary[\s\S]*?return;/.test(send.slice(failAt, sendAt)), 'any failed upload stops BEFORE sendTask (no partial message)');
  check(/uploadMemo\.get\(cfg\.serverUrl, img\.uri, original\)/.test(send), 'retry skips already-uploaded images');
  check(/prepareForUpload\(img, original\)/.test(send) && /oversizeMessage\(prepared\)/.test(send), 'compress, then check 12MB, then upload');
  const submit = chat.slice(chat.indexOf('  const submit = async'), chat.indexOf('  const retry = '));
  check(/willCompressBeforeUpload\(img, \{ original: sendOriginal, platform: Platform\.OS \}\)/.test(chat), 'draft oversize marking follows the send-time rule');
  check(!chat.includes('原图对之后选择的图片生效') && /const toggleSendOriginal = \(\) => setSendOriginal\(value => !value\);/.test(chat), '原图 toggle applies at send time; no pick-time toast');
  check(/sendBlocker\(attached, willCompressLater\)/.test(submit) && submit.indexOf('sendBlocker(') < submit.indexOf('const imgs = attached') && /if \(blocked\) \{\s*setComposerNotice\(blocked\);[^\n]*\n\s*return;/.test(submit), 'oversize/limit blocks BEFORE the draft is cleared');
  check(/doSend\(content, localId, imgs, priority, original\)/.test(submit), 'send carries the 原图 choice');
  const retry = chat.slice(chat.indexOf('  const retry = '), chat.indexOf('  const removeFailedAttachment'));
  check(/!!item\._original/.test(retry), 'retry keeps the 原图 choice');
  check(/addToDraft\(attachedRef\.current, incoming\)/.test(chat), 'every add (album, paste, file, camera) goes through addToDraft');
  check(/remainingImageSlots\(attachedRef\.current\)/.test(chat), '相册 asks only for the remaining slots');
  check(chat.includes('testID="composer-draft-strip"') && chat.includes('testID="composer-original-toggle"') && chat.includes('accessibilityLabel="原图"'), 'draft strip with a 原图 toggle');
  check(/onPress=\{\(\) => openViewer\(attached\.filter\(isDraftImage\)\.map\([^\n]*\), item\.uri\)\}/.test(chat), 'tapping a draft thumbnail previews it (swipe through the draft images)');
  check(/onPress=\{\(\) => removeAttachment\(item\.uri\)\}/.test(chat), 'draft thumbnails have ✕');
  check(/if \(gridViews\.length < 2\)/.test(chat) && chat.includes('testID="chat-image-grid"'), '≥2 images render as a grid; single image path unchanged');
  check((chat.match(/renderAttachments\(sentAttachmentViews\(item, cfg\.serverUrl\), item\)/g) ?? []).length === 2, 'both sent-bubble variants use the grid renderer');
  check(/renderAttachments\(replyAttachmentViews\(item, cfg\.serverUrl\)\)/.test(chat), 'agent replies with several images also use the grid');
  check(/imageGrid:[^\n]*maxWidth: 3 \* 84 \+ 2 \* 4/.test(chat), 'grid is 3 columns wide');
  check(/removeFailedAttachment\(item, a\.localIndex!\)/.test(chat), 'a failed tile can be removed from the failed message');
  check((chat.match(/hideGridImageLines\(cleanAttachmentDebugText\(sentQuoted\.body[^\n]*sentGridNames\)/g) ?? []).length === 2, 'both sent bubbles drop the redundant 📎 lines when a grid is shown');
}

console.log(`multi-image: ${ck}/${ck} checks passed`);
