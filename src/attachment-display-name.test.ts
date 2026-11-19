// #296 边界 —— hub 的 meta.attachments 没给 `name` 时,卡片标题以前退回 32 位 file_id,
// 用户看到一长串 hex。改成按 mime 给可读标题(跟随界面语言):图片→「图片」/Image、其余→「文件」/File,
// 能推出扩展名就带上。`name` 只用于展示与推断扩展名 —— 它**不是**下载后的保存文件名(缓存路径是
// `att-<fileId><ext>`,见 attach-download.ts 的 cachePathIn),所以「文件.pdf」不会变成用户磁盘上的文件名。
import { currentLanguage, setLanguagePreference } from './i18n';
import { attachmentDisplayName, parseMetaAttachmentRefs, parseMetaReplyAttachmentRefs } from './attachment-display';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

setLanguagePreference('zh');
check('默认(zh)生效', currentLanguage() === 'zh');

check('有 name 就原样(去首尾空白)', attachmentDisplayName(' 报告.pdf ', 'application/pdf') === '报告.pdf');
check('图片缺 name →「图片.png」', attachmentDisplayName(undefined, 'image/png') === '图片.png');
check('图片缺 name 且 mime 带参数 → 仍认出图片', attachmentDisplayName(null, 'image/jpeg; charset=binary') === '图片.jpg');
check('非图片缺 name →「文件.pdf」', attachmentDisplayName('', 'application/pdf') === '文件.pdf');
check('markdown / html 也带扩展名', attachmentDisplayName(undefined, 'text/markdown') === '文件.md' && attachmentDisplayName(undefined, 'text/html') === '文件.html');
check('未知 mime → 只写「文件」', attachmentDisplayName(undefined, 'application/x-unknown-thing') === '文件');
check('没有 mime → 只写「文件」', attachmentDisplayName(undefined, undefined) === '文件' && attachmentDisplayName(undefined, '') === '文件');
check('图片但未知图片 mime → 只写「图片」', attachmentDisplayName(undefined, 'image/x-weird') === '图片');

// 英文界面:同样的规则,词换成 Image / File(扩展名规则不变)
setLanguagePreference('en');
check('切到 en 后 currentLanguage()=en', currentLanguage() === 'en');
check('en:图片缺 name →「Image.png」', attachmentDisplayName(undefined, 'image/png') === 'Image.png');
check('en:非图片 →「File.pdf」', attachmentDisplayName(undefined, 'application/pdf') === 'File.pdf');
check('en:未知 mime →「File」', attachmentDisplayName(undefined, 'application/x-unknown-thing') === 'File');
check('en:有 name 不受语言影响', attachmentDisplayName('report.pdf', 'application/pdf') === 'report.pdf');
setLanguagePreference('zh');

const meta = (arr: unknown) => JSON.stringify({ attachments: arr });
const refs = parseMetaAttachmentRefs(meta([
  { type: 'file', file_id: 'a1b2c3d4e5f6a7b8', mime: 'image/png', size: 2048 },
  { type: 'file', file_id: 'b1b2c3d4e5f6a7b8', mime: 'application/pdf', size: 999 },
  { type: 'file', file_id: 'c1b2c3d4e5f6a7b8', name: ' 已经有名字.png ', mime: 'image/png' },
]));
check('解析结果:缺 name 的两条不再是 hex', refs[0]?.name === '图片.png' && refs[1]?.name === '文件.pdf');
check('解析结果:有 name 的保持原值', refs[2]?.name === '已经有名字.png');
check('尺寸照常保留', refs[0]?.size === 2048 && refs[1]?.size === 999);
check('file_id 仍是下载句柄(没被标题顶掉)', refs[0]?.fileId === 'a1b2c3d4e5f6a7b8');
const reply = parseMetaReplyAttachmentRefs(JSON.stringify({ reply_attachments: [{ type: 'file', file_id: 'd1b2c3d4e5f6a7b8', mime: 'text/csv' }] }));
check('回复附件同一条兜底规则', reply[0]?.name === '文件.csv');

// name 的用途边界:下载/缓存文件名是 `att-<fileId><ext>`,标题不参与命名 —— 这条断言防以后有人拿它当保存名。
import { cachePathIn } from './attach-download';
check('标题不作为保存文件名(cachePathIn 只用 fileId + 扩展名)', cachePathIn('/tmp/', 'a1b2c3d4e5f6a7b8', '文件.pdf', 'application/pdf') === '/tmp/att-a1b2c3d4e5f6a7b8.pdf');

console.log(`attachment display name: ${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
