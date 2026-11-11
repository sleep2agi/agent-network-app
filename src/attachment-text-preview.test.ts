// admin 2026-11-11「能不能新增 md 文档预览啊」—— 哪些附件给预览入口、怎么解码、超限怎么说。
//   run: bun src/attachment-text-preview.test.ts
import { readFileSync } from 'node:fs';
import { decodePreviewText, filePresentation, isMarkdownFile, isTextPreviewable, TEXT_PREVIEW_MAX_BYTES, TEXT_PREVIEW_MAX_CHARS } from './attachment-file-model';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => { total++; if (condition) passed++; else console.log('❌', name); };

ck('md is markdown', isMarkdownFile('TMA门户欧-AGENTS.md') && isMarkdownFile('a.MARKDOWN') && isMarkdownFile('x', 'text/markdown'));
ck('md / txt / json / log are previewable', ['a.md', 'b.txt', 'c.json', 'd.log', 'e.yaml'].every(n => isTextPreviewable(n)));
ck('binary-looking names are not', !isTextPreviewable('a.pdf') && !isTextPreviewable('b.zip') && !isTextPreviewable('c.png', 'image/png'));
ck('over 1 MB is not previewable', !isTextPreviewable('big.md', '', TEXT_PREVIEW_MAX_BYTES + 1) && isTextPreviewable('ok.md', '', 1000));
ck('md card shows an MD label', filePresentation('x.md').label === 'MD' && filePresentation('y.txt').label === 'TXT');

const enc = (s: string) => new TextEncoder().encode(s);
const zh = decodePreviewText(enc('﻿# 团队\n- 干活主力：TMA门户欧'));
ck('utf-8 Chinese decodes, BOM stripped', zh.ok && zh.text === '# 团队\n- 干活主力：TMA门户欧' && !zh.truncated);
const bin = decodePreviewText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
ck('NUL bytes ⇒ binary, not shown as garbage', !bin.ok && bin.reason === 'binary');
const long = decodePreviewText(enc('x'.repeat(TEXT_PREVIEW_MAX_CHARS + 10)));
ck('very long text is truncated and flagged', long.ok && long.truncated && long.text.length === TEXT_PREVIEW_MAX_CHARS);
ck('over the byte cap is refused', (() => { const r = decodePreviewText(new Uint8Array(TEXT_PREVIEW_MAX_BYTES + 1)); return !r.ok && r.reason === 'too_large'; })());

const desktop = readFileSync(new URL('./AttachmentFileDesktop.tsx', import.meta.url), 'utf8');
const native = readFileSync(new URL('./AuthedThumb.tsx', import.meta.url), 'utf8');
ck('desktop/web card offers the preview link', desktop.includes('isTextPreviewable(name, mime, size)') && desktop.includes('<AttachmentTextPreview url={uri}'));
ck('phone card offers the preview link', native.includes('isTextPreviewable(name, mime, size)') && native.includes('/api/files/${fileId}'));

console.log(`attachment-text-preview: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
