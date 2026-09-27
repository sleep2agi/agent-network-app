// 桌面「＋」/ 拖放 / 粘贴 → 草稿(src/desktop-file-intake.ts)。
// ck 风格,自执行,失败 exit 1。run: bun src/desktop-file-intake.test.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachmentFromFile, attachmentsFromFiles, filesFromTransfer, plusPressAction, transferHasFiles } from './desktop-file-intake';
import { isDraftImage } from './image-draft';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

// ── 平台分支 ──
ck('桌面 → 直接开文件选择器', plusPressAction({ desktop: true, attachEnabled: true }) === 'filePicker');
ck('手机 / 双栏 / 手机布局的网页 → 微信式面板', plusPressAction({ desktop: false, attachEnabled: true }) === 'panel');
ck('附件总开关关掉 → 面板(桌面也不硬开选择器)', plusPressAction({ desktop: true, attachEnabled: false }) === 'panel');

// ── File → 草稿 ──
const url = (f: { name?: string }) => `blob:test/${f.name ?? 'x'}`;
const png = { name: 'shot.png', type: 'image/png', size: 1234 };
const pdf = { name: 'spec.pdf', type: 'application/pdf', size: 99 };
const a = attachmentFromFile(png, url);
ck('图片:名字 / MIME / 大小 / 原始 Blob 都带上', a.fileName === 'shot.png' && a.mimeType === 'image/png' && a.fileSize === 1234 && a.webFile === (png as unknown) && a.uri === 'blob:test/shot.png');
ck('图片走图片那条路(isDraftImage)', isDraftImage(a));
ck('PDF 走文件附件那条路', !isDraftImage(attachmentFromFile(pdf, url)));
ck('无名剪贴板截图 → pasted-image.png', attachmentFromFile({ type: 'image/png', size: 1 }, url).fileName === 'pasted-image.png');
ck('无类型文件 → application/octet-stream', attachmentFromFile({ name: 'x.bin', size: 1 }, url).mimeType === 'application/octet-stream');
ck('多个文件按顺序全收', JSON.stringify(attachmentsFromFiles([png, pdf], url).map(x => x.fileName)) === '["shot.png","spec.pdf"]');
ck('空 / null → 空数组', attachmentsFromFiles(null, url).length === 0 && attachmentsFromFiles([], url).length === 0);

// ── 拖放 / 粘贴取文件 ──
ck('拖放:优先 files', filesFromTransfer({ files: [png, pdf], items: [{ kind: 'string' }] }).length === 2);
ck('粘贴:files 为空时从 items 里取 kind=file', (() => { const got = filesFromTransfer({ files: [], items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => png }, { kind: 'file', getAsFile: () => null }] }); return got.length === 1 && got[0] === png; })());
ck('纯文字 → 空(放行原生粘贴)', filesFromTransfer({ files: [], items: [{ kind: 'string' }] }).length === 0 && filesFromTransfer(null).length === 0);
ck('dragover:types 含 Files 才接', transferHasFiles({ types: ['Files'] }) && transferHasFiles({ types: ['text/plain', 'Files'] }) && !transferHasFiles({ types: ['text/plain', 'text/uri-list'] }) && !transferHasFiles(null));

// ── 接线(源码层;真点、真拖在 tests/test-shortcuts-settings/drive.mjs)──
{
  const chat = read('src/ChatScreen.tsx');
  ck('桌面没有「＋」弹层 Modal 了', !/<Modal[^>]*plusMenuOpen/.test(chat) && !chat.includes('plusMenuDesktop'));
  ck('桌面工具栏「＋」→ onPlusPress → pickFiles → appendAttachments', chat.includes('testID="composer-desktop-plus"') && chat.includes('onPress={onPlusPress}') && /pickFiles\(\)\s*\.then\(appendAttachments\)/.test(chat));
  ck('手机仍是微信式面板(右侧槽 ＋ toggle + 内联面板)', chat.includes("onPlus={() => plusEvent('toggle')}") && chat.includes('accessibilityLabel="更多发送方式面板"'));
  ck('粘贴:所有文件,经同一出口', chat.includes('attachmentsFromClipboard(event.clipboardData?.items)') && chat.includes('appendAttachments(pasted)'));
  ck('拖放:只接聊天窗格内、带文件的拖动', chat.includes('testID="chat-pane"') && chat.includes("closest?.('[data-testid=\"chat-pane\"]')") && chat.includes('transferHasFiles(event.dataTransfer)') && chat.includes('appendAttachments(attachmentsFromFiles(files))'));
  const attach = read('src/attach.ts');
  ck('pickFiles:多选、任意类型、不读 base64', /getDocumentAsync\(\{ type: '\*\/\*', multiple: true, copyToCacheDirectory: true, base64: false \}\)/.test(attach));
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  ck('主窗口关掉 Tauri 原生拖放(否则网页收不到 drop)', conf.app.windows.every((w: any) => w.dragDropEnabled === false));
  const menu = read('src/desktop-chat-menu.ts');
  ck('分离聊天窗 / 工作区窗也关掉', (menu.match(/dragDropEnabled: false/g) ?? []).length === (menu.match(/new WebviewWindow\(/g) ?? []).length);
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
