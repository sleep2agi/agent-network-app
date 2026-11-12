// admin 2026-11-12「视频怎么下载不下来」：对话里的视频播完没有任何保存入口。ck 风格,自执行,失败 exit 1。
//   run: bun src/video-download-entry.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const src = readFileSync(join(import.meta.dir, 'AuthedThumb.tsx'), 'utf8');
const i18n = readFileSync(join(import.meta.dir, 'i18n-chat.ts'), 'utf8');
const video = src.slice(src.indexOf('export function AuthedVideo'), src.indexOf('export default function AuthedThumb'));
ck('A1 AuthedVideo 有「下载 / 保存视频」入口（走 AttachmentFile → 系统分享面板）', /const save = <AttachmentFile[^>]*label=\{t\('chat\.downloadVideo'\)\}/.test(video));
ck('A2 🔴 播放中（localUri）也显示保存入口', /if \(localUri\) \{\s*return <View[^>]*>\{<VideoFrame uri=\{localUri\} \/>\}\{save\}<\/View>/.test(video));
ck('A3 还没下载（占位）时也显示保存入口', /<\/Pressable>\s*\{save\}\s*<\/View>/.test(video));
ck('A4 文案中英都有', /'chat\.downloadVideo': \['下载 \/ 保存视频', 'Download \/ save video'\]/.test(i18n));
console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
