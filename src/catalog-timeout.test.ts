// #4976 —— 模型面板「正在读取…」永久 loading。
// 三条链都必须在有限时间内落到终态：排队超时 / 单次轮询超时 / 请求抛异常。
//   run: bun src/catalog-timeout.test.ts
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => { total++; if (condition) passed++; else console.log('❌', name); };
const src = readFileSync(new URL('./ComposerModelPalette.tsx', import.meta.url), 'utf8');

ck('排队有独立超时上限', /CATALOG_QUEUE_TIMEOUT_MS\s*=\s*\d+/.test(src));
ck('单次轮询有独立超时上限', /CATALOG_POLL_TIMEOUT_MS\s*=\s*\d+/.test(src));
ck('超时用 race 收口（不 await 裸请求）', src.includes('raceCatalogTimeout(queueOpenCodeCatalog(') && src.includes('raceCatalogTimeout(pollOpenCodeCatalog('));
ck('排队抛异常也落终态', src.includes('} catch { queued = null; }') && src.includes("if (!queued) { failWith('unavailable'); return; }"));
ck('轮询抛异常也落终态', src.includes('} catch { polled = null; }') && src.includes("if (!polled) { failWith('unavailable'); return; }"));
ck('原有失败回退仍在（自报清单优先）', src.includes('if (!queued.ok) { failWith(queued.error); return; }') && src.includes('if (!polled.ok) { failWith(polled.error); return; }'));
ck('超时清理 timer（不泄漏）', src.includes('clearTimeout(timer)'));
ck('错误终态有重试按钮', src.includes('testID="model-palette-retry"') && src.includes("t('chat.modelPicker.retry')"));
ck('重试会重新发起读取（attempt 进依赖）', src.includes('setCatalogAttempt(n => n + 1)') && /\[catalogAttempt,/.test(src));
ck('loading 仍有终态出口：不可读时走 error 视图', src.includes("testID=\"model-palette-error\"") && src.includes("testID=\"model-palette-loading\""));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
