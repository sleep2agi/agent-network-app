// #527(Vincent 10-04 09:49):「比如说图片发送失败啊？我点击重新发送它那个图片并不会去重新发送的」。
// ck style: self-executing, exit 1 on any failure. run: bun src/resend-image.test.ts
//
// Replays the chat send / resend sequence through the real outbox + resend-plan modules, composed the
// way ChatScreen composes them (anchored at the bottom): submit → uploadForSend → sendTask; the
// conversation re-open path rebuilds echoes from the outbox (imagesForResend); retry asks planResend.
// The hub is a fake that records every upload and every POST /api/task.
//
// Both failure points × {retry in place, retry after the echo is rebuilt (remount / switch away and
// back), retry after an app restart}. The rebuilt-echo case is the bug: before #527 the outbox kept
// only text + hadImage, so the rebuilt bubble had no images and retry posted 「[附件] a.png」 alone.
import fs from 'node:fs';
import path from 'node:path';
import {
  __resetOutboxForTest, initOutbox, outboxAdd, outboxEntry, outboxForAlias, outboxLiveImages, outboxMarkFailed,
  outboxMarkPending, outboxRemove, outboxRemoveAttachment, type OutboxEntry,
} from './outbox';
import { imagesForResend, planResend, uploadForSend, type ResendImage } from './resend-plan';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

const HUB = 'http://hub.invalid';
const ALIAS = '示例-A';
type Img = ResendImage & { webFile?: unknown };
type Item = { content: string; _localId: string; _pending?: boolean; _failed?: boolean; _imgs?: Img[]; _restoredNoImage?: boolean; _original?: boolean; _uploadError?: string };

// ── fake hub ──────────────────────────────────────────────────────────────────
const hub = {
  uploadFails: 0, // next N uploads throw
  sendFails: 0, // next N POST /api/task throw
  uploads: [] as string[],
  tasks: [] as { task: string; attachments: { file_id: string; name: string }[]; client_request_id: string }[],
  n: 0,
};
const resetHub = () => { hub.uploadFails = 0; hub.sendFails = 0; hub.uploads = []; hub.tasks = []; hub.n = 0; };
const upload = async (img: Img) => {
  if (hub.uploadFails > 0) { hub.uploadFails--; throw new Error('网络中断'); }
  hub.n++;
  hub.uploads.push(img.fileName);
  const id = `f_${hub.n}`;
  return { img: { ...img }, up: { file_id: id, path: `/uploads/${id}.png`, url: `/api/files/${id}`, size: 68, mime: img.mimeType } };
};
const sendTask = async (task: string, attachments: { file_id: string; name: string }[] | undefined, rid: string) => {
  if (hub.sendFails > 0) { hub.sendFails--; throw new Error('hub 重启中'); }
  hub.tasks.push({ task, attachments: attachments ?? [], client_request_id: rid });
  return { ok: true, task_id: `t_${hub.tasks.length}` };
};

// ── ChatScreen, reduced to the send path ──────────────────────────────────────
let messages: Item[] = [];
let disk: OutboxEntry[] = [];
const persist = (all: OutboxEntry[]) => { disk = JSON.parse(JSON.stringify(all)); };
const patch = (id: string, p: Partial<Item>) => { messages = messages.map(m => (m._localId === id ? { ...m, ...p } : m)); };
const memo = new Map<string, { img: Img; up: any }>();

