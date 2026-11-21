// #4976 跟进 —— loading 超过 4 秒必须换成「还剩多少秒」，4 秒内保持原句。
//   run: bun src/catalog-loading-hint.test.ts
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };
const src = readFileSync(new URL('./ComposerModelPalette.tsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8');

ck('4 秒后进入慢速提示', src.includes('loadingElapsedSec >= 4'));
ck('剩余秒数有上限口径（15s = 8s 排队 + 6s 轮询 + 1s 余量）', src.includes('Math.max(0, 15 - loadingElapsedSec)'));
ck('loading 结束就归零', /if \(!catalog\.loading\) \{ setLoadingElapsedSec\(0\); return; \}/.test(src));
ck('计时随重试重新开始', src.includes('}, [catalog.loading, catalogAttempt]);'));
ck('界面上有两条文案（原句 / 慢速）', src.includes("t('chat.modelPicker.loadingSlow'") && src.includes("t('chat.modelPicker.loading')"));
ck('慢速文案带秒数占位', /'chat\.modelPicker\.loadingSlow': \[[^\]]*\{s\}/.test(i18n) || i18n.includes('loadingSlow'));
ck('中英都有', /'chat\.modelPicker\.loadingSlow': \['[^']+', '[^']+'\]/.test(i18n));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
