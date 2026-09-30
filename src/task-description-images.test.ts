// 任务描述里的图片:插入位置、图片判定、12MB 上限、描述里的图库;markdown 图片块只在描述里打开(聊天不变)。
// ck 风格自执行。
import { readFileSync } from 'node:fs';
import { checkDescriptionImage, descriptionImages, hubImageMarkdown, imageAlt, insertAtCaret, isImageFile } from './task-description-images';
import { HUB_IMAGE_LINE, parseMarkdownBlocks } from './markdown-model';
import { markdownToPlainText } from './message-plain-text';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

console.log('# 插入');
ck('markdown 形状:相对地址,不带 token', hubImageMarkdown('截图.png', 'f_abc123') === '![截图.png](/api/files/f_abc123)');
ck('名字里的 [ ] 和换行去掉', imageAlt('a[1]\nb') === 'a 1 b' && imageAlt('') === '图片');
{
  const r = insertAtCaret('第一行第二行', { start: 3, end: 3 }, '![x](/api/files/f1)');
  ck('插在一行中间:前后都换行,独占一行', r.text === '第一行\n![x](/api/files/f1)\n第二行', JSON.stringify(r.text));
  ck('光标落在图片那行末尾', r.caret === '第一行\n![x](/api/files/f1)'.length);
}
ck('空描述:只有图片', insertAtCaret('', null, '![x](/api/files/f1)').text === '![x](/api/files/f1)');
ck('没有光标信息:追加到末尾(新起一行)', insertAtCaret('目标', null, '![x](/api/files/f1)').text === '目标\n![x](/api/files/f1)');
ck('在空行上:就占这一行,不多加空行', insertAtCaret('a\n\nb', { start: 2, end: 2 }, 'IMG').text === 'a\nIMG\nb');
ck('有选中:替换选中', insertAtCaret('abcXYZdef', { start: 3, end: 6 }, 'IMG').text === 'abc\nIMG\ndef');

console.log('# 检查');
ck('按 MIME 认图片', isImageFile({ type: 'image/png' }) && isImageFile({ type: 'image/jpeg' }) && !isImageFile({ type: 'application/pdf' }));
ck('没有 MIME 看扩展名', isImageFile({ name: 'a.WEBP' }) && !isImageFile({ name: 'a.txt' }));
ck('超过 12MB 就地报错', checkDescriptionImage({ name: 'big.png', type: 'image/png', size: 12 * 1024 * 1024 + 1 })!.includes('12MB') && checkDescriptionImage({ name: 'ok.png', type: 'image/png', size: 12 * 1024 * 1024 }) === null);
ck('不是图片就地报错', checkDescriptionImage({ name: 'a.zip', type: 'application/zip', size: 1 })!.includes('不是图片'));

console.log('# 渲染');
{
  const md = '## 目标\n![截图 1](/api/files/f_1)\n说明文字\n![截图 2](/api/files/f_2)\n![重复](/api/files/f_1)\n![外网](https://evil.example/x.png)';
  const on = parseMarkdownBlocks(md, { hubImages: true });
  ck('描述里:独占一行的 Hub 图片是图片块', on.filter(b => b.kind === 'image').length === 3);
  ck('图片前后的文字各自成段', on.map(b => b.kind).join() === 'heading,image,paragraph,image,image,paragraph', on.map(b => b.kind).join());
  ck('外网图片不当图片(不拉外网)', !HUB_IMAGE_LINE.test('![外网](https://evil.example/x.png)'));
  const off = parseMarkdownBlocks(md);
  ck('聊天里(没打开):没有图片块,行为和以前一样', !off.some(b => b.kind === 'image'));
  ck('图库:按顺序、去重', descriptionImages(md).map(i => i.fileId).join() === 'f_1,f_2');
  ck('转纯文字不崩', markdownToPlainText(md).includes('## 目标') || markdownToPlainText(md).includes('目标'));
}

console.log('# 接线(源码)');
{
  const editor = src('./TaskDescriptionEditor.tsx');
  const attach = src('./upload-url.ts');
  ck('上传带 network_id(同网成员能看)', editor.includes('uploadImage(cfg, img, { networkId: cfg.networkId })') && attach.includes('network_id=${encodeURIComponent(opts.networkId)}'));
  ck('图片地址里不放 token', !/[?&](access_)?token=/.test(editor) && editor.includes('authUri: url'));
  ck('桌面:粘贴和拖放只在鼠标界面挂(小编辑框 + 全屏编辑器各一份)', editor.includes("useImageIntake(imagesOn && pointer && shown === 'edit' && !full,") && editor.includes("useImageIntake(imagesOn && pointer && !!full && full !== 'read',") && editor.includes("addEventListener('paste'") && editor.includes("addEventListener('drop'"));
  ck('点图:桌面开独立图片窗口,否则 App 内看图', editor.includes('openImageWindow(') && editor.includes('<ImageViewer'));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