const doSend = async (content: string, localId: string, imgs: Img[], original: boolean) => {
  let attachments: { file_id: string; name: string }[] | undefined;
  if (imgs.length) {
    const run = await uploadForSend<Img>({
      localId, imgs, upload,
      memo: { get: img => memo.get(img.uri), set: (img, done) => { memo.set(img.uri, done); } },
      fallbackError: '附件上传失败',
    });
    if (!run.ok) { outboxMarkFailed(localId); patch(localId, { _pending: false, _failed: true, _uploadError: run.summary }); return; }
    attachments = run.uploaded.map(({ img, up }) => ({ file_id: up.file_id, name: img.fileName }));
  }
  try {
    await sendTask(content, attachments, localId);
    outboxRemove(localId);
    patch(localId, { _pending: false, _failed: false });
  } catch {
    outboxMarkFailed(localId);
    patch(localId, { _pending: false, _failed: true });
  }
  void original;
};
let seq = 0;
const submit = async (content: string, imgs: Img[], original = false) => {
  const localId = `dreq_${(++seq).toString(16).padStart(32, '0')}`;
  outboxAdd({ id: localId, alias: ALIAS, content, createdAt: Date.now(), state: 'pending', hadImage: imgs.length > 0, original }, imgs);
  messages = [{ content, _localId: localId, _pending: true, _imgs: imgs, _original: original }, ...messages];
  await doSend(content, localId, imgs, original);
  return localId;
};
/** Conversation re-open / remount: echoes come back from the outbox (ChatScreen's restore effect). */
const reopen = () => {
  messages = outboxForAlias(ALIAS).map(e => {
    const { imgs, lost } = imagesForResend(e, outboxLiveImages(e.id), HUB);
    return { content: e.content, _localId: e.id, _pending: e.state === 'pending', _failed: e.state === 'failed', ...(imgs.length ? { _imgs: imgs } : {}), _restoredNoImage: lost > 0, _original: !!e.original };
  });
};
/** App killed and reopened: a new process reads the outbox back from disk; nothing in memory survives. */
const restart = () => {
  const saved = JSON.parse(JSON.stringify(disk)) as OutboxEntry[];
  __resetOutboxForTest();
  memo.clear();
  initOutbox(saved, persist);
  for (const e of outboxForAlias(ALIAS)) if (e.state === 'pending') outboxMarkFailed(e.id);
  reopen();
};
const statuses: string[] = [];
const retry = async (item: Item) => {
  const plan = planResend<Img>(item);
  if (plan.kind !== 'send') return plan.kind;
  outboxMarkPending(item._localId);
  patch(item._localId, { _pending: true, _failed: false, _uploadError: undefined });
  statuses.push(state(item._localId));
  await doSend(plan.content, item._localId, plan.imgs, !!item._original);
  statuses.push(state(item._localId));
  return 'sent';
};
const state = (id: string) => { const m = messages.find(x => x._localId === id); return !m ? 'gone' : m._pending ? 'sending' : m._failed ? 'failed' : 'delivered'; };
const item = (id: string): Item => messages.find(m => m._localId === id) ?? { content: "", _localId: id };
const blobImg = (name: string): Img => ({ uri: `blob:http://app/${name}`, fileName: name, mimeType: 'image/png', fileSize: 68, webFile: { bytes: name } });
const fileImg = (name: string): Img => ({ uri: `file:///cache/ImagePicker/${name}`, fileName: name, mimeType: 'image/png', fileSize: 68 });
const fresh = () => { __resetOutboxForTest(); initOutbox([], persist); messages = []; memo.clear(); resetHub(); statuses.length = 0; };
const imageDelivered = (label: string, rid: string, expectFileIds?: string[]) => {
  const sent = hub.tasks.filter(x => x.client_request_id === rid);
  ck(`${label}: exactly one task reached the hub`, sent.length === 1, `tasks=${sent.length}`);
  const t = sent[0];
  ck(`${label}: it carries the image (never text-only)`, !!t && t.attachments.length > 0, JSON.stringify(t?.attachments ?? []));
  if (expectFileIds && t) ck(`${label}: file ids ${expectFileIds.join(',')}`, JSON.stringify(t.attachments.map(a => a.file_id)) === JSON.stringify(expectFileIds), JSON.stringify(t.attachments.map(a => a.file_id)));
  ck(`${label}: bubble ends delivered, outbox cleared`, state(rid) === 'delivered' && !outboxEntry(rid), state(rid));
};

// ── A: upload fails → retry in place ──────────────────────────────────────────
fresh();
hub.uploadFails = 1;
let id = await submit('[附件] a.png', [blobImg('a.png')]);
ck('A: upload failure → 未送达, nothing posted', state(id) === 'failed' && hub.tasks.length === 0 && !!item(id)._uploadError);
await retry(item(id));
ck('A: retry re-uploaded the image', hub.uploads.length === 1);
ck('A: status failed → sending → delivered', statuses.join('>') === 'sending>delivered', statuses.join('>'));
imageDelivered('A', id, ['f_1']);

// ── B: upload ok, POST /api/task fails → retry in place reuses the file id ────
fresh();
hub.sendFails = 1;
id = await submit('看图', [blobImg('b.png')]);
ck('B: send failure after upload → 未送达', state(id) === 'failed' && hub.uploads.length === 1 && hub.tasks.length === 0);
ck('B: the upload is recorded in the outbox (survives restarts)', outboxEntry(id)?.attachments?.[0]?.uploaded?.up.file_id === 'f_1' && disk[0]?.attachments?.[0]?.uploaded?.up.file_id === 'f_1');
await retry(item(id));
ck('B: retry did not upload again', hub.uploads.length === 1, `uploads=${hub.uploads.length}`);
imageDelivered('B', id, ['f_1']);

// ── C: the #527 path — echo rebuilt from the outbox (switch away and back / remount), then retry ──
for (const [label, setup] of [['C1 upload failed', () => { hub.uploadFails = 1; }], ['C2 send failed', () => { hub.sendFails = 1; }]] as const) {
  fresh();
  setup();
  id = await submit('[附件] c.png', [blobImg('c.png')]);
  reopen();
  ck(`${label}: rebuilt bubble still shows the image`, (item(id)._imgs?.length ?? 0) === 1 && item(id)._imgs![0].uri === 'blob:http://app/c.png' && !item(id)._restoredNoImage);
  await retry(item(id));
  imageDelivered(label, id, ['f_1']);
  ck(`${label}: one upload in total`, hub.uploads.length === 1, `uploads=${hub.uploads.length}`);
}

