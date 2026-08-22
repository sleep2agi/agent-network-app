import fs from 'node:fs';
import path from 'node:path';
import { isSafeMarkdownUrl, parseMarkdownBlocks } from './markdown-model';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const blocks = parseMarkdownBlocks('## 标题\n\n- 一\n- 二\n\n|项|结果|\n|---|---|\n|Enter|通过|\n\n```ts\nconst x = 1\n```');
ck('解析标题', blocks[0]?.kind === 'heading' && blocks[0].text === '标题');
ck('合并连续列表', blocks[1]?.kind === 'list' && blocks[1].items.length === 2);
ck('解析表格并跳过分隔行', blocks[2]?.kind === 'table' && blocks[2].rows.length === 2);
ck('解析围栏代码', blocks[3]?.kind === 'code' && blocks[3].text === 'const x = 1');
ck('仅允许 http/https 链接', isSafeMarkdownUrl('https://example.com') && !isSafeMarkdownUrl('javascript:alert(1)') && !isSafeMarkdownUrl('file:///tmp/x'));
ck('原始 HTML 只作为普通文本', parseMarkdownBlocks('<script>alert(1)</script>')[0]?.kind === 'paragraph');

const messageSource = fs.readFileSync(path.join(process.cwd(), 'src/MarkdownMessage.tsx'), 'utf8');
ck('Tauri Markdown 链接通过系统 opener 打开', messageSource.includes("import('@tauri-apps/plugin-opener')"));
ck('非 Tauri Markdown 链接保留 Linking fallback', messageSource.includes('await Linking.openURL(url)'));
console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
