import { historyFiles, historyLinks } from './chat-history-index';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (ok) passed++;
};

const files = historyFiles([
  { content: '看这个 https://anet.sh/guide', meta_json: { attachments: [{ type: 'file', file_id: 'file_abcd1234', name: '方案.pdf' }] } },
  { result: '回了 [截图](/api/files/shot_abcd1234)\nhttps://anet.sh/guide' },
  { reply: '垃圾 file_id 不算', meta_json: '{"attachments":[{"type":"file","file_id":"short"}]}' },
]);
ck('files keep attachment name and text refs, once each', files.length === 2 && files[0].name === '方案.pdf' && files[1].fileId === 'shot_abcd1234');
ck('a short file id is dropped', !files.some(f => f.fileId === 'short'));

const links = historyLinks([
  { content: '文档 https://anet.sh/guide/getting-started.' },
  { result: '再发一次 https://anet.sh/guide/getting-started 和文件 https://y.vansin.top/api/files/file_abcd1234' },
]);
ck('links drop trailing punctuation, duplicates, and file urls', links.length === 1 && links[0].url === 'https://anet.sh/guide/getting-started');
ck('link label is host plus path', links[0].label === 'anet.sh/guide/getting-started');

console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