// ── D: send failed after upload, app restarted (web/Tauri: blob uri is gone) → reuse the hub file ──
fresh();
hub.sendFails = 1;
id = await submit('[附件] d.png', [blobImg('d.png')]);
restart();
const d = item(id);
ck('D: restored bubble keeps a preview (hub copy, authed)', d._imgs?.length === 1 && d._imgs[0].hubFileId === 'f_1' && d._imgs[0].uri === `${HUB}/api/files/f_1` && !d._restoredNoImage, JSON.stringify(d._imgs));
ck('D: no blob: uri was written to disk', !JSON.stringify(disk).includes('blob:'));
await retry(d);
ck('D: retry after restart did not upload', hub.uploads.length === 1);
imageDelivered('D', id, ['f_1']);

// ── E: upload never succeeded, restarted on web (blob gone) → refuse, never text-only ──
fresh();
hub.uploadFails = 1;
id = await submit('[附件] e.png', [blobImg('e.png')]);
restart();
ck('E: restored bubble is marked images-lost', !!item(id)._restoredNoImage);
const before = hub.tasks.length;
ck('E: retry refuses (images_lost)', (await retry(item(id))) === 'images_lost');
ck('E: nothing posted (no text-only message)', hub.tasks.length === before);

// ── F: upload never succeeded, restarted on a phone (file:// uri survives) → re-upload ──
fresh();
hub.uploadFails = 1;
id = await submit('[附件] f.png', [fileImg('f.png')]);
restart();
ck('F: restored bubble keeps the local preview', item(id)._imgs?.[0]?.uri === 'file:///cache/ImagePicker/f.png');
await retry(item(id));
ck('F: retry uploaded it', hub.uploads.length === 1);
imageDelivered('F', id, ['f_1']);

// ── G: outbox written by an older app version (text + hadImage only) → refuse, never text-only ──
fresh();
initOutbox([{ id: 'dreq_' + 'a'.repeat(32), alias: ALIAS, content: '[附件] old.png', createdAt: 1, state: 'failed', hadImage: true }], persist);
reopen();
ck('G: legacy entry → images-lost, retry refuses', item('dreq_' + 'a'.repeat(32))._restoredNoImage === true && (await retry(item('dreq_' + 'a'.repeat(32)))) === 'images_lost' && hub.tasks.length === 0);

// ── H: multi-image, second upload fails, user removes it → indexes stay aligned, first reused ──
fresh();
let calls = 0;
const realUpload = upload;
id = await (async () => {
  const localId = 'dreq_' + 'b'.repeat(32);
  const imgs = [blobImg('h1.png'), blobImg('h2.png'), blobImg('h3.png')];
  outboxAdd({ id: localId, alias: ALIAS, content: '三张', createdAt: Date.now(), state: 'pending', hadImage: true }, imgs);
  messages = [{ content: '三张', _localId: localId, _pending: true, _imgs: imgs }];
  const run = await uploadForSend<Img>({ localId, imgs, upload: async img => { calls++; if (img.fileName === 'h2.png') throw new Error('超时'); return realUpload(img); }, fallbackError: 'x' });
  ck('H: one failed upload blocks the whole message', !run.ok);
  outboxMarkFailed(localId);
  patch(localId, { _pending: false, _failed: true, _imgs: imgs });
  return localId;
})();
outboxRemoveAttachment(id, 1);
patch(id, { _imgs: item(id)._imgs!.filter((_, i) => i !== 1) });
reopen();
ck('H: outbox and bubble agree after removal', JSON.stringify(item(id)._imgs?.map(i => i.fileName)) === '["h1.png","h3.png"]' && JSON.stringify(outboxEntry(id)?.attachments?.map(a => a.uploaded?.up.file_id)) === '["f_1","f_2"]');
await retry(item(id));
imageDelivered('H', id, ['f_1', 'f_2']);
ck('H: retry uploaded nothing new', hub.uploads.length === 2 && calls === 3, `uploads=${hub.uploads.length}`);

// ── planResend unit edges ─────────────────────────────────────────────────────
ck('planResend: images ride along', (() => { const p = planResend({ _localId: 'x', content: 'a', _imgs: [1, 2] }); return p.kind === 'send' && p.imgs.length === 2; })());
ck('planResend: image-only message (empty text) still resends', planResend({ _localId: 'x', content: '', _imgs: [1] }).kind === 'send');
ck('planResend: images lost → refuse', planResend({ _localId: 'x', content: 'a', _restoredNoImage: true }).kind === 'images_lost');

// ── anchors: ChatScreen composes these exactly as above ───────────────────────
const src = fs.readFileSync(path.join(import.meta.dir ?? path.dirname(new URL(import.meta.url).pathname), 'ChatScreen.tsx'), 'utf8');
ck('anchor: restore rebuilds images from the outbox', /imagesForResend\(e, outboxLiveImages\(e\.id\), cfg\.serverUrl\)/.test(src));
ck('anchor: submit hands the images to the outbox', /outboxAdd\(\{[^}]*original \}, imgs\)/.test(src));
ck('anchor: upload phase goes through uploadForSend', /await uploadForSend</.test(src));
ck('anchor: retry asks planResend and sends plan.imgs', /const plan = planResend\(item\)/.test(src) && /doSend\(plan\.content, item\._localId, plan\.imgs/.test(src));
ck('anchor: removing a failed attachment updates the outbox', /outboxRemoveAttachment\(item\._localId, index\)/.test(src));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
process.exit(0);
